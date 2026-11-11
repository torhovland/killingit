"""Unit tests for the Garmin sidecar's pure logic (normalization + filtering).

These tests exercise `_to_activity`, `normalize_type`, and `_iso` without a
live Garmin account or network.
"""

from datetime import UTC, datetime, timedelta

import pytest
from garminconnect import GarminConnectTooManyRequestsError

import app as sidecar
from app import (
    MAX_LAPS,
    SYNC_WINDOW_DAYS,
    Credentials,
    _body_fat_percent,
    _date_window,
    _iso,
    _metric_date,
    _sync_daily,
    _to_activity,
    _to_body_metrics,
    _to_ftp_history,
    _to_laps,
    _to_samples,
    _to_strength_sets,
    _weight_kg,
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
        "startTimeGMT": datetime(2026, 10, 1, 4, 30, 0),
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
        "startDate": "2026-10-01T04:30:00Z",
        "distance": 5000.0,
        "movingTime": 1500.0,
        "elapsedTime": 1600.0,
        "totalElevationGain": 55.0,
        "averageSpeed": 5000.0 / 1500.0,
        "samples": samples,
    }


def test_to_activity_keeps_recorded_average_and_max_speed():
    raw = {
        "activityId": 42,
        "activityName": "Morning Run",
        "activityType": {"typeKey": "RUNNING"},
        "startTimeGMT": datetime(2026, 10, 1, 4, 30, 0),
        "distance": 5000,
        "movingDuration": 1500,
        "duration": 1600,
        "averageSpeed": 3.2,
        "maxSpeed": 4.1,
    }
    activity = _to_activity(raw)
    assert activity["averageSpeed"] == 3.2
    assert activity["maxSpeed"] == 4.1


def test_to_activity_derives_average_speed_when_the_source_leaves_it_zero():
    # Indoor rowing records distance in some payloads but leaves averageSpeed
    # at zero, so the mean is derived from distance and moving time.
    raw = {
        "activityId": 42,
        "activityName": "Indoor Rowing",
        "activityType": {"typeKey": "INDOOR_ROWING"},
        "startTimeGMT": datetime(2026, 10, 1, 4, 30, 0),
        "distance": 2000,
        "movingDuration": 480,
        "duration": 500,
        "averageSpeed": 0.0,
    }
    assert _to_activity(raw)["averageSpeed"] == 2000 / 480


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
    assert start == "2026-09-08"
    assert (
        datetime.fromisoformat(end).date() - datetime.fromisoformat(start).date()
    ).days == SYNC_WINDOW_DAYS


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
    details = _details([1790836200000, 59.91, 10.75, 140, 250, 12.5, 3.2, 1000, 20, 80])
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


