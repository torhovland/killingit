"""Garmin activity sync sidecar.

A minimal HTTP service that wraps `python-garminconnect` so the Bun/Hono API
can pull the operator's last 42 days of Garmin activities without adding a
Python runtime to the main backend (see ADR 0003 amendment).

Endpoints:
  POST /authenticate   { "username", "password" } -> 204 (or 401/403/429/502)
  POST /sync           { "username", "password" } -> { "activities": [...] }
  POST /metrics        { "username", "password" } -> { "metrics": [...] }
  POST /daily          { "username", "password", "date" } -> { "date", "metrics": {...} }
  GET  /health         -> {"status": "ok"}

Garmin rate-limits repeated SSO logins aggressively (429), so the sidecar
persists the Garmin token store per username and reuses it: `/authenticate`
performs the one real login, and the immediately-following `/sync` resumes from
those tokens instead of logging in again.

The /sync response activities are normalized to the same shape the web app and
shared types expect: id, name, type, startDate (ISO 8601 UTC), distance (m),
movingTime (s), elapsedTime (s), totalElevationGain (m), plus a `samples`
timeseries normalized from Garmin's activity details (timestamp, location,
heart rate, power, temperature, speed, distance, elevation, cadence).
"""

from __future__ import annotations

import hashlib
import logging
import math
import os
import tempfile
from datetime import UTC, datetime, timedelta
from pathlib import Path

from fastapi import FastAPI, HTTPException
from garminconnect import (
    Garmin,
    GarminConnectAuthenticationError,
    GarminConnectConnectionError,
    GarminConnectTooManyRequestsError,
)
from garminconnect.activity_details import parse_activity_detail_metrics
from pydantic import BaseModel

logger = logging.getLogger("garmin-sidecar")

app = FastAPI(title="killingit-garmin-sidecar")

# Number of days of history to sync (inclusive window ending today). This
# matches the chronic-training-load window used by the plan's ATL/CTL numbers.
SYNC_WINDOW_DAYS = 42

# A strength session is normally a few dozen sets. The cap keeps an unusual
# payload from bloating the sync response and the prompt.
MAX_STRENGTH_SETS = 200

# Where the library caches Garmin session tokens between calls. Configurable so
# deployments can point it at a persistent volume; defaults to a private temp
# dir (created 0700). Tokens are single-operator, so one store per username.
TOKENSTORE_ROOT = Path(
    os.environ.get("GARMIN_TOKENSTORE_DIR")
    or Path(tempfile.gettempdir()) / "killingit-garmin-tokens"
)


class Credentials(BaseModel):
    username: str
    password: str


class DailyRequest(Credentials):
    date: str


class _LoginError(Exception):
    """Garmin rejected the supplied credentials."""


class _MfaRequiredError(Exception):
    """Garmin requires multi-factor authentication."""


class _RateLimitedError(Exception):
    """Garmin is rate limiting logins / requests (HTTP 429)."""


class _UpstreamError(Exception):
    """Garmin returned an unexpected error."""


def _tokenstore_for(username: str) -> str:
    """Per-username token-store path (hashed so the dir name carries no PII)."""
    TOKENSTORE_ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
    digest = hashlib.sha256(username.encode("utf-8")).hexdigest()[:16]
    return str(TOKENSTORE_ROOT / digest)


def _login(credentials: Credentials) -> Garmin:
    """Log in (or resume from cached tokens) and map failures to clear errors."""
    try:
        garmin = Garmin(email=credentials.username, password=credentials.password)
        needs_mfa, _ = garmin.login(tokenstore=_tokenstore_for(credentials.username))
        if needs_mfa:
            raise _MfaRequiredError(
                "Garmin account requires multi-factor authentication, which "
                "is not supported by this integration"
            )
    except _MfaRequiredError:
        raise
    except GarminConnectTooManyRequestsError as exc:
        raise _RateLimitedError(
            "Garmin is rate limiting logins. Wait a few minutes and try again."
        ) from exc
    except GarminConnectAuthenticationError as exc:
        raise _LoginError("invalid Garmin credentials") from exc
    except GarminConnectConnectionError as exc:
        raise _UpstreamError("could not reach Garmin Connect") from exc
    except Exception as exc:  # noqa: BLE001 - library raises several types
        logger.exception("unexpected Garmin login failure")
        raise _UpstreamError("unexpected Garmin login failure") from exc
    return garmin


