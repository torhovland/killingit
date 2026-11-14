"""Representative Garmin payloads and the sidecar's committed wire responses.

The sidecar builds its response dicts by hand while TypeScript owns the Zod
schemas that parse them, so nothing but a test can keep the two in step. This
module holds the Garmin payloads the contract is written from, and builds each
endpoint's whole response body by running those payloads through the sidecar's
own handlers (`/sync`, `/metrics` and `/daily`), so the committed JSON in
`services/garmin/contract/` is exactly what the sidecar would return.

`test_contract.py` re-runs the normalizers and asserts the committed files still
match, and `apps/api/src/garmin/contract.test.ts` parses the same files with the
shared Zod schemas. Regenerate the committed files after a deliberate wire
change:

    cd services/garmin
    UPDATE_CONTRACT_FIXTURES=1 .venv/bin/python -m pytest test_contract.py

See `docs/specs/garmin-sidecar-contract.md` and ADR 0057.
"""

from __future__ import annotations

import json
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any
from unittest.mock import patch

import app
import auth
from app import DailyRequest
from auth import Credentials

CONTRACT_DIR = Path(__file__).resolve().parent / "contract"

# The day the daily-health fixture is for. Fixed so the committed JSON never
# changes with the clock.
CONTRACT_DAY = "2026-11-12"

RUN_ID = 1
RIDE_ID = 2
STRENGTH_ID = 3


def _detail_metrics(rows: list[list[Any]], descriptors: list[tuple[int, str]]) -> dict:
    """Build Garmin's positional activity-details payload."""
    return {
        "metricDescriptors": [
            {"metricsIndex": index, "key": key} for index, key in descriptors
        ],
        "activityDetailMetrics": [{"metrics": row} for row in rows],
    }


_ACTIVITIES = [
    {
        "activityId": RUN_ID,
        "activityName": "Morning Run",
        "activityType": {"typeKey": "RUNNING"},
        "startTimeLocal": datetime(2026, 10, 1, 6, 30, 0),
        "startTimeGMT": datetime(2026, 10, 1, 4, 30, 0),
        "distance": 5000.0,
        "movingDuration": 1500.0,
        "duration": 1580.0,
        "elevationGain": 42.0,
        "averageSpeed": 3.33,
        "maxSpeed": 4.12,
        "averageHR": 148,
    },
    {
        "activityId": RIDE_ID,
        "activityName": "Interval Ride",
        "activityType": {"typeKey": "ROAD_BIKING"},
        "startTimeGMT": datetime(2026, 10, 3, 7, 0, 0),
        "distance": 40250.0,
        "movingDuration": 5400.0,
        "duration": 6000.0,
        "elevationGain": 380.0,
        "averageSpeed": 7.45,
        "maxSpeed": 15.8,
        "averageHR": 141,
    },
    {
        "activityId": STRENGTH_ID,
        "activityName": "Gym Session",
        "activityType": {"typeKey": "STRENGTH_TRAINING"},
        "startTimeGMT": datetime(2026, 10, 5, 16, 0, 0),
        "distance": 0,
        "movingDuration": 2700.0,
        "duration": 3000.0,
        "elevationGain": 0,
        "averageHR": 112,
    },
]

_DETAILS = {
    str(RUN_ID): _detail_metrics(
        [
            [1790836200000, 59.91, 10.75, 138, 240, 11.5, 3.1, 0, 18, 152],
            [1790836260000, None, None, 148, 265, None, 3.4, 1000, 22, 154],
            [1790836320000, 59.92, 10.76, 151, 270, 11.6, 3.45, 2000, 24, 156],
        ],
        [
            (0, "directTimestamp"),
            (1, "directLatitude"),
            (2, "directLongitude"),
            (3, "directHeartRate"),
            (4, "directPower"),
            (5, "directAirTemperature"),
            (6, "directSpeed"),
            (7, "sumDistance"),
            (8, "directCorrectedElevation"),
            (9, "directDoubleCadence"),
        ],
    ),
    str(RIDE_ID): _detail_metrics(
        [
            [1791010800000, 58.95, 5.72, 132, 210, 8.4, 0, 92, 0.25],
            [1791010860000, 58.96, 5.73, 145, 320, 10.1, 500, 94, 0.5],
        ],
        [
            (0, "directTimestamp"),
            (1, "directLatitude"),
            (2, "directLongitude"),
            (3, "directHeartRate"),
            (4, "directPower"),
            (5, "directSpeed"),
            (6, "sumDistance"),
            (7, "directBikeCadence"),
            (8, "directFractionalCadence"),
        ],
    ),
}

