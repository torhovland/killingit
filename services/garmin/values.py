"""Value and date helpers shared by the sidecar's normalisers.

Garmin reports the same handful of shapes everywhere: finite numbers or nulls,
plain and timestamped dates, and values that only make sense inside a plausible
range. One implementation here keeps a rule such as "a zero sleep is not a
night" or the 42-day sync window from drifting between endpoints. See ADR 0058.
"""

from __future__ import annotations

import math
from datetime import UTC, datetime, timedelta
from typing import Any

# Number of days of history to sync (inclusive window ending today). This
# matches the chronic-training-load window used by the plan's ATL/CTL numbers.
SYNC_WINDOW_DAYS = 42


def date_window(now: datetime | None = None) -> tuple[str, str]:
    """Return the inclusive (start, end) dates for the sync window, YYYY-MM-DD.

    `get_activities_by_date` requires plain dates, not ISO timestamps.
    """
    end = (now or datetime.now(UTC)).date()
    start = end - timedelta(days=SYNC_WINDOW_DAYS)
    return start.isoformat(), end.isoformat()


def is_plain_date(value: str) -> bool:
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        return False
    return True


def finite_or_none(value: Any) -> float | None:
    """Return a finite float, or None for missing/non-numeric values."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def first_positive(*values: Any) -> float | None:
    """Return the first finite value above zero, or None when none is usable."""
    for value in values:
        number = finite_or_none(value)
        if number is not None and number > 0:
            return number
    return None


def first_nonnegative(*values: Any) -> float | None:
    """Return the first finite value at or above zero, or None."""
    for value in values:
        number = finite_or_none(value)
        if number is not None and number >= 0:
            return number
    return None


def first_value(payload: dict, *keys: str) -> Any:
    for key in keys:
        value = payload.get(key)
        if value is not None:
            return value
    return None


def put_metric(
    metrics: dict[str, float],
    key: str,
    value: Any,
    minimum: float,
    maximum: float,
    decimals: int = 0,
) -> None:
    """Store a finite value inside its plausible range, rounded for display."""
    number = finite_or_none(value)
    if number is None or not minimum <= number <= maximum:
        return
    metrics[key] = round(number, decimals)


def seconds_to_minutes(value: Any) -> float | None:
    seconds = finite_or_none(value)
    if seconds is None:
        return None
    return seconds / 60


def iso(value: Any) -> str:
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


def epoch_iso(value: Any) -> str | None:
    """Convert Garmin's epoch-millisecond timestamp to an ISO 8601 UTC string."""
    milliseconds = finite_or_none(value)
    if milliseconds is None:
        return None
    try:
        moment = datetime.fromtimestamp(milliseconds / 1000, tz=UTC)
    except (OverflowError, OSError, ValueError):
        return None
    return moment.isoformat().replace("+00:00", "Z")


def metric_date(raw: dict) -> str | None:
    """Read a YYYY-MM-DD date from a Garmin weigh-in entry."""
    for key in ("calendarDate", "date"):
        value = raw.get(key)
        if isinstance(value, str) and len(value) >= 10:
            candidate = value[:10]
            if is_plain_date(candidate):
                return candidate
    for key in ("sampleTimeGMT", "timestampGMT", "gmtTimestamp", "dateTimestamp"):
        value = raw.get(key)
        if isinstance(value, str):
            candidate = value[:10]
            if is_plain_date(candidate):
                return candidate
        milliseconds = finite_or_none(value)
        if milliseconds is not None:
            try:
                return (
                    datetime.fromtimestamp(milliseconds / 1000, tz=UTC)
                    .date()
                    .isoformat()
                )
            except (OverflowError, OSError, ValueError):
                continue
    return None