def _date_window(now: datetime | None = None) -> tuple[str, str]:
    """Return the inclusive (start, end) dates for the sync window, YYYY-MM-DD.

    `get_activities_by_date` requires plain dates, not ISO timestamps.
    """
    end = (now or datetime.now(UTC)).date()
    start = end - timedelta(days=SYNC_WINDOW_DAYS)
    return start.isoformat(), end.isoformat()


def _sync(credentials: Credentials) -> list[dict]:
    garmin = _login(credentials)
    startdate, enddate = _date_window()

    try:
        raw_activities = garmin.get_activities_by_date(startdate, enddate)
    except GarminConnectTooManyRequestsError as exc:
        raise _RateLimitedError(
            "Garmin is rate limiting requests. Wait a few minutes and try again."
        ) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("Garmin activity fetch failed")
        raise _UpstreamError("Garmin activity fetch failed") from exc

    try:
        activities = []
        for raw in raw_activities or []:
            activity_id = raw.get("activityId")
            activity_type = normalize_type(raw.get("activityType"))
            activities.append(
                _to_activity(
                    raw,
                    _samples_for(garmin, activity_id, activity_type),
                    _strength_sets_for(garmin, activity_id, activity_type),
                )
            )
        return activities
    except GarminConnectTooManyRequestsError as exc:
        raise _RateLimitedError(
            "Garmin is rate limiting requests. Wait a few minutes and try again."
        ) from exc


def _sync_metrics(credentials: Credentials) -> dict:
    """Fetch body composition and FTP history for the same sync window.

    Garmin returns weight, body-fat percentage, and other scale data per
    weigh-in. Only the two values the Fitness chart needs are normalized; a
    missing body-fat value is left out instead of being invented. The historic
    cycling FTP is fetched separately and treated as supplementary: a failure
    there does not lose the body measurements.
    """
    garmin = _login(credentials)
    startdate, enddate = _date_window()

    try:
        payload = garmin.get_body_composition(startdate, enddate)
    except GarminConnectTooManyRequestsError as exc:
        raise _RateLimitedError(
            "Garmin is rate limiting requests. Wait a few minutes and try again."
        ) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("Garmin body composition fetch failed")
        raise _UpstreamError("Garmin body composition fetch failed") from exc

    return {
        "metrics": _to_body_metrics(payload or {}),
        "ftp": _sync_ftp_history(garmin, startdate, enddate),
    }


def _sync_daily(credentials: Credentials, date: str) -> dict:
    """Fetch one day's Garmin stats, sleep, readiness and VO2max.

    The daily stats bundle is the base. Sleep, training readiness and max
    metrics fill the recovery data the bundle does not contain. A failure in one
    source omits only its values; a Garmin rate limit aborts the whole day so
    the caller can stop the backfill and retry later.
    """
    garmin = _login(credentials)
    metrics: dict[str, float] = {}
    fetched_any = False

    stats = _optional_daily_call(garmin.get_stats, date, "daily stats")
    if stats is not None:
        fetched_any = True
        _add_stats_metrics(metrics, stats)

    sleep = _optional_daily_call(garmin.get_sleep_data, date, "sleep")
    if sleep is not None:
        fetched_any = True
        _add_sleep_metrics(metrics, sleep)

    readiness = _optional_daily_call(
        garmin.get_training_readiness, date, "training readiness"
    )
    if readiness is not None:
        fetched_any = True
        _add_readiness_metrics(metrics, readiness)

    max_metrics = _optional_daily_call(garmin.get_max_metrics, date, "max metrics")
    if max_metrics is not None:
        fetched_any = True
        _add_vo2max_metrics(metrics, max_metrics)

    if not fetched_any:
        raise _UpstreamError("Garmin daily data unavailable")
    return {"date": date, "metrics": metrics}


