"""T12: monthly clamp (31st → last day) + DST gap shift (Europe/Berlin, America/New_York)."""

from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from app.services.recurrence import iter_occurrence_starts, wall_to_utc


def test_monthly_clamp():
    """31 Jan series → Feb last day, then 31 Mar (anchor stays 31)."""
    # 2026-01-31 15:00 UTC = 16:00 Europe/Berlin (CET, UTC+1)
    starts = datetime(2026, 1, 31, 15, 0, 0, tzinfo=timezone.utc)
    occs = iter_occurrence_starts(
        series_starts_at=starts,
        freq="monthly",
        rec_until=date(2026, 4, 30),
        rec_tz="Europe/Berlin",
    )
    berlin = ZoneInfo("Europe/Berlin")
    local_days = [o.astimezone(berlin).date() for o in occs]
    assert local_days == [
        date(2026, 1, 31),
        date(2026, 2, 28),  # clamp
        date(2026, 3, 31),
        date(2026, 4, 30),  # April has 30
    ]
    # Wall time preserved (16:00 Berlin)
    for o in occs:
        loc = o.astimezone(berlin)
        assert (loc.hour, loc.minute) == (16, 0)


def test_monthly_clamp_leap_february():
    starts = datetime(2024, 1, 31, 12, 0, 0, tzinfo=timezone.utc)
    occs = iter_occurrence_starts(
        series_starts_at=starts,
        freq="monthly",
        rec_until=date(2024, 3, 31),
        rec_tz="UTC",
    )
    days = [o.date() for o in occs]
    assert days == [date(2024, 1, 31), date(2024, 2, 29), date(2024, 3, 31)]


def test_dst_gap_europe_berlin():
    """2026-03-29 Europe/Berlin: 02:00–03:00 missing; 02:30 → 03:30 CEST."""
    # Wall 02:30 on spring-forward day
    wall = datetime(2026, 3, 29, 2, 30, 0)
    utc = wall_to_utc(wall, ZoneInfo("Europe/Berlin"))
    local = utc.astimezone(ZoneInfo("Europe/Berlin"))
    assert local.date() == date(2026, 3, 29)
    assert (local.hour, local.minute) == (3, 30)
    assert local.dst() is not None and local.dst().total_seconds() > 0


def test_dst_gap_america_new_york():
    """2026-03-08 America/New_York: 02:00–03:00 missing; 02:15 → 03:15 EDT."""
    wall = datetime(2026, 3, 8, 2, 15, 0)
    utc = wall_to_utc(wall, ZoneInfo("America/New_York"))
    local = utc.astimezone(ZoneInfo("America/New_York"))
    assert local.date() == date(2026, 3, 8)
    assert (local.hour, local.minute) == (3, 15)


def test_daily_keeps_wall_across_dst():
    """Daily 09:00 Berlin stays 09:00 local across spring-forward (instant shifts)."""
    # 2026-03-28 08:00 UTC = 09:00 CET
    starts = datetime(2026, 3, 28, 8, 0, 0, tzinfo=timezone.utc)
    occs = iter_occurrence_starts(
        series_starts_at=starts,
        freq="daily",
        rec_until=date(2026, 3, 30),
        rec_tz="Europe/Berlin",
    )
    berlin = ZoneInfo("Europe/Berlin")
    assert len(occs) == 3
    for o in occs:
        loc = o.astimezone(berlin)
        assert (loc.hour, loc.minute) == (9, 0)
    # UTC instants: before DST +1h, after +2h → 08:00 then 07:00
    assert occs[0] == datetime(2026, 3, 28, 8, 0, tzinfo=timezone.utc)
    assert occs[1] == datetime(2026, 3, 29, 7, 0, tzinfo=timezone.utc)
    assert occs[2] == datetime(2026, 3, 30, 7, 0, tzinfo=timezone.utc)


def test_weekly_same_weekday():
    starts = datetime(2026, 10, 20, 10, 0, 0, tzinfo=timezone.utc)  # Tuesday
    occs = iter_occurrence_starts(
        series_starts_at=starts,
        freq="weekly",
        rec_until=date(2026, 11, 10),
        rec_tz="UTC",
    )
    assert [o.date() for o in occs] == [
        date(2026, 10, 20),
        date(2026, 10, 27),
        date(2026, 11, 3),
        date(2026, 11, 10),
    ]