_SPLITS = {
    str(RUN_ID): {
        "activityId": RUN_ID,
        "lapDTOs": [
            {
                "lapIndex": 1,
                "intensityType": "ACTIVE",
                "startTimeGMT": "2026-10-01T04:30:00.0",
                "duration": 480.0,
                "movingDuration": 470.0,
                "distance": 1600.0,
                "averageHR": 140.0,
                "maxHR": 149.0,
                "averagePower": 245.0,
                "maxPower": 280.0,
                "averageSpeed": 3.4,
                "averageRunCadence": 152.0,
                "elevationGain": 18.0,
            },
            {
                "lapIndex": 2,
                "intensityType": "ACTIVE",
                "duration": 420.0,
                "movingDuration": 415.0,
                "distance": 1400.0,
                "averageHR": 156.0,
                "maxHR": 163.0,
                "averagePower": 268.0,
                "maxPower": 310.0,
                # Older payloads carry only the per-leg cadence for a run.
                "avgCadence": 77.0,
                "elevationGain": 12.0,
            },
            {
                "lapIndex": 3,
                "intensityType": "ACTIVE",
                "duration": 600.0,
                "movingDuration": 590.0,
                "distance": 2000.0,
                "averageHR": 150.0,
                "maxHR": 158.0,
                "averagePower": 255.0,
                "maxPower": 295.0,
                "averageSpeed": 3.4,
                "elevationGain": 12.0,
            },
        ],
    },
    str(RIDE_ID): {
        "activityId": RIDE_ID,
        "lapDTOs": [
            {
                "lapIndex": 1,
                "intensityType": "ACTIVE",
                "duration": 900.0,
                "movingDuration": 895.0,
                "distance": 7000.0,
                "averageHR": 148.0,
                "maxHR": 162.0,
                "averagePower": 205.0,
                "maxPower": 420.0,
                "averageSpeed": 7.8,
                "averageBikeCadence": 88.0,
                "elevationGain": 40.0,
            },
            {
                "lapIndex": 2,
                "intensityType": "REST",
                "duration": 300.0,
                "movingDuration": 300.0,
                "distance": 2200.0,
                "averageHR": 118.0,
                "maxHR": 126.0,
                "averagePower": 120.0,
                "maxPower": 180.0,
                "averageSpeed": 7.3,
                "averageBikeCadence": 70.0,
            },
        ],
    },
}

_EXERCISE_SETS = {
    str(STRENGTH_ID): {
        "activityId": STRENGTH_ID,
        "exerciseSets": [
            {
                "setType": "ACTIVE",
                "startTime": "2026-10-05T18:02:00+02:00",
                "duration": 45.0,
                "repetitionCount": 10,
                "weight": 12000,
                "exercises": [{"category": "SQUAT", "name": "GOBLET_SQUAT"}],
            },
            {
                "setType": "REST",
                "duration": 90.0,
                "exercises": [],
            },
            {
                "setType": "ACTIVE",
                "startTime": "2026-10-05T18:05:00+02:00",
                "duration": 40.0,
                "repetitionCount": 8,
                # A bodyweight set records no load, so no weight is stored.
                "weight": 0,
                "exercises": [{"category": "PUSH_UP", "name": None}],
            },
        ],
    },
}