def _optional_daily_call(call, date: str, label: str):
    """Call one daily Garmin source, keeping rate limits but tolerating outages."""
    try:
        return call(date)
    except GarminConnectTooManyRequestsError as exc:
        raise _RateLimitedError(
            "Garmin is rate limiting requests. Wait a few minutes and try again."
        ) from exc
    except Exception:  # noqa: BLE001 - one source must not lose the day
        logger.exception("Garmin %s fetch failed for %s", label, date)
        return None


def _add_stats_metrics(metrics: dict[str, float], stats: dict) -> None:
    """Normalize the fields of Garmin's daily stats bundle."""
    if not isinstance(stats, dict):
        return
    _put_metric(metrics, "resting_heart_rate", stats.get("restingHeartRate"), 20, 250)
    _put_metric(
        metrics,
        "sleep_duration",
        _seconds_to_minutes(stats.get("sleepingSeconds")),
        0,
        24 * 60,
    )
    _put_metric(metrics, "stress", stats.get("averageStressLevel"), 0, 100)
    _put_metric(
        metrics, "body_battery_high", stats.get("bodyBatteryHighestValue"), 0, 100
    )
    _put_metric(
        metrics, "body_battery_low", stats.get("bodyBatteryLowestValue"), 0, 100
    )
    _put_metric(metrics, "steps", stats.get("totalSteps"), 0, 200_000)
    _put_metric(metrics, "active_calories", stats.get("activeKilocalories"), 0, 20_000)
    _put_metric(metrics, "spo2", stats.get("averageSpo2"), 50, 100)

    moderate = _finite_or_none(stats.get("moderateIntensityMinutes"))
    vigorous = _finite_or_none(stats.get("vigorousIntensityMinutes"))
    if moderate is not None or vigorous is not None:
        # Garmin counts a vigorous minute as two intensity minutes.
        total = (moderate or 0) + 2 * (vigorous or 0)
        _put_metric(metrics, "intensity_minutes", total, 0, 24 * 60 * 2)


def _add_sleep_metrics(metrics: dict[str, float], sleep: dict) -> None:
    """Normalize sleep duration, score, stages and overnight vitals."""
    if not isinstance(sleep, dict):
        return
    dto = sleep.get("dailySleepDTO")
    if not isinstance(dto, dict):
        return

    _put_metric(
        metrics,
        "sleep_duration",
        _seconds_to_minutes(dto.get("sleepTimeSeconds")),
        0,
        24 * 60,
    )
    scores = dto.get("sleepScores")
    if isinstance(scores, dict):
        overall = scores.get("overall")
        if isinstance(overall, dict):
            _put_metric(metrics, "sleep_score", overall.get("value"), 0, 100)

    _put_metric(
        metrics,
        "deep_sleep",
        _seconds_to_minutes(dto.get("deepSleepSeconds")),
        0,
        24 * 60,
    )
    _put_metric(
        metrics,
        "light_sleep",
        _seconds_to_minutes(dto.get("lightSleepSeconds")),
        0,
        24 * 60,
    )
    _put_metric(
        metrics,
        "rem_sleep",
        _seconds_to_minutes(dto.get("remSleepSeconds")),
        0,
        24 * 60,
    )
    _put_metric(
        metrics,
        "awake_sleep",
        _seconds_to_minutes(dto.get("awakeSleepSeconds")),
        0,
        24 * 60,
    )
    _put_metric(
        metrics,
        "hrv",
        # Garmin returns overnight HRV at the top level of the sleep response;
        # older payloads carried it inside dailySleepDTO, so keep that fallback.
        _first_value(sleep, "avgOvernightHrv")
        or _first_value(dto, "avgSleepHRV", "avgOvernightHrv"),
        0,
        500,
    )
    _put_metric(
        metrics,
        "spo2",
        _first_value(dto, "averageSpO2Value", "avgSpO2", "averageSpO2"),
        50,
        100,
    )
    _put_metric(
        metrics,
        "respiration",
        _first_value(dto, "averageRespirationValue", "avgRespirationValue"),
        0,
        60,
        decimals=1,
    )


