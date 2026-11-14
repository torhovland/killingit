"""Shared stubs for the Garmin sidecar's test modules.

`details` builds Garmin's positional activity-details payload, `FakeGarmin`
stands in for the library client during an activity sync, and `DailyFake`
stands in for the four daily-health sources. They live here so the split test
modules do not copy them. See ADR 0058.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any


def details(
    *samples: list[Any], descriptors: list[tuple[int, str]] | None = None
) -> dict:
    """Build Garmin's positional activity-details payload.

    Garmin reports activity details as positional metrics; metricDescriptors
    maps each position to a key. Values are epoch milliseconds / SI-ish units.
    """
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


class FakeGarmin:
    """Stubs the library calls used by an activity sync."""

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


class DailyFake:
    """Stubs Garmin's four daily-health sources."""

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
