"""Weigh-in and historic FTP normalization for `/metrics`.

Body composition is the endpoint's primary data; the cycling FTP history is
supplementary, so a failed FTP fetch leaves the weigh-ins intact. See ADR 0058.
"""

from __future__ import annotations

import logging
from typing import Any

import auth
import values
from errors import RateLimitedError, UpstreamError, rate_limited

logger = logging.getLogger("garmin-sidecar")


def sync_metrics(credentials: auth.Credentials) -> dict:
    """Fetch body composition and FTP history for the same sync window.

    Garmin returns weight, body-fat percentage, and other scale data per
    weigh-in. Only the two values the Fitness chart needs are normalized; a
    missing body-fat value is left out instead of being invented. The historic
    cycling FTP is fetched separately and treated as supplementary: a failure
    there does not lose the body measurements.
    """
    garmin = auth.login(credentials)
    startdate, enddate = values.date_window()

    try:
        with rate_limited():
            payload = garmin.get_body_composition(startdate, enddate)
    except RateLimitedError:
        raise
    except Exception as exc:
        logger.exception("Garmin body composition fetch failed")
        raise UpstreamError("Garmin body composition fetch failed") from exc

    return {
        "metrics": to_body_metrics(payload or {}),
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
    except Exception:  # supplementary data must not lose the body metrics
        logger.exception("Garmin FTP history fetch failed")
        return []
    return to_ftp_history(payload)


def to_ftp_history(payload) -> list[dict]:
    """Normalize Garmin's FTP range response into dated watt samples."""
    samples: dict[str, dict] = {}
    for raw in _ftp_records(payload):
        if not isinstance(raw, dict):
            continue
        date = values.metric_date(raw)
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
        number = values.finite_or_none(value)
        if number is not None and 50 <= number <= 2000:
            return round(number)
    return None


def to_body_metrics(payload: dict) -> list[dict]:
    """Normalize Garmin's body-composition payload into daily samples."""
    samples: list[dict] = []
    seen_dates: set[str] = set()
    for raw in payload.get("dateWeightList") or []:
        if not isinstance(raw, dict):
            continue
        date = values.metric_date(raw)
        if date is None or date in seen_dates:
            continue
        weight = weight_kg(raw)
        body_fat = body_fat_percent(raw)
        if weight is None and body_fat is None:
            continue
        sample: dict[str, Any] = {"date": date}
        if weight is not None:
            sample["weightKg"] = weight
        if body_fat is not None:
            sample["bodyFatPercent"] = body_fat
        samples.append(sample)
        seen_dates.add(date)
    return sorted(samples, key=lambda sample: sample["date"])


def weight_kg(raw: dict) -> float | None:
    """Normalize Garmin's weight to kilograms."""
    value = values.finite_or_none(raw.get("weight"))
    if value is None:
        value = values.finite_or_none(raw.get("value"))
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


def body_fat_percent(raw: dict) -> float | None:
    """Normalize a body-fat value to a percentage."""
    value = values.finite_or_none(raw.get("bodyFat"))
    if value is None:
        value = values.finite_or_none(raw.get("percentFat"))
    if value is None:
        value = values.finite_or_none(raw.get("bodyFatPercent"))
    if value is None or value <= 0:
        return None
    if value <= 1:
        value *= 100
    if value > 75:
        return None
    return round(value, 1)