def _add_readiness_metrics(metrics: dict[str, float], readiness) -> None:
    """Normalize the latest training-readiness snapshot for the day."""
    snapshot = _latest_readiness_snapshot(readiness)
    if snapshot is None:
        return
    _put_metric(metrics, "training_readiness", snapshot.get("score"), 0, 100)
    _put_metric(metrics, "recovery_time", snapshot.get("recoveryTime"), 0, 10_080)
    # Readiness also carries the sleep score; keep it as a fallback when the
    # sleep endpoint had no score for this day.
    if "sleep_score" not in metrics:
        _put_metric(metrics, "sleep_score", snapshot.get("sleepScore"), 0, 100)


def _latest_readiness_snapshot(readiness):
    """Pick the most recent readiness snapshot from Garmin's list."""
    if isinstance(readiness, dict):
        return readiness
    if not isinstance(readiness, list):
        return None
    snapshots = [entry for entry in readiness if isinstance(entry, dict)]
    if not snapshots:
        return None
    return max(
        snapshots,
        key=lambda entry: str(entry.get("timestamp") or entry.get("timestampLocal") or ""),
    )


def _add_vo2max_metrics(metrics: dict[str, float], payload) -> None:
    """Normalize VO2max from Garmin's max-metrics response.

    Garmin's daily endpoint returns a list of records, while older responses and
    some stubs return a single dict. Both shapes are accepted; when a list holds
    several records, the one with the latest calendar date wins.
    """
    if isinstance(payload, list):
        records = [entry for entry in payload if isinstance(entry, dict)]
        if not records:
            return
        payload = max(
            records,
            key=lambda entry: str(
                (entry.get("generic") or {}).get("calendarDate")
                or (entry.get("cycling") or {}).get("calendarDate")
                or ""
            ),
        )
    if not isinstance(payload, dict):
        return
    generic = payload.get("generic")
    if isinstance(generic, dict):
        _put_metric(
            metrics,
            "vo2max",
            _first_value(generic, "vo2MaxPreciseValue", "vo2MaxValue"),
            10,
            100,
            decimals=1,
        )
    cycling = payload.get("cycling")
    if isinstance(cycling, dict):
        _put_metric(
            metrics,
            "vo2max_cycling",
            _first_value(cycling, "vo2MaxPreciseValue", "vo2MaxValue"),
            10,
            100,
            decimals=1,
        )


def _put_metric(
    metrics: dict[str, float],
    key: str,
    value,
    minimum: float,
    maximum: float,
    decimals: int = 0,
) -> None:
    """Store a finite value inside its plausible range, rounded for display."""
    number = _finite_or_none(value)
    if number is None or not minimum <= number <= maximum:
        return
    metrics[key] = round(number, decimals)


def _seconds_to_minutes(value):
    seconds = _finite_or_none(value)
    if seconds is None:
        return None
    return seconds / 60


def _first_value(payload: dict, *keys: str):
    for key in keys:
        value = payload.get(key)
        if value is not None:
            return value
    return None


def _sync_ftp_history(garmin, startdate: str, enddate: str) -> list[dict]:
    """Fetch and normalize Garmin's historic cycling FTP, or [] on failure."""
    try:
        payload = garmin.get_functional_threshold_power_range(
            startdate,
            enddate,
            sport="CYCLING",
            aggregation="daily",
        )
    except Exception:  # noqa: BLE001 - supplementary data
        logger.exception("Garmin FTP history fetch failed")
        return []
    return _to_ftp_history(payload)