# Weigh-ins in the three unit shapes Garmin reports: grams without a usable
# unit, pounds, and kilograms. Only the second and third dates carry body fat.
_BODY_COMPOSITION = {
    "dateWeightList": [
        {
            "calendarDate": "2026-10-01",
            "weight": 78500,
            "unitKey": "g",
            "bodyFat": 24.5,
        },
        {
            "calendarDate": "2026-10-08",
            "weight": 172.0,
            "unitKey": "lbs",
            "bodyFat": 0.241,
        },
        {
            "calendarDate": "2026-10-15",
            "weight": 78.2,
            "unitKey": "kg",
        },
    ]
}

_FTP_HISTORY: list[dict] = [
    {"calendarDate": "2026-10-01", "functionalThresholdPower": 255},
    {"calendarDate": "2026-10-20", "ftp": {"value": 262}},
]

# One day of Garmin's stats, sleep, training-readiness and max-metrics payloads,
# in the shapes the library returns them.
_DAILY_STATS = {
    "restingHeartRate": 52,
    "sleepingSeconds": 25200,
    "averageStressLevel": 31,
    "bodyBatteryHighestValue": 88,
    "bodyBatteryLowestValue": 24,
    "totalSteps": 8200,
    "activeKilocalories": 640,
    "averageSpo2": 95,
    "moderateIntensityMinutes": 20,
    "vigorousIntensityMinutes": 5,
}

_DAILY_SLEEP = {
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

_DAILY_READINESS = [
    {"timestamp": "2026-11-12T06:00:00", "score": 74, "recoveryTime": 720},
    {"timestamp": "2026-11-12T08:00:00", "score": 78, "recoveryTime": 600},
]

_DAILY_MAX_METRICS = [
    {
        "generic": {"vo2MaxPreciseValue": 48.5},
        "cycling": {"vo2MaxValue": 43},
    }
]


class _ContractGarmin:
    """Stands in for `python-garminconnect`'s client with the fixed payloads."""

    def get_activities_by_date(self, startdate: str, enddate: str) -> list[dict]:
        return _ACTIVITIES

    def get_activity_details(self, activity_id: str) -> dict:
        return _DETAILS.get(activity_id, {})

    def get_activity_splits(self, activity_id: str) -> dict:
        return _SPLITS.get(activity_id, {})

    def get_activity_exercise_sets(self, activity_id: str) -> dict:
        return _EXERCISE_SETS.get(activity_id, {})

    def get_body_composition(self, startdate: str, enddate: str) -> dict:
        return _BODY_COMPOSITION

    def get_functional_threshold_power_range(
        self, startdate: str, enddate: str, *, sport: str, aggregation: str
    ) -> list[dict]:
        return _FTP_HISTORY

    def get_stats(self, date: str) -> dict:
        return _DAILY_STATS

    def get_sleep_data(self, date: str) -> dict:
        return _DAILY_SLEEP

    def get_training_readiness(self, date: str) -> list[dict]:
        return _DAILY_READINESS

    def get_max_metrics(self, date: str) -> list[dict]:
        return _DAILY_MAX_METRICS


@contextmanager
def _stubbed_login():
    """Run the sidecar's handlers against the fixed Garmin client."""
    with patch.object(auth, "login", lambda credentials: _ContractGarmin()):
        yield


def contract_responses() -> dict[str, Any]:
    """The sidecar's whole body for each endpoint, built by its own handlers."""
    with _stubbed_login():
        credentials = Credentials(username="athlete@example.com", password="secret")
        return {
            "sync": app.sync(credentials),
            "metrics": app.metrics(credentials),
            "daily": app.daily(
                DailyRequest(
                    username="athlete@example.com",
                    password="secret",
                    date=CONTRACT_DAY,
                )
            ),
        }


def write_contract_responses(responses: dict[str, Any]) -> None:
    """Rewrite the committed fixtures. Only the regeneration path calls this."""
    CONTRACT_DIR.mkdir(parents=True, exist_ok=True)
    for name, response in responses.items():
        path = CONTRACT_DIR / f"{name}.json"
        path.write_text(json.dumps(response, indent=2) + "\n", encoding="utf-8")
