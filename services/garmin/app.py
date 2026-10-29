"""Garmin activity sync sidecar.

A minimal HTTP service that wraps `python-garminconnect` so the Bun/Hono API
can pull the operator's last 42 days of Garmin activities without adding a
Python runtime to the main backend (see ADR 0003 amendment).

Endpoints:
  POST /authenticate   { "username", "password" } -> 204 (or 401/403/429/502)
  POST /sync           { "username", "password" } -> { "activities": [...] }
  POST /metrics        { "username", "password" } -> { "metrics": [...] }
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
        return [
            _to_activity(
                raw,
                _samples_for(
                    garmin,
                    raw.get("activityId"),
                    normalize_type(raw.get("activityType")),
                ),
            )
            for raw in raw_activities or []
        ]
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


def _to_activity(raw: dict, samples: list[dict] | None = None) -> dict:
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
    return {
        "id": int(raw.get("activityId") or 0),
        "name": raw.get("activityName") or "",
        "type": normalize_type(raw.get("activityType") or "unknown"),
        "startDate": _iso(start) if start else "",
        "distance": _num(raw.get("distance")),
        "movingTime": _num(raw.get("movingDuration")),
        "elapsedTime": _num(raw.get("duration")),
        "totalElevationGain": _num(raw.get("elevationGain")),
        "samples": samples or [],
    }


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
        return {"metrics": _sync_metrics(credentials)}
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 - translated to HTTP below
        raise _http_error(exc) from exc


def _run() -> None:
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))


if __name__ == "__main__":
    _run()