def _to_ftp_history(payload) -> list[dict]:
    """Normalize Garmin's FTP range response into dated watt samples."""
    samples: dict[str, dict] = {}
    for raw in _ftp_records(payload):
        if not isinstance(raw, dict):
            continue
        date = _metric_date(raw)
        watts = _ftp_watts(raw)
        if date is None or watts is None:
            continue
        samples[date] = {"date": date, "watts": watts}
    return [samples[date] for date in sorted(samples)]


def _ftp_records(payload) -> list:
    """Return the list of FTP records from Garmin's several response shapes."""
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        return []
    for key in (
        "functionalThresholdPowerList",
        "functionalThresholdPower",
        "ftpList",
        "values",
        "series",
        "data",
        "items",
        "records",
        "dailyValues",
    ):
        value = payload.get(key)
        if isinstance(value, list):
            return value
    return [payload]


def _ftp_watts(raw: dict) -> int | None:
    """Read a plausible FTP in watts from a Garmin FTP record."""
    for key in (
        "functionalThresholdPower",
        "ftp",
        "watts",
        "value",
        "thresholdPower",
    ):
        value = raw.get(key)
        if isinstance(value, dict):
            value = value.get("value")
        number = _finite_or_none(value)
        if number is not None and 50 <= number <= 2000:
            return round(number)
    return None


def _to_body_metrics(payload: dict) -> list[dict]:
    """Normalize Garmin's body-composition payload into daily samples."""
    samples: list[dict] = []
    seen_dates: set[str] = set()
    for raw in payload.get("dateWeightList") or []:
        if not isinstance(raw, dict):
            continue
        date = _metric_date(raw)
        if date is None or date in seen_dates:
            continue
        weight = _weight_kg(raw)
        body_fat = _body_fat_percent(raw)
        if weight is None and body_fat is None:
            continue
        sample = {"date": date}
        if weight is not None:
            sample["weightKg"] = weight
        if body_fat is not None:
            sample["bodyFatPercent"] = body_fat
        samples.append(sample)
        seen_dates.add(date)
    return sorted(samples, key=lambda sample: sample["date"])


def _metric_date(raw: dict) -> str | None:
    """Read a YYYY-MM-DD date from a Garmin weigh-in entry."""
    for key in ("calendarDate", "date"):
        value = raw.get(key)
        if isinstance(value, str) and len(value) >= 10:
            candidate = value[:10]
            if _is_plain_date(candidate):
                return candidate
    for key in ("sampleTimeGMT", "timestampGMT", "gmtTimestamp", "dateTimestamp"):
        value = raw.get(key)
        if isinstance(value, str):
            candidate = value[:10]
            if _is_plain_date(candidate):
                return candidate
        milliseconds = _finite_or_none(value)
        if milliseconds is not None:
            try:
                return datetime.fromtimestamp(milliseconds / 1000, tz=UTC).date().isoformat()
            except (OverflowError, OSError, ValueError):
                continue
    return None


def _is_plain_date(value: str) -> bool:
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        return False
    return True


def _weight_kg(raw: dict) -> float | None:
    """Normalize Garmin's weight to kilograms."""
    value = _finite_or_none(raw.get("weight"))
    if value is None:
        value = _finite_or_none(raw.get("value"))
    if value is None or value <= 0:
        return None
    unit = str(raw.get("unitKey") or raw.get("weightUnit") or "").lower()
    if unit in ("lb", "lbs", "pound", "pounds"):
        value *= 0.45359237
    elif unit in ("g", "gram", "grams"):
        value /= 1000
    elif value > 500:
        # Garmin's date-range payload commonly reports grams without a unit.
        value /= 1000
    return round(value, 2)


def _body_fat_percent(raw: dict) -> float | None:
    """Normalize a body-fat value to a percentage."""
    value = _finite_or_none(raw.get("bodyFat"))
    if value is None:
        value = _finite_or_none(raw.get("percentFat"))
    if value is None:
        value = _finite_or_none(raw.get("bodyFatPercent"))
    if value is None or value <= 0:
        return None
    if value <= 1:
        value *= 100
    if value > 75:
        return None
    return round(value, 1)


