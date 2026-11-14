"""Daily health metrics for `/daily`.

Combines Garmin's daily stats bundle with sleep, training readiness and max
metrics into the stable metric keys of `packages/shared/src/health.ts`. A
failure in one source omits only its values; a Garmin rate limit aborts the
whole day so the caller can stop the backfill and retry later. See ADR 0058.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

import auth
import values
from errors import RateLimitedError, UpstreamError, rate_limited

logger = logging.getLogger("garmin-sidecar")


def sync_daily(credentials: auth.Credentials, date: str) -> dict:
    """Fetch one day's Garmin stats, sleep, readiness and VO2max."""
    garmin = auth.login(credentials)
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
        raise UpstreamError("Garmin daily data unavailable")
    return {"date": date, "metrics": metrics}


def _optional_daily_call(call: Callable[[str], Any], date: str, label: str) -> Any:
    """Call one daily Garmin source, keeping rate limits but tolerating outages."""
    try:
        with rate_limited():
            return call(date)
    except RateLimitedError:
        raise
    except Exception:  # one source must not lose the day
        logger.exception("Garmin %s fetch failed for %s", label, date)
        return None


def _add_stats_metrics(metrics: dict[str, float], stats: dict) -> None:
    """Normalize the fields of Garmin's daily stats bundle."""
    if not isinstance(stats, dict):
        return
    values.put_metric(
        metrics, "resting_heart_rate", stats.get("restingHeartRate"), 20, 250
    )
    # A zero is a day whose sleep has not been processed yet, not a zero-length
    # night. Skipping it keeps the last completed night in the series.
    values.put_metric(
        metrics,
        "sleep_duration",
        values.seconds_to_minutes(stats.get("sleepingSeconds")),
        1,
        24 * 60,
    )
    values.put_metric(metrics, "stress", stats.get("averageStressLevel"), 0, 100)
    values.put_metric(
        metrics, "body_battery_high", stats.get("bodyBatteryHighestValue"), 0, 100
    )
    values.put_metric(
        metrics, "body_battery_low", stats.get("bodyBatteryLowestValue"), 0, 100
    )
    values.put_metric(metrics, "steps", stats.get("totalSteps"), 0, 200_000)
    values.put_metric(
        metrics, "active_calories", stats.get("activeKilocalories"), 0, 20_000
    )
    values.put_metric(metrics, "spo2", stats.get("averageSpo2"), 50, 100)

    moderate = values.finite_or_none(stats.get("moderateIntensityMinutes"))
    vigorous = values.finite_or_none(stats.get("vigorousIntensityMinutes"))
    if moderate is not None or vigorous is not None:
        # Garmin counts a vigorous minute as two intensity minutes.
        total = (moderate or 0) + 2 * (vigorous or 0)
        values.put_metric(metrics, "intensity_minutes", total, 0, 24 * 60 * 2)


def _add_sleep_metrics(metrics: dict[str, float], sleep: dict) -> None:
    """Normalize sleep duration, score, stages and overnight vitals."""
    if not isinstance(sleep, dict):
        return
    dto = sleep.get("dailySleepDTO")
    if not isinstance(dto, dict):
        return
    # Garmin marks a night as confirmed only once its processing is complete.
    # Until then the DTO can be empty or still zero, which must not replace the
    # last completed night with a false zero.
    if dto.get("sleepWindowConfirmed") is False:
        return

    values.put_metric(
        metrics,
        "sleep_duration",
        values.seconds_to_minutes(dto.get("sleepTimeSeconds")),
        1,
        24 * 60,
    )
    scores = dto.get("sleepScores")
    if isinstance(scores, dict):
        overall = scores.get("overall")
        if isinstance(overall, dict):
            values.put_metric(metrics, "sleep_score", overall.get("value"), 1, 100)

    values.put_metric(
        metrics,
        "deep_sleep",
        values.seconds_to_minutes(dto.get("deepSleepSeconds")),
        1,
        24 * 60,
    )
    values.put_metric(
        metrics,
        "light_sleep",
        values.seconds_to_minutes(dto.get("lightSleepSeconds")),
        1,
        24 * 60,
    )
    values.put_metric(
        metrics,
        "rem_sleep",
        values.seconds_to_minutes(dto.get("remSleepSeconds")),
        1,
        24 * 60,
    )
    values.put_metric(
        metrics,
        "awake_sleep",
        values.seconds_to_minutes(dto.get("awakeSleepSeconds")),
        0,
        24 * 60,
    )
    values.put_metric(
        metrics,
        "hrv",
        # Garmin returns overnight HRV at the top level of the sleep response;
        # older payloads carried it inside dailySleepDTO, so keep that fallback.
        values.first_value(sleep, "avgOvernightHrv")
        or values.first_value(dto, "avgSleepHRV", "avgOvernightHrv"),
        0,
        500,
    )
    values.put_metric(
        metrics,
        "spo2",
        values.first_value(dto, "averageSpO2Value", "avgSpO2", "averageSpO2"),
        50,
        100,
    )
    values.put_metric(
        metrics,
        "respiration",
        values.first_value(dto, "averageRespirationValue", "avgRespirationValue"),
        0,
        60,
        decimals=1,
    )


def _add_readiness_metrics(metrics: dict[str, float], readiness) -> None:
    """Normalize the latest training-readiness snapshot for the day."""
    snapshot = _latest_readiness_snapshot(readiness)
    if snapshot is None:
        return
    values.put_metric(metrics, "training_readiness", snapshot.get("score"), 0, 100)
    values.put_metric(metrics, "recovery_time", snapshot.get("recoveryTime"), 0, 10_080)
    # Readiness also carries the sleep score; keep it as a fallback when the
    # sleep endpoint had no score for this day.
    if "sleep_score" not in metrics:
        values.put_metric(metrics, "sleep_score", snapshot.get("sleepScore"), 1, 100)


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
        key=lambda entry: str(
            entry.get("timestamp") or entry.get("timestampLocal") or ""
        ),
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
        values.put_metric(
            metrics,
            "vo2max",
            values.first_value(generic, "vo2MaxPreciseValue", "vo2MaxValue"),
            10,
            100,
            decimals=1,
        )
    cycling = payload.get("cycling")
    if isinstance(cycling, dict):
        values.put_metric(
            metrics,
            "vo2max_cycling",
            values.first_value(cycling, "vo2MaxPreciseValue", "vo2MaxValue"),
            10,
            100,
            decimals=1,
        )
