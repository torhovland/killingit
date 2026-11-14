"""Unit tests for weigh-in and historic FTP normalization."""

import app
import auth
import body
from auth import Credentials
from body import (
    body_fat_percent,
    sync_metrics,
    to_body_metrics,
    to_ftp_history,
    weight_kg,
)


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

    assert to_body_metrics(payload) == [
        {"date": "2026-10-01", "weightKg": 78.5, "bodyFatPercent": 24.5},
        {"date": "2026-10-02", "weightKg": 78.0},
    ]


def test_weight_converts_pounds_and_grams():
    assert weight_kg({"weight": 172.0, "unitKey": "lbs"}) == 78.02
    assert weight_kg({"weight": 78500}) == 78.5
    assert weight_kg({"weight": 78.0}) == 78.0
    assert weight_kg({"weight": 0}) is None


def test_body_fat_accepts_fraction_and_rejects_impossible_values():
    assert body_fat_percent({"bodyFat": 0.245}) == 24.5
    assert body_fat_percent({"percentFat": 18.2}) == 18.2
    assert body_fat_percent({"bodyFat": 80}) is None


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

    monkeypatch.setattr(auth, "login", lambda credentials: _MetricsFake())

    assert sync_metrics(Credentials(username="u", password="p")) == {
        "metrics": [{"date": "2026-10-01", "weightKg": 78.0}],
        "ftp": [{"date": "2026-10-01", "watts": 255}],
    }


def test_metrics_route_returns_the_flat_response_the_api_expects(monkeypatch):
    snapshot = {
        "metrics": [{"date": "2026-10-01", "weightKg": 78.0}],
        "ftp": [{"date": "2026-10-01", "watts": 255}],
    }
    monkeypatch.setattr(body, "sync_metrics", lambda credentials: snapshot)

    assert app.metrics(Credentials(username="u", password="p")) == snapshot


def test_to_ftp_history_handles_lists_and_nested_records():
    assert to_ftp_history(
        [
            {"calendarDate": "2026-10-01", "functionalThresholdPower": 250},
            {"calendarDate": "2026-10-02", "ftp": {"value": 255}},
            {"calendarDate": "2026-10-03", "value": 20},
        ]
    ) == [
        {"date": "2026-10-01", "watts": 250},
        {"date": "2026-10-02", "watts": 255},
    ]
    assert to_ftp_history(
        {"functionalThresholdPower": [{"calendarDate": "2026-10-01", "value": 260}]}
    ) == [{"date": "2026-10-01", "watts": 260}]
