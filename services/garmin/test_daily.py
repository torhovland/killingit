"""Unit tests for daily health metric normalization."""

import pytest
from garminconnect import GarminConnectTooManyRequestsError

import auth
from auth import Credentials
from daily import sync_daily
from errors import RateLimitedError
from support import DailyFake


def test_sync_daily_combines_bundle_sleep_readiness_and_vo2max(monkeypatch):
    monkeypatch.setattr(auth, "login", lambda credentials: DailyFake())

    assert sync_daily(Credentials(username="u", password="p"), "2026-11-02") == {
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
    class _UnconfirmedSleep(DailyFake):
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

    monkeypatch.setattr(auth, "login", lambda credentials: _UnconfirmedSleep())

    result = sync_daily(Credentials(username="u", password="p"), "2026-11-02")

    assert "sleep_duration" not in result["metrics"]
    assert "sleep_score" not in result["metrics"]
    assert "deep_sleep" not in result["metrics"]
    assert result["metrics"]["resting_heart_rate"] == 52


def test_sync_daily_omits_a_zero_sleep_without_a_confirmation_flag(monkeypatch):
    class _EmptySleep(DailyFake):
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

    monkeypatch.setattr(auth, "login", lambda credentials: _EmptySleep())

    result = sync_daily(Credentials(username="u", password="p"), "2026-11-02")

    assert "sleep_duration" not in result["metrics"]
    assert "sleep_score" not in result["metrics"]


def test_sync_daily_tolerates_one_failed_source(monkeypatch):
    class _PartlyBroken(DailyFake):
        def get_sleep_data(self, date):
            raise RuntimeError("sleep unavailable")

        def get_training_readiness(self, date):
            raise RuntimeError("readiness unavailable")

        def get_max_metrics(self, date):
            raise RuntimeError("max metrics unavailable")

    monkeypatch.setattr(auth, "login", lambda credentials: _PartlyBroken())

    result = sync_daily(Credentials(username="u", password="p"), "2026-11-02")
    assert result["metrics"]["resting_heart_rate"] == 52
    assert "sleep_score" not in result["metrics"]


def test_sync_daily_propagates_rate_limit(monkeypatch):
    class _RateLimited(DailyFake):
        def get_sleep_data(self, date):
            raise GarminConnectTooManyRequestsError("429")

    monkeypatch.setattr(auth, "login", lambda credentials: _RateLimited())

    with pytest.raises(RateLimitedError):
        sync_daily(Credentials(username="u", password="p"), "2026-11-02")