def test_to_samples_falls_back_to_enhanced_speed():
    details = _details(
        [1790836200000, 4.2],
        descriptors=[(0, "directTimestamp"), (1, "directEnhancedSpeed")],
    )
    assert _to_samples(details) == [
        {
            "timestamp": "2026-10-01T06:30:00Z",
            "speed": 4.2,
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
            (3, "directCadence"),
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


def test_to_samples_never_reads_fractional_cadence_as_cadence():
    # `directFractionalCadence` is the sub-revolution remainder (0..1); reading
    # it alone made every running sample report a cadence of 0 or 1.
    details = _details(
        [1790836200000, 0.0],
        descriptors=[(0, "directTimestamp"), (1, "directFractionalCadence")],
    )
    assert _to_samples(details, "running") == [{"timestamp": "2026-10-01T06:30:00Z"}]


def test_to_samples_uses_double_cadence_for_running():
    details = _details(
        [1790836200000, 152, 76, 0.5],
        descriptors=[
            (0, "directTimestamp"),
            (1, "directDoubleCadence"),
            (2, "directCadence"),
            (3, "directFractionalCadence"),
        ],
    )
    assert _to_samples(details, "running")[0]["cadence"] == 152.0


def test_to_samples_doubles_the_per_leg_cadence_for_running():
    # Devices that only report the per-leg value: Garmin Connect shows the
    # total, so a 76-per-leg run is 152 steps per minute.
    details = _details(
        [1790836200000, 76, 0.25],
        descriptors=[
            (0, "directTimestamp"),
            (1, "directCadence"),
            (2, "directFractionalCadence"),
        ],
    )
    assert _to_samples(details, "trail_running")[0]["cadence"] == 152.5


def test_to_samples_keeps_pedalling_cadence_for_cycling():
    details = _details(
        [1790836200000, 90, 0.5],
        descriptors=[
            (0, "directTimestamp"),
            (1, "directCadence"),
            (2, "directFractionalCadence"),
        ],
    )
    assert _to_samples(details, "indoor_cycling")[0]["cadence"] == 90.5


def test_to_samples_keeps_stroke_cadence_for_rowing():
    details = _details(
        [1790836200000, 19.0, 0.5],
        descriptors=[
            (0, "directTimestamp"),
            (1, "directStrokeCadence"),
            (2, "directFractionalCadence"),
        ],
    )
    assert _to_samples(details, "indoor_rowing")[0]["cadence"] == 19.0


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
    assert (
        _to_samples(_details([1790836200000, 1200, 1100], descriptors=descriptors))[0][
            "distance"
        ]
        == 1200.0
    )
    assert (
        _to_samples(_details([1790836200000, None, 1100], descriptors=descriptors))[0][
            "distance"
        ]
        == 1100.0
    )


def test_to_laps_maps_a_real_shaped_lap_payload():
    # Representative Garmin `get_activity_splits` payload: an interval workout
    # whose lap field names match what Connect returns.
    payload = {
        "activityId": 42,
        "lapDTOs": [
            {
                "lapIndex": 1,
                "intensityType": "ACTIVE",
                "startTimeGMT": "2026-10-01T06:30:00.0",
                "duration": 600.0,
                "movingDuration": 590.0,
                "distance": 3000.0,
                "averageHR": 135.0,
                "maxHR": 142.0,
                "averagePower": 180.0,
                "maxPower": 260.0,
                "averageSpeed": 5.0,
                "averageBikeCadence": 88.0,
                "elevationGain": 12.0,
            },
            {
                "lapIndex": 2,
                "intensityType": "ACTIVE",
                "duration": 240.0,
                "movingDuration": 240.0,
                "distance": 1200.0,
                "averageHR": 168.0,
                "maxHR": 175.0,
                "averagePower": 350.0,
                "maxPower": 420.0,
                "averageSpeed": 5.0,
            },
        ],
    }

    assert _to_laps(payload) == [
        {
            "index": 1,
            "type": "active",
            "startTime": "2026-10-01T06:30:00Z",
            "distance": 3000.0,
            "movingTime": 590.0,
            "elapsedTime": 600.0,
            "averageHeartRate": 135.0,
            "maxHeartRate": 142.0,
            "averagePower": 180.0,
            "maxPower": 260.0,
            "averageSpeed": 5.0,
            "averageCadence": 88.0,
            "totalElevationGain": 12.0,
        },
        {
            "index": 2,
            "type": "active",
            "distance": 1200.0,
            "movingTime": 240.0,
            "elapsedTime": 240.0,
            "averageHeartRate": 168.0,
            "maxHeartRate": 175.0,
            "averagePower": 350.0,
            "maxPower": 420.0,
            "averageSpeed": 5.0,
        },
    ]


def test_to_laps_reads_alternate_keys_and_omits_absent_channels():
    payload = {
        "lapDTOs": [
            {
                "lap": 7,
                "lapType": "INTERVAL",
                "avgHR": 150,
                "avgPower": 300,
                "avgSpeed": 4.2,
                "avgCadence": 90,
            }
        ]
    }

    assert _to_laps(payload) == [
        {
            "index": 7,
            "type": "interval",
            "averageHeartRate": 150.0,
            "averagePower": 300.0,
            "averageSpeed": 4.2,
            "averageCadence": 90.0,
        }
    ]


def test_to_laps_drops_a_lap_with_no_recorded_values():
    assert _to_laps({"lapDTOs": [{"lapIndex": 1}, {"lapIndex": 2, "distance": 0}]}) == [
        {"index": 2, "distance": 0.0}
    ]


def test_to_laps_falls_back_to_position_and_caps_the_list():
    payload = {"lapDTOs": [{"distance": 1000}] * (MAX_LAPS + 5)}
    laps = _to_laps(payload)
    assert len(laps) == MAX_LAPS
    assert laps[0]["index"] == 1
    assert laps[-1]["index"] == MAX_LAPS


def test_to_laps_tolerates_a_malformed_payload():
    assert _to_laps({}) == []
    assert _to_laps({"lapDTOs": None}) == []
    assert _to_laps({"lapDTOs": ["not a lap"]}) == []


class _FakeGarmin:
    """Stubs the library calls used by _sync."""

    def __init__(self, details, failing_ids=(), splits=None, failing_split_ids=()):
        self.details = details
        self.failing_ids = set(failing_ids)
        self.splits = splits or {}
        self.failing_split_ids = set(failing_split_ids)
        self.requested_ids = []
        self.requested_split_ids = []

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

    def get_activity_splits(self, activity_id):
        self.requested_split_ids.append(activity_id)
        if activity_id in self.failing_split_ids:
            raise RuntimeError("splits unavailable")
        return self.splits.get(activity_id, {})


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


def test_sync_attaches_laps_and_survives_a_failed_splits_fetch(monkeypatch):
    fake = _FakeGarmin(
        details=_details(
            [1790836200000, 140],
            descriptors=[(0, "directTimestamp"), (1, "directHeartRate")],
        ),
        splits={
            "1": {
                "lapDTOs": [
                    {"lapIndex": 1, "distance": 2500, "averagePower": 250},
                    {"lapIndex": 2, "distance": 2500, "averagePower": 260},
                ]
            }
        },
        failing_split_ids={"2"},
    )
    monkeypatch.setattr(sidecar, "_login", lambda credentials: fake)

    activities = sidecar._sync(Credentials(username="u", password="p"))

    assert fake.requested_split_ids == ["1", "2"]
    assert activities[0]["laps"] == [
        {"index": 1, "distance": 2500.0, "averagePower": 250.0},
        {"index": 2, "distance": 2500.0, "averagePower": 260.0},
    ]
    assert "laps" not in activities[1]


def test_to_activity_ignores_a_single_lap():
    raw = {"activityId": 1, "activityType": {"typeKey": "RUNNING"}}
    one_lap = [{"index": 1, "distance": 5000.0}]
    two_laps = [*one_lap, dict(index=2, distance=1000.0)]

    # A single lap is the whole activity restated, not interval structure.
    assert "laps" not in _to_activity(raw, laps=one_lap)
    assert _to_activity(raw, laps=two_laps)["laps"] == two_laps


def test_sync_maps_a_splits_rate_limit_to_rate_limited(monkeypatch):
    class _RateLimitedFake(_FakeGarmin):
        def get_activity_splits(self, activity_id):
            raise GarminConnectTooManyRequestsError("429")

    monkeypatch.setattr(
        sidecar, "_login", lambda credentials: _RateLimitedFake(details={})
    )

    with pytest.raises(sidecar._RateLimitedError):
        sidecar._sync(Credentials(username="u", password="p"))


def test_sync_maps_a_detail_rate_limit_to_rate_limited(monkeypatch):
    class _RateLimitedFake(_FakeGarmin):
        def get_activity_details(self, activity_id):
            raise GarminConnectTooManyRequestsError("429")

    monkeypatch.setattr(
        sidecar, "_login", lambda credentials: _RateLimitedFake(details={})
    )

    with pytest.raises(sidecar._RateLimitedError):
        sidecar._sync(Credentials(username="u", password="p"))


def test_to_body_metrics_normalizes_weight_and_body_fat():
    payload = {
        "dateWeightList": [
            {
                "calendarDate": "2026-10-01",
                "weight": 78500,
                "bodyFat": 24.5,
                "unitKey": "g",
            },
            {
                "calendarDate": "2026-10-02",
                "weight": 78.0,
                "unitKey": "kg",
                "weightUnit": "kg",
            },
        ]
    }

    assert _to_body_metrics(payload) == [
        {"date": "2026-10-01", "weightKg": 78.5, "bodyFatPercent": 24.5},
        {"date": "2026-10-02", "weightKg": 78.0},
    ]


def test_weight_converts_pounds_and_grams():
    assert _weight_kg({"weight": 172.0, "unitKey": "lbs"}) == 78.02
    assert _weight_kg({"weight": 78500}) == 78.5
    assert _weight_kg({"weight": 78.0}) == 78.0
    assert _weight_kg({"weight": 0}) is None


def test_body_fat_accepts_fraction_and_rejects_impossible_values():
    assert _body_fat_percent({"bodyFat": 0.245}) == 24.5
    assert _body_fat_percent({"percentFat": 18.2}) == 18.2
    assert _body_fat_percent({"bodyFat": 80}) is None


def test_metric_date_reads_calendar_date_and_epoch():
    assert _metric_date({"calendarDate": "2026-10-01"}) == "2026-10-01"
    assert (
        _metric_date({"timestampGMT": 1790836200000})
        == datetime.fromtimestamp(1790836200, tz=UTC).date().isoformat()
    )


def test_sync_metrics_uses_body_composition(monkeypatch):
    class _MetricsFake:
        def get_body_composition(self, startdate, enddate):
            return {"dateWeightList": [{"calendarDate": "2026-10-01", "weight": 78000}]}

        def get_functional_threshold_power_range(
            self, startdate, enddate, *, sport, aggregation
        ):
            return [
                {
                    "calendarDate": "2026-10-01",
                    "functionalThresholdPower": 255,
                }
            ]

    monkeypatch.setattr(sidecar, "_login", lambda credentials: _MetricsFake())

    assert sidecar._sync_metrics(Credentials(username="u", password="p")) == {
        "metrics": [{"date": "2026-10-01", "weightKg": 78.0}],
        "ftp": [{"date": "2026-10-01", "watts": 255}],
    }


def test_metrics_route_returns_the_flat_response_the_api_expects(monkeypatch):
    snapshot = {
        "metrics": [{"date": "2026-10-01", "weightKg": 78.0}],
        "ftp": [{"date": "2026-10-01", "watts": 255}],
    }
    monkeypatch.setattr(sidecar, "_sync_metrics", lambda credentials: snapshot)

    assert sidecar.metrics(Credentials(username="u", password="p")) == snapshot


def test_to_ftp_history_handles_lists_and_nested_records():
    assert _to_ftp_history(
        [
            {"calendarDate": "2026-10-01", "functionalThresholdPower": 250},
            {"calendarDate": "2026-10-02", "ftp": {"value": 255}},
            {"calendarDate": "2026-10-03", "value": 20},
        ]
    ) == [
        {"date": "2026-10-01", "watts": 250},
        {"date": "2026-10-02", "watts": 255},
    ]
    assert _to_ftp_history(
        {"functionalThresholdPower": [{"calendarDate": "2026-10-01", "value": 260}]}
    ) == [{"date": "2026-10-01", "watts": 260}]


def test_to_strength_sets_maps_exercises_reps_and_grams():
    payload = {
        "exerciseSets": [
            {
                "setType": "ACTIVE",
                "startTime": "2026-10-27T17:05:00+02:00",
                "duration": 45.0,
                "repetitionCount": 10,
                "weight": 12000,
                "exercises": [{"category": "SQUAT", "name": "GOBLET_SQUAT"}],
            },
            {
                "setType": "REST",
                "duration": 60.0,
                "exercises": [],
            },
        ]
    }

    assert _to_strength_sets(payload) == [
        {
            "setType": "active",
            "startTime": "2026-10-27T15:05:00Z",
            "durationSeconds": 45.0,
            "repetitions": 10,
            "weightKg": 12.0,
            "exercises": [{"category": "SQUAT", "name": "GOBLET_SQUAT"}],
        },
        {"setType": "rest", "durationSeconds": 60.0},
    ]


def test_to_strength_sets_drops_empty_sets_and_caps_length():
    payload = {
        "exerciseSets": [
            {"setType": "ACTIVE", "exercises": []},
            *[
                {"setType": "ACTIVE", "repetitionCount": 1, "exercises": []}
                for _ in range(sidecar.MAX_STRENGTH_SETS + 5)
            ],
        ]
    }

    assert len(_to_strength_sets(payload)) == sidecar.MAX_STRENGTH_SETS


class _DailyFake:
    def get_stats(self, date):
        return {
            "restingHeartRate": 52,
            "sleepingSeconds": 25200,
            "averageStressLevel": 31,
            "bodyBatteryHighestValue": 88,
            "bodyBatteryLowestValue": 24,
            "totalSteps": 8200,
            "activeKilocalories": 640,
            "moderateIntensityMinutes": 20,
            "vigorousIntensityMinutes": 5,
        }

    def get_sleep_data(self, date):
        # Mirrors the real Garmin payload: overnight HRV sits at the top level,
        # while SpO2 is averageSpO2Value inside dailySleepDTO. The DTO-level
        # avgSleepHRV/avgSpO2 keys are legacy fallbacks.
        return {
            "avgOvernightHrv": 48,
            "dailySleepDTO": {
                "sleepTimeSeconds": 25800,
                "sleepScores": {"overall": {"value": 82}},
                "deepSleepSeconds": 4200,
                "lightSleepSeconds": 14400,
                "remSleepSeconds": 5400,
                "awakeSleepSeconds": 600,
                "averageSpO2Value": 96,
                "averageRespirationValue": 14.2,
            },
        }

    def get_training_readiness(self, date):
        return [
            {"timestamp": "2026-11-02T06:00:00", "score": 74, "recoveryTime": 720},
            {"timestamp": "2026-11-02T08:00:00", "score": 78, "recoveryTime": 600},
        ]

    def get_max_metrics(self, date):
        # Garmin's daily endpoint returns a list of records, not a bare dict.
        return [
            {
                "generic": {"vo2MaxPreciseValue": 48.5},
                "cycling": {"vo2MaxValue": 43},
            }
        ]


def test_sync_daily_combines_bundle_sleep_readiness_and_vo2max(monkeypatch):
    monkeypatch.setattr(sidecar, "_login", lambda credentials: _DailyFake())

    assert _sync_daily(Credentials(username="u", password="p"), "2026-11-02") == {
        "date": "2026-11-02",
        "metrics": {
            "resting_heart_rate": 52,
            "sleep_duration": 430.0,
            "stress": 31,
            "body_battery_high": 88,
            "body_battery_low": 24,
            "steps": 8200,
            "active_calories": 640,
            "intensity_minutes": 30,
            "sleep_score": 82,
            "deep_sleep": 70.0,
            "light_sleep": 240.0,
            "rem_sleep": 90.0,
            "awake_sleep": 10.0,
            "hrv": 48,
            "spo2": 96,
            "respiration": 14.2,
            "training_readiness": 78,
            "recovery_time": 600,
            "vo2max": 48.5,
            "vo2max_cycling": 43,
        },
    }


def test_sync_daily_omits_sleep_until_the_night_is_confirmed(monkeypatch):
    class _UnconfirmedSleep(_DailyFake):
        def get_stats(self, date):
            stats = super().get_stats(date)
            stats["sleepingSeconds"] = 0
            return stats

        def get_sleep_data(self, date):
            return {
                "dailySleepDTO": {
                    "sleepWindowConfirmed": False,
                    "sleepTimeSeconds": 0,
                    "sleepScores": {"overall": {"value": 0}},
                    "deepSleepSeconds": 0,
                    "lightSleepSeconds": 0,
                    "remSleepSeconds": 0,
                    "awakeSleepSeconds": 0,
                    "averageSpO2Value": 0,
                    "averageRespirationValue": 0,
                },
            }

    monkeypatch.setattr(sidecar, "_login", lambda credentials: _UnconfirmedSleep())

    result = _sync_daily(Credentials(username="u", password="p"), "2026-11-02")

    assert "sleep_duration" not in result["metrics"]
    assert "sleep_score" not in result["metrics"]
    assert "deep_sleep" not in result["metrics"]
    assert result["metrics"]["resting_heart_rate"] == 52


def test_sync_daily_omits_a_zero_sleep_without_a_confirmation_flag(monkeypatch):
    class _EmptySleep(_DailyFake):
        def get_stats(self, date):
            stats = super().get_stats(date)
            stats["sleepingSeconds"] = 0
            return stats

        def get_sleep_data(self, date):
            return {
                "dailySleepDTO": {
                    "sleepTimeSeconds": 0,
                    "sleepScores": {"overall": {"value": 0}},
                    "deepSleepSeconds": 0,
                    "lightSleepSeconds": 0,
                    "remSleepSeconds": 0,
                    "awakeSleepSeconds": 0,
                },
            }

    monkeypatch.setattr(sidecar, "_login", lambda credentials: _EmptySleep())

    result = _sync_daily(Credentials(username="u", password="p"), "2026-11-02")

    assert "sleep_duration" not in result["metrics"]
    assert "sleep_score" not in result["metrics"]


def test_sync_daily_tolerates_one_failed_source(monkeypatch):
    class _PartlyBroken(_DailyFake):
        def get_sleep_data(self, date):
            raise RuntimeError("sleep unavailable")

        def get_training_readiness(self, date):
            raise RuntimeError("readiness unavailable")

        def get_max_metrics(self, date):
            raise RuntimeError("max metrics unavailable")

    monkeypatch.setattr(sidecar, "_login", lambda credentials: _PartlyBroken())

    result = _sync_daily(Credentials(username="u", password="p"), "2026-11-02")
    assert result["metrics"]["resting_heart_rate"] == 52
    assert "sleep_score" not in result["metrics"]


def test_sync_daily_propagates_rate_limit(monkeypatch):
    class _RateLimited(_DailyFake):
        def get_sleep_data(self, date):
            raise GarminConnectTooManyRequestsError("429")

    monkeypatch.setattr(sidecar, "_login", lambda credentials: _RateLimited())

    with pytest.raises(sidecar._RateLimitedError):
        _sync_daily(Credentials(username="u", password="p"), "2026-11-02")
