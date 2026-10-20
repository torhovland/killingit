"""Unit tests for the Garmin sidecar's pure logic (normalization + filtering).

These tests exercise `_to_activity`, `normalize_type`, and `_iso` without a
live Garmin account or network.
"""

from datetime import UTC, datetime, timedelta

from app import SYNC_WINDOW_DAYS, _date_window, _iso, _to_activity, normalize_type


def test_normalize_type_lowercases_type_key():
    assert normalize_type({"typeKey": "RUNNING"}) == "running"
    assert normalize_type("running") == "running"
    assert normalize_type({"typeId": 1}) == "unknown"


def test_normalize_type_handles_plain_string():
    assert normalize_type("Cycling") == "cycling"


def test_iso_normalizes_datetime_to_utc_z():
    dt = datetime(2026, 10, 1, 6, 30, 0)
    assert _iso(dt) == "2026-10-01T06:30:00Z"


def test_iso_passes_through_non_iso_text():
    assert _iso("not a date") == "not a date"


def test_iso_normalizes_iso_string():
    assert _iso("2026-10-01T06:30:00+02:00") == "2026-10-01T04:30:00Z"


def test_to_activity_maps_known_fields():
    raw = {
        "activityId": 42,
        "activityName": "Morning Run",
        "activityType": {"typeKey": "RUNNING"},
        "startTimeLocal": datetime(2026, 10, 1, 6, 30, 0),
        "distance": 5000,
        "movingDuration": 1500,
        "duration": 1600,
        "elevationGain": 55,
    }
    assert _to_activity(raw) == {
        "id": 42,
        "name": "Morning Run",
        "type": "running",
        "startDate": "2026-10-01T06:30:00Z",
        "distance": 5000.0,
        "movingTime": 1500.0,
        "elapsedTime": 1600.0,
        "totalElevationGain": 55.0,
    }


def test_to_activity_defaults_missing_numeric_fields():
    raw = {
        "activityId": 1,
        "activityName": "",
        "activityType": {"typeKey": "OTHER"},
        "startTimeLocal": datetime(2026, 10, 1, 0, 0, 0),
    }
    result = _to_activity(raw)
    assert result["distance"] == 0.0
    assert result["movingTime"] == 0.0
    assert result["elapsedTime"] == 0.0
    assert result["totalElevationGain"] == 0.0


def test_date_window_returns_plain_dates():
    # Garmin's get_activities_by_date requires YYYY-MM-DD, not ISO timestamps.
    now = datetime(2026, 10, 20, 15, 30, tzinfo=UTC)
    start, end = _date_window(now)
    assert end == "2026-10-20"
    assert start == "2026-09-19"
    assert (datetime.fromisoformat(end).date() - datetime.fromisoformat(start).date()).days == SYNC_WINDOW_DAYS


def test_date_window_defaults_to_now():
    start, end = _date_window()
    assert len(start) == 10 and start[4] == "-" and start[7] == "-"
    assert len(end) == 10 and end[4] == "-" and end[7] == "-"
    span = datetime.fromisoformat(end).date() - datetime.fromisoformat(start).date()
    assert span == timedelta(days=SYNC_WINDOW_DAYS)