def _samples_for(garmin, activity_id, activity_type: str = "") -> list[dict]:
    """Fetch and normalize one activity's timeseries.

    A single failed detail fetch must not fail the whole 42-day sync, so it is
    logged and treated as an activity with no recorded samples. Rate limiting is
    different: it is re-raised so the caller can surface `429`.
    """
    if activity_id is None:
        return []
    try:
        details = garmin.get_activity_details(str(activity_id))
    except GarminConnectTooManyRequestsError:
        raise
    except Exception:  # noqa: BLE001 - any library/network failure
        logger.exception("Garmin activity details fetch failed for %s", activity_id)
        return []
    return _to_samples(details or {}, activity_type)


def _strength_sets_for(garmin, activity_id, activity_type: str) -> list[dict]:
    """Fetch and normalize a strength activity's recorded sets.

    Only strength activities have exercise sets, so other activities skip the
    extra Garmin request. The same fail-open/rate-limit split as the timeseries
    fetch applies: one bad set fetch leaves the activity with no sets.
    """
    if activity_id is None or not _is_strength(activity_type):
        return []
    try:
        payload = garmin.get_activity_exercise_sets(str(activity_id))
    except GarminConnectTooManyRequestsError:
        raise
    except Exception:  # noqa: BLE001 - any library/network failure
        logger.exception(
            "Garmin exercise-sets fetch failed for %s", activity_id
        )
        return []
    return _to_strength_sets(payload or {})


def _is_strength(activity_type: str) -> bool:
    """Whether a normalized Garmin type is a strength-training activity."""
    normalized = activity_type.lower()
    return "strength" in normalized or "weight" in normalized or "gym" in normalized


def _to_strength_sets(payload: dict) -> list[dict]:
    """Normalize Garmin's exerciseSets response into stable set objects."""
    raw_sets = payload.get("exerciseSets") if isinstance(payload, dict) else None
    sets: list[dict] = []
    for raw in raw_sets or []:
        if not isinstance(raw, dict):
            continue
        item = _strength_set(raw)
        if item is not None:
            sets.append(item)
        if len(sets) >= MAX_STRENGTH_SETS:
            break
    return sets


def _strength_set(raw: dict) -> dict | None:
    """Map one Garmin exercise set, omitting channels it did not record."""
    exercises = []
    for exercise in raw.get("exercises") or []:
        if not isinstance(exercise, dict):
            continue
        category = exercise.get("category")
        if not isinstance(category, str) or category.strip() == "":
            continue
        name = exercise.get("name")
        exercises.append(
            {
                "category": category.strip(),
                "name": name.strip()
                if isinstance(name, str) and name.strip() != ""
                else None,
            }
        )

    item: dict = {}
    set_type = raw.get("setType")
    if isinstance(set_type, str) and set_type.strip() != "":
        item["setType"] = set_type.strip().lower()

    for key, field in (
        ("startTime", "startTime"),
        ("startTimeGMT", "startTime"),
    ):
        value = raw.get(key)
        if value is not None:
            item["startTime"] = _iso(value)
            break

    duration = _finite_or_none(raw.get("duration"))
    if duration is not None and duration >= 0:
        item["durationSeconds"] = duration

    repetitions = _finite_or_none(raw.get("repetitionCount"))
    if repetitions is not None and repetitions >= 0:
        item["repetitions"] = int(repetitions)

    weight = _exercise_weight_kg(raw.get("weight"))
    if weight is not None:
        item["weightKg"] = weight

    if exercises:
        item["exercises"] = exercises

    # A set with no exercise and no recorded work tells the coach nothing.
    if not exercises and all(
        key not in item for key in ("repetitions", "weightKg", "durationSeconds")
    ):
        return None
    return item


def _exercise_weight_kg(value) -> float | None:
    """Convert Garmin's gram-based exercise weight to kilograms."""
    grams = _finite_or_none(value)
    if grams is None or grams <= 0:
        return None
    return round(grams / 1000, 2)


