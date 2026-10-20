"""Unit tests for the Garmin sidecar's pure logic (normalization + filtering).

These tests exercise `_to_activity`, `normalize_type`, and `_iso` without a
live Garmin account or network.
"""

from datetime import UTC, datetime, timedelta

import pytest
from garminconnect import GarminConnectTooManyRequestsError

import app as sidecar
from app import (
    SYNC_WINDOW_DAYS,
    Credentials,
    _date_window,
    _iso,
    _to_activity,
    _to_samples,
    normalize_type,
)


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
    samples = [{"timestamp": "2026-10-01T06:30:00Z", "heartRate": 140.0}]
    assert _to_activity(raw, samples) == {
        "id": 42,
        "name": "Morning Run",
        "type": "running",
        "startDate": "2026-10-01T06:30:00Z",
        "distance": 5000.0,
        "movingTime": 1500.0,
        "elapsedTime": 1600.0,
        "totalElevationGain": 55.0,
        "samples": samples,
    }


def test_to_activity_defaults_to_empty_samples():
    raw = {
        "activityId": 1,
        "activityName": "",
        "activityType": {"typeKey": "OTHER"},
        "startTimeLocal": datetime(2026, 10, 1, 0, 0, 0),
    }
    assert _to_activity(raw)["samples"] == []


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


# Garmin reports activity details as positional metrics; metricDescriptors maps
# each position to a key. Values are epoch milliseconds / SI-ish units.
def _details(*samples, descriptors=None):
    if descriptors is None:
        descriptors = [
            (0, "directTimestamp"),
            (1, "directLatitude"),
            (2, "directLongitude"),
            (3, "directHeartRate"),
            (4, "directPower"),
            (5, "directAirTemperature"),
            (6, "directSpeed"),
            (7, "sumDistance"),
            (8, "directCorrectedElevation"),
            (9, "directBikeCadence"),
        ]
    return {
        "metricDescriptors": [
            {"metricsIndex": index, "key": key} for index, key in descriptors
        ],
        "activityDetailMetrics": [{"metrics": list(sample)} for sample in samples],
    }


def test_to_samples_maps_known_metrics():
    details = _details(
        [1790836200000, 59.91, 10.75, 140, 250, 12.5, 3.2, 1000, 20, 80]
    )
    assert _to_samples(details) == [
        {
            "timestamp": "2026-10-01T06:30:00Z",
            "latitude": 59.91,
            "longitude": 10.75,
            "heartRate": 140.0,
            "power": 250.0,
            "temperature": 12.5,
            "speed": 3.2,
            "distance": 1000.0,
            "elevation": 20.0,
            "cadence": 80.0,
        }
    ]


def test_to_samples_skips_samples_without_a_timestamp():
    details = _details(
        [140],
        descriptors=[(0, "directHeartRate")],
    )
    assert _to_samples(details) == []


def test_to_samples_omits_absent_and_non_numeric_channels():
    details = _details(
        [1790836200000, None, 10.75],
        descriptors=[
            (0, "directTimestamp"),
            (1, "directHeartRate"),
            (2, "directLongitude"),
        ],
    )
    assert _to_samples(details) == [
        {
            "timestamp": "2026-10-01T06:30:00Z",
            "longitude": 10.75,
        }
    ]


def test_to_samples_supports_alternate_metric_keys():
    details = _details(
        [1790836200000, 12.5, 20, 80],
        descriptors=[
            (0, "directTimestamp"),
            (1, "directTemperature"),
            (2, "directUncorrectedElevation"),
            (3, "directFractionalCadence"),
        ],
    )
    assert _to_samples(details) == [
        {
            "timestamp": "2026-10-01T06:30:00Z",
            "temperature": 12.5,
            "elevation": 20.0,
            "cadence": 80.0,
        }
    ]


def test_to_samples_prefers_primary_metric_aliases():
    details = _details(
        [1790836200000, 20, 18, 12.5, 11.0, 80, 82],
        descriptors=[
            (0, "directTimestamp"),
            (1, "directCorrectedElevation"),
            (2, "directElevation"),
            (3, "directAirTemperature"),
            (4, "directTemperature"),
            (5, "directBikeCadence"),
            (6, "directFractionalCadence"),
        ],
    )
    assert _to_samples(details) == [
        {
            "timestamp": "2026-10-01T06:30:00Z",
            "elevation": 20.0,
            "temperature": 12.5,
            "cadence": 80.0,
        }
    ]


def test_to_samples_prefers_sum_distance_and_falls_back_to_direct_distance():
    descriptors = [
        (0, "directTimestamp"),
        (1, "sumDistance"),
        (2, "directDistance"),
    ]
    assert _to_samples(_details([1790836200000, 1200, 1100], descriptors=descriptors))[
        0
    ]["distance"] == 1200.0
    assert _to_samples(_details([1790836200000, None, 1100], descriptors=descriptors))[
        0
    ]["distance"] == 1100.0


class _FakeGarmin:
    """Stubs the two library calls used by _sync."""

    def __init__(self, details, failing_ids=()):
        self.details = details
        self.failing_ids = set(failing_ids)
        self.requested_ids = []

    def get_activities_by_date(self, startdate, enddate):
        return [
            {
                "activityId": 1,
                "activityName": "Morning Run",
                "activityType": {"typeKey": "RUNNING"},
                "startTimeLocal": datetime(2026, 10, 1, 6, 30, 0),
            },
            {
                "activityId": 2,
                "activityName": "Evening Ride",
                "activityType": {"typeKey": "CYCLING"},
                "startTimeLocal": datetime(2026, 10, 2, 17, 0, 0),
            },
        ]

    def get_activity_details(self, activity_id):
        self.requested_ids.append(activity_id)
        if activity_id in self.failing_ids:
            raise RuntimeError("details unavailable")
        return self.details


def test_sync_attaches_samples_and_survives_a_failed_detail_fetch(monkeypatch):
    fake = _FakeGarmin(
        details=_details(
            [1790836200000, 140],
            descriptors=[(0, "directTimestamp"), (1, "directHeartRate")],
        ),
        failing_ids={"2"},
    )
    monkeypatch.setattr(sidecar, "_login", lambda credentials: fake)

    activities = sidecar._sync(Credentials(username="u", password="p"))

    assert fake.requested_ids == ["1", "2"]
    assert activities[0]["samples"] == [
        {"timestamp": "2026-10-01T06:30:00Z", "heartRate": 140.0}
    ]
    assert activities[1]["samples"] == []


def test_sync_maps_a_detail_rate_limit_to_rate_limited(monkeypatch):
    class _RateLimitedFake(_FakeGarmin):
        def get_activity_details(self, activity_id):
            raise GarminConnectTooManyRequestsError("429")

    monkeypatch.setattr(
        sidecar, "_login", lambda credentials: _RateLimitedFake(details={})
    )

    with pytest.raises(sidecar._RateLimitedError):
        sidecar._sync(Credentials(username="u", password="p"))