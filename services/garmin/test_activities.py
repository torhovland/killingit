"""Unit tests for activity, sample, lap and strength-set normalization."""

import re
from datetime import datetime
from pathlib import Path

import pytest
from garminconnect import GarminConnectTooManyRequestsError

import activities
import auth
from activities import (
    MAX_LAPS,
    MAX_STRENGTH_SETS,
    STEP_CADENCE_MARKERS,
    normalize_type,
    to_activity,
    to_laps,
    to_samples,
    to_strength_sets,
)
from errors import RateLimitedError
from support import FakeGarmin, details


def test_normalize_type_lowercases_type_key():
    assert normalize_type({"typeKey": "RUNNING"}) == "running"
    assert normalize_type("running") == "running"
    assert normalize_type({"typeId": 1}) == "unknown"


def test_normalize_type_handles_plain_string():
    assert normalize_type("Cycling") == "cycling"


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
    assert to_activity(raw, samples) == {
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
    activity = to_activity(raw)
    assert activity["averageSpeed"] == 3.2
    assert activity["maxSpeed"] == 4.1


def test_to_activity_keeps_the_recorded_average_heart_rate():
    raw = {
        "activityId": 42,
        "activityName": "Morning Run",
        "activityType": {"typeKey": "RUNNING"},
        "startTimeGMT": datetime(2026, 10, 1, 4, 30, 0),
        "averageHR": 150,
        "avgHR": 148,
    }
    assert to_activity(raw)["averageHeartRate"] == 150


def test_to_activity_omits_an_absent_or_zero_average_heart_rate():
    base = {
        "activityId": 42,
        "activityName": "Morning Run",
        "activityType": {"typeKey": "RUNNING"},
        "startTimeGMT": datetime(2026, 10, 1, 4, 30, 0),
    }
    assert "averageHeartRate" not in to_activity(base)
    assert "averageHeartRate" not in to_activity({**base, "averageHR": 0})


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
    assert to_activity(raw)["averageSpeed"] == 2000 / 480


def test_to_activity_defaults_to_empty_samples():
    raw = {
        "activityId": 1,
        "activityName": "",
        "activityType": {"typeKey": "OTHER"},
        "startTimeLocal": datetime(2026, 10, 1, 0, 0, 0),
    }
    assert to_activity(raw)["samples"] == []


def test_to_activity_defaults_missing_numeric_fields():
    raw = {
        "activityId": 1,
        "activityName": "",
        "activityType": {"typeKey": "OTHER"},
        "startTimeLocal": datetime(2026, 10, 1, 0, 0, 0),
    }
    result = to_activity(raw)
    assert result["distance"] == 0.0
    assert result["movingTime"] == 0.0
    assert result["elapsedTime"] == 0.0
    assert result["totalElevationGain"] == 0.0


def test_to_samples_maps_known_metrics():
    payload = details([1790836200000, 59.91, 10.75, 140, 250, 12.5, 3.2, 1000, 20, 80])
    assert to_samples(payload) == [
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
    payload = details(
        [1790836200000, 4.2],
        descriptors=[(0, "directTimestamp"), (1, "directEnhancedSpeed")],
    )
    assert to_samples(payload) == [
        {
            "timestamp": "2026-10-01T06:30:00Z",
            "speed": 4.2,
        }
    ]


def test_to_samples_skips_samples_without_a_timestamp():
    payload = details(
        [140],
        descriptors=[(0, "directHeartRate")],
    )
    assert to_samples(payload) == []


def test_to_samples_omits_absent_and_non_numeric_channels():
    payload = details(
        [1790836200000, None, 10.75],
        descriptors=[
            (0, "directTimestamp"),
            (1, "directHeartRate"),
            (2, "directLongitude"),
        ],
    )
    assert to_samples(payload) == [
        {
            "timestamp": "2026-10-01T06:30:00Z",
            "longitude": 10.75,
        }
    ]


def test_to_samples_supports_alternate_metric_keys():
    payload = details(
        [1790836200000, 12.5, 20, 80],
        descriptors=[
            (0, "directTimestamp"),
            (1, "directTemperature"),
            (2, "directUncorrectedElevation"),
            (3, "directCadence"),
        ],
    )
    assert to_samples(payload) == [
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
    payload = details(
        [1790836200000, 0.0],
        descriptors=[(0, "directTimestamp"), (1, "directFractionalCadence")],
    )
    assert to_samples(payload, "running") == [{"timestamp": "2026-10-01T06:30:00Z"}]


def test_to_samples_uses_double_cadence_for_running():
    payload = details(
        [1790836200000, 152, 76, 0.5],
        descriptors=[
            (0, "directTimestamp"),
            (1, "directDoubleCadence"),
            (2, "directCadence"),
            (3, "directFractionalCadence"),
        ],
    )
    assert to_samples(payload, "running")[0]["cadence"] == 152.0


def test_to_samples_doubles_the_per_leg_cadence_for_running():
    # Devices that only report the per-leg value: Garmin Connect shows the
    # total, so a 76-per-leg run is 152 steps per minute.
    payload = details(
        [1790836200000, 76, 0.25],
        descriptors=[
            (0, "directTimestamp"),
            (1, "directCadence"),
            (2, "directFractionalCadence"),
        ],
    )
    assert to_samples(payload, "trail_running")[0]["cadence"] == 152.5


@pytest.mark.parametrize(
    ("activity_type", "per_leg", "total"),
    [("jogging", 55.0, 110.0), ("walking", 55.5, 111.0), ("hiking", 57.25, 114.5)],
)
def test_to_samples_counts_walking_and_hiking_cadence_as_total_steps(
    activity_type, per_leg, total
):
    # Every step-counted sport reports a per-leg cadence in `directCadence`;
    # Garmin Connect shows total steps per minute for walks and hikes too, and
    # the shared app labels them spm.
    payload = details(
        [1790836200000, per_leg],
        descriptors=[(0, "directTimestamp"), (1, "directCadence")],
    )
    assert to_samples(payload, activity_type)[0]["cadence"] == total


def test_to_samples_uses_double_cadence_for_a_walk():
    payload = details(
        [1790836200000, 111.0, 55.5],
        descriptors=[
            (0, "directTimestamp"),
            (1, "directDoubleCadence"),
            (2, "directCadence"),
        ],
    )
    assert to_samples(payload, "walking")[0]["cadence"] == 111.0


def test_to_samples_keeps_pedalling_cadence_for_cycling():
    payload = details(
        [1790836200000, 90, 0.5],
        descriptors=[
            (0, "directTimestamp"),
            (1, "directCadence"),
            (2, "directFractionalCadence"),
        ],
    )
    assert to_samples(payload, "indoor_cycling")[0]["cadence"] == 90.5


def test_to_samples_keeps_stroke_cadence_for_rowing():
    payload = details(
        [1790836200000, 19.0, 0.5],
        descriptors=[
            (0, "directTimestamp"),
            (1, "directStrokeCadence"),
            (2, "directFractionalCadence"),
        ],
    )
    assert to_samples(payload, "indoor_rowing")[0]["cadence"] == 19.0


def test_to_samples_prefers_primary_metric_aliases():
    payload = details(
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
    assert to_samples(payload) == [
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
        to_samples(details([1790836200000, 1200, 1100], descriptors=descriptors))[0][
            "distance"
        ]
        == 1200.0
    )
    assert (
        to_samples(details([1790836200000, None, 1100], descriptors=descriptors))[0][
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

    assert to_laps(payload) == [
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

    assert to_laps(payload) == [
        {
            "index": 7,
            "type": "interval",
            "averageHeartRate": 150.0,
            "averagePower": 300.0,
            "averageSpeed": 4.2,
            "averageCadence": 90.0,
        }
    ]


def test_to_laps_keeps_total_steps_for_walking_and_hiking():
    # `averageRunCadence` is the value Garmin Connect displays, already counted
    # in total steps per minute, so it is never doubled.
    for activity_type in ("walking", "hiking"):
        payload = {
            "lapDTOs": [
                {"lapIndex": 1, "distance": 1000, "averageRunCadence": 111.0},
                {"lapIndex": 2, "distance": 1000, "averageRunCadence": 114.5},
            ]
        }
        assert [lap["averageCadence"] for lap in to_laps(payload, activity_type)] == [
            111.0,
            114.5,
        ]


def test_to_laps_doubles_the_per_leg_walking_cadence_fallback():
    # Older payloads only carry `avgCadence`, which is the per-leg value for a
    # step-counted sport, so a walk's 55.5 is shown as 111 steps per minute.
    payload = {
        "lapDTOs": [
            {"lapIndex": 1, "distance": 1000, "avgCadence": 55.5},
            {"lapIndex": 2, "distance": 1000, "avgCadence": 56.25},
        ]
    }
    assert [lap["averageCadence"] for lap in to_laps(payload, "walking")] == [
        111.0,
        112.5,
    ]


def test_to_laps_keeps_pedalling_cadence_for_cycling_with_the_type():
    payload = {"lapDTOs": [{"lapIndex": 1, "distance": 1000, "avgCadence": 90.5}]}
    assert to_laps(payload, "road_biking")[0]["averageCadence"] == 90.5
    assert to_laps(payload, "indoor_cycling")[0]["averageCadence"] == 90.5


def test_lap_cadence_prefers_garmin_connects_total_over_the_legacy_value():
    # A payload that carries both families: Connect's total wins and is not
    # doubled, even though the legacy per-leg value would double to the same.
    payload = {
        "lapDTOs": [
            {
                "lapIndex": 1,
                "distance": 1000,
                "averageRunCadence": 110.0,
                "avgCadence": 55.0,
            }
        ]
    }
    assert to_laps(payload, "walking")[0]["averageCadence"] == 110.0


def test_step_cadence_rule_matches_the_shared_display_unit():
    # The sidecar doubles exactly the sports the shared contract labels as
    # steps per minute. Rowing and swimming are strokes per minute and already
    # total, so the shared pattern includes them but the doubling rule does not.
    source = (
        Path(__file__).resolve().parents[2] / "packages/shared/src/activity.ts"
    ).read_text(encoding="utf-8")
    match = re.search(r"const STEP_CADENCE_PATTERN = /([^/]+)/;", source)
    assert match is not None, "STEP_CADENCE_PATTERN not found in shared activity.ts"
    shared_markers = set(match.group(1).split("|"))
    assert set(STEP_CADENCE_MARKERS) == shared_markers - {"row", "swim"}


def test_to_laps_drops_a_lap_with_no_recorded_values():
    assert to_laps({"lapDTOs": [{"lapIndex": 1}, {"lapIndex": 2, "distance": 0}]}) == [
        {"index": 2, "distance": 0.0}
    ]


def test_to_laps_falls_back_to_position_and_caps_the_list():
    payload = {"lapDTOs": [{"distance": 1000}] * (MAX_LAPS + 5)}
    laps = to_laps(payload)
    assert len(laps) == MAX_LAPS
    assert laps[0]["index"] == 1
    assert laps[-1]["index"] == MAX_LAPS


def test_to_laps_tolerates_a_malformed_payload():
    assert to_laps({}) == []
    assert to_laps({"lapDTOs": None}) == []
    assert to_laps({"lapDTOs": ["not a lap"]}) == []


def test_sync_attaches_samples_and_survives_a_failed_detail_fetch(monkeypatch):
    fake = FakeGarmin(
        details=details(
            [1790836200000, 140],
            descriptors=[(0, "directTimestamp"), (1, "directHeartRate")],
        ),
        failing_ids={"2"},
    )
    monkeypatch.setattr(auth, "login", lambda credentials: fake)

    activities_ = activities.sync_activities(
        auth.Credentials(username="u", password="p")
    )

    assert fake.requested_ids == ["1", "2"]
    assert activities_[0]["samples"] == [
        {"timestamp": "2026-10-01T06:30:00Z", "heartRate": 140.0}
    ]
    assert activities_[1]["samples"] == []


def test_sync_attaches_laps_and_survives_a_failed_splits_fetch(monkeypatch):
    fake = FakeGarmin(
        details=details(
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
    monkeypatch.setattr(auth, "login", lambda credentials: fake)

    activities_ = activities.sync_activities(
        auth.Credentials(username="u", password="p")
    )

    assert fake.requested_split_ids == ["1", "2"]
    assert activities_[0]["laps"] == [
        {"index": 1, "distance": 2500.0, "averagePower": 250.0},
        {"index": 2, "distance": 2500.0, "averagePower": 260.0},
    ]
    assert "laps" not in activities_[1]


def test_sync_applies_the_step_cadence_rule_to_a_walk(monkeypatch):
    class _WalkingFake(FakeGarmin):
        def get_activities_by_date(self, startdate, enddate):
            return [
                {
                    "activityId": 7,
                    "activityName": "Morning Walk",
                    "activityType": {"typeKey": "WALKING"},
                    "startTimeLocal": datetime(2026, 10, 1, 7, 0, 0),
                }
            ]

    fake = _WalkingFake(
        details=details(
            [1790836200000, 55.5],
            descriptors=[(0, "directTimestamp"), (1, "directCadence")],
        ),
        splits={
            "7": {
                "lapDTOs": [
                    {"lapIndex": 1, "distance": 1000, "avgCadence": 55.5},
                    {"lapIndex": 2, "distance": 1000, "averageRunCadence": 112.0},
                ]
            }
        },
    )
    monkeypatch.setattr(auth, "login", lambda credentials: fake)

    activity = activities.sync_activities(auth.Credentials(username="u", password="p"))[
        0
    ]

    assert activity["samples"][0]["cadence"] == 111.0
    assert [lap["averageCadence"] for lap in activity["laps"]] == [111.0, 112.0]


def test_to_activity_ignores_a_single_lap():
    raw = {"activityId": 1, "activityType": {"typeKey": "RUNNING"}}
    one_lap = [{"index": 1, "distance": 5000.0}]
    two_laps = [*one_lap, dict(index=2, distance=1000.0)]

    # A single lap is the whole activity restated, not interval structure.
    assert "laps" not in to_activity(raw, laps=one_lap)
    assert to_activity(raw, laps=two_laps)["laps"] == two_laps


def test_sync_maps_a_splits_rate_limit_to_rate_limited(monkeypatch):
    class _RateLimitedFake(FakeGarmin):
        def get_activity_splits(self, activity_id):
            raise GarminConnectTooManyRequestsError("429")

    monkeypatch.setattr(auth, "login", lambda credentials: _RateLimitedFake(details={}))

    with pytest.raises(RateLimitedError):
        activities.sync_activities(auth.Credentials(username="u", password="p"))


def test_sync_maps_a_detail_rate_limit_to_rate_limited(monkeypatch):
    class _RateLimitedFake(FakeGarmin):
        def get_activity_details(self, activity_id):
            raise GarminConnectTooManyRequestsError("429")

    monkeypatch.setattr(auth, "login", lambda credentials: _RateLimitedFake(details={}))

    with pytest.raises(RateLimitedError):
        activities.sync_activities(auth.Credentials(username="u", password="p"))


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

    assert to_strength_sets(payload) == [
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
                for _ in range(MAX_STRENGTH_SETS + 5)
            ],
        ]
    }

    assert len(to_strength_sets(payload)) == MAX_STRENGTH_SETS