def _to_activity(
    raw: dict,
    samples: list[dict] | None = None,
    strength_sets: list[dict] | None = None,
) -> dict:
    """Map a Garmin activity to the shared normalized shape."""

    def _num(value, default: float = 0.0) -> float:
        try:
            return float(value) if value is not None else default
        except (TypeError, ValueError):
            return default

    # Prefer Garmin's UTC timestamp. `startTimeLocal` is wall-clock time with no
    # zone offset, so treating it as UTC makes every activity shift when the
    # athlete changes their display time zone.
    start = raw.get("startTimeGMT") or raw.get("startTimeLocal")
    distance = _num(raw.get("distance"))
    moving_time = _num(raw.get("movingDuration"))
    elapsed_time = _num(raw.get("duration"))
    average_speed = _first_positive(
        raw.get("averageSpeed"), raw.get("averageMovingSpeed"), raw.get("avgSpeed")
    )
    if average_speed is None:
        # Some sports (for example indoor rowing) record distance but leave the
        # summary speed at zero. Derive the mean so the athlete still sees pace.
        duration = moving_time if moving_time > 0 else elapsed_time
        if distance > 0 and duration > 0:
            average_speed = distance / duration
    max_speed = _first_positive(raw.get("maxSpeed"))

    activity = {
        "id": int(raw.get("activityId") or 0),
        "name": raw.get("activityName") or "",
        "type": normalize_type(raw.get("activityType") or "unknown"),
        "startDate": _iso(start) if start else "",
        "distance": distance,
        "movingTime": moving_time,
        "elapsedTime": elapsed_time,
        "totalElevationGain": _num(raw.get("elevationGain")),
        "samples": samples or [],
    }
    if average_speed is not None:
        activity["averageSpeed"] = average_speed
    if max_speed is not None:
        activity["maxSpeed"] = max_speed
    if strength_sets:
        activity["strengthSets"] = strength_sets
    return activity


# Garmin detail metric keys -> normalized sample fields, in priority order.
# Keys vary by device and activity type; for aliases (temperature, elevation)
# the first key present wins, and absent channels are omitted from the sample
# entirely. Cadence needs activity-type context, so it is resolved separately.
_SAMPLE_METRICS = (
    ("directLatitude", "latitude"),
    ("directLongitude", "longitude"),
    ("directHeartRate", "heartRate"),
    ("directPower", "power"),
    ("directAirTemperature", "temperature"),
    ("directTemperature", "temperature"),
    ("directSpeed", "speed"),
    ("directEnhancedSpeed", "speed"),
    ("directCorrectedElevation", "elevation"),
    ("directElevation", "elevation"),
    ("directUncorrectedElevation", "elevation"),
)


def _to_samples(details: dict, activity_type: str = "") -> list[dict]:
    """Resolve Garmin's positional detail metrics into normalized samples."""
    samples = []
    for raw in parse_activity_detail_metrics(details):
        timestamp = _epoch_iso(raw.get("directTimestamp"))
        if timestamp is None:
            continue

        sample = {"timestamp": timestamp}
        for source_key, field in _SAMPLE_METRICS:
            if field in sample:
                continue
            value = _finite_or_none(raw.get(source_key))
            if value is not None:
                sample[field] = value

        cadence = _cadence(raw, activity_type)
        if cadence is not None:
            sample["cadence"] = cadence

        # Garmin usually reports cumulative distance as `sumDistance`, but some
        # devices only provide the instantaneous `directDistance`.
        distance = _finite_or_none(raw.get("sumDistance"))
        if distance is None:
            distance = _finite_or_none(raw.get("directDistance"))
        if distance is not None:
            sample["distance"] = distance

        samples.append(sample)
    return samples


def _is_running(activity_type: str) -> bool:
    """Whether a normalized Garmin type is a run, whose cadence is per leg."""
    return "run" in activity_type


