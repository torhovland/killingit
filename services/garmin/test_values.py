"""Unit tests for the sidecar's shared value and date helpers."""

from datetime import UTC, datetime, timedelta

from values import SYNC_WINDOW_DAYS, date_window, iso, metric_date


def test_iso_normalizes_datetime_to_utc_z():
    dt = datetime(2026, 10, 1, 6, 30, 0)
    assert iso(dt) == "2026-10-01T06:30:00Z"


def test_iso_passes_through_non_iso_text():
    assert iso("not a date") == "not a date"


def test_iso_normalizes_iso_string():
    assert iso("2026-10-01T06:30:00+02:00") == "2026-10-01T04:30:00Z"


def test_date_window_returns_plain_dates():
    # Garmin's get_activities_by_date requires YYYY-MM-DD, not ISO timestamps.
    now = datetime(2026, 10, 20, 15, 30, tzinfo=UTC)
    start, end = date_window(now)
    assert end == "2026-10-20"
    assert start == "2026-09-09"
    # Both ends are inclusive, so the window holds exactly SYNC_WINDOW_DAYS dates.
    first = datetime.fromisoformat(start).date()
    dates = [first + timedelta(days=offset) for offset in range(SYNC_WINDOW_DAYS)]
    assert dates[0].isoformat() == start
    assert dates[-1].isoformat() == end
    assert len(dates) == SYNC_WINDOW_DAYS


def test_date_window_defaults_to_today():
    start, end = date_window()
    assert len(start) == 10 and start[4] == "-" and start[7] == "-"
    assert len(end) == 10 and end[4] == "-" and end[7] == "-"
    today = datetime.now(UTC).date()
    assert end == today.isoformat()
    span = today - datetime.fromisoformat(start).date()
    assert span == timedelta(days=SYNC_WINDOW_DAYS - 1)


def test_metric_date_reads_calendar_date_and_epoch():
    assert metric_date({"calendarDate": "2026-10-01"}) == "2026-10-01"
    assert (
        metric_date({"timestampGMT": 1790836200000})
        == datetime.fromtimestamp(1790836200, tz=UTC).date().isoformat()
    )