def _cadence(raw: dict, activity_type: str) -> float | None:
    """Resolve cadence in the unit Garmin Connect displays.

    Running cadence is counted in total steps per minute: Garmin's
    `directDoubleCadence` already holds that, while `directCadence` is the
    per-leg half and is doubled for runs. Cycling cadence is the pedalling rate
    in rpm, reported by `directBikeCadence` (or `directCadence` as a fallback).
    `directFractionalCadence` is only the sub-unit remainder of `directCadence`,
    never a cadence on its own, so reading it alone yields 0 or 1.
    """
    double = _finite_or_none(raw.get("directDoubleCadence"))
    if double is not None and double > 0:
        return double

    bike = _finite_or_none(raw.get("directBikeCadence"))
    if bike is not None:
        return bike

    cadence = _finite_or_none(raw.get("directCadence"))
    if cadence is None:
        return None
    fraction = _finite_or_none(raw.get("directFractionalCadence"))
    if fraction is not None and 0 <= fraction < 1:
        cadence += fraction
    return cadence * 2 if _is_running(activity_type) else cadence


def _finite_or_none(value) -> float | None:
    """Return a finite float, or None for missing/non-numeric values."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _first_positive(*values) -> float | None:
    """Return the first finite value above zero, or None when none is usable."""
    for value in values:
        number = _finite_or_none(value)
        if number is not None and number > 0:
            return number
    return None


def _epoch_iso(value) -> str | None:
    """Convert Garmin's epoch-millisecond timestamp to an ISO 8601 UTC string."""
    milliseconds = _finite_or_none(value)
    if milliseconds is None:
        return None
    try:
        moment = datetime.fromtimestamp(milliseconds / 1000, tz=UTC)
    except (OverflowError, OSError, ValueError):
        return None
    return moment.isoformat().replace("+00:00", "Z")


def normalize_type(activity_type) -> str:
    """Lowercase the Garmin activity type key so it matches non-Garmin sources."""
    if not activity_type:
        return "unknown"
    if isinstance(activity_type, dict):
        key = activity_type.get("typeKey")
        return str(key).lower() if key else "unknown"
    return activity_type.lower()


def _iso(value) -> str:
    """Normalize a Garmin timestamp to an ISO 8601 UTC string."""
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return value.astimezone(UTC).isoformat().replace("+00:00", "Z")
    text = str(value)
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return text
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _http_error(exc: Exception) -> HTTPException:
    """Map a sidecar domain error to an HTTP response."""
    if isinstance(exc, _LoginError):
        return HTTPException(status_code=401, detail=str(exc))
    if isinstance(exc, _MfaRequiredError):
        return HTTPException(status_code=403, detail=str(exc))
    if isinstance(exc, _RateLimitedError):
        return HTTPException(status_code=429, detail=str(exc))
    if isinstance(exc, _UpstreamError):
        return HTTPException(status_code=502, detail=str(exc))
    logger.exception("unhandled sidecar error")
    return HTTPException(status_code=500, detail="internal sidecar error")


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "killingit-garmin-sidecar"}


@app.post("/authenticate", status_code=204)
def authenticate(credentials: Credentials):
    try:
        _login(credentials)
    except Exception as exc:  # noqa: BLE001 - translated to HTTP below
        raise _http_error(exc) from exc
    return None


@app.post("/sync")
def sync(credentials: Credentials) -> dict:
    try:
        return {"activities": _sync(credentials)}
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 - translated to HTTP below
        raise _http_error(exc) from exc


@app.post("/metrics")
def metrics(credentials: Credentials) -> dict:
    try:
        return _sync_metrics(credentials)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 - translated to HTTP below
        raise _http_error(exc) from exc


@app.post("/daily")
def daily(request: DailyRequest) -> dict:
    if not _is_plain_date(request.date):
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
    try:
        return _sync_daily(request, request.date)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 - translated to HTTP below
        raise _http_error(exc) from exc


def _run() -> None:
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))


if __name__ == "__main__":
    _run()
