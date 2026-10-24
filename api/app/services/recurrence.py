"""Recurrence occurrence generator (D-006): daily / weekly / monthly in ``rec_tz``.

Rules (spec §4.3):
- Wall time of the series ``starts_at`` is kept in ``rec_tz``; convert to UTC per occurrence.
- Monthly: same day-of-month as the series anchor; if the month is shorter, clamp to last day
  (31 Jan → 28/29 Feb → 31 Mar; anchor day stays 31).
- DST gap (nonexistent local time): shift forward by the difference of UTC offsets.
- ``rec_until`` is an inclusive calendar date in ``rec_tz``.
"""

from __future__ import annotations

from calendar import monthrange
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo


def _add_months(year: int, month: int, delta: int) -> tuple[int, int]:
    idx = year * 12 + (month - 1) + delta
    return idx // 12, idx % 12 + 1


def _clamp_day(year: int, month: int, anchor_day: int) -> date:
    last = monthrange(year, month)[1]
    return date(year, month, min(anchor_day, last))


def wall_to_utc(wall: datetime, tz: ZoneInfo) -> datetime:
    """Convert naive local wall time in ``tz`` to UTC.

    If the wall time falls in a DST spring-forward gap, shift forward by the
    offset delta (typically one hour) so the instant exists.
    """
    if wall.tzinfo is not None:
        raise ValueError("wall must be naive local time")
    dt0 = wall.replace(tzinfo=tz, fold=0)
    utc0 = dt0.astimezone(timezone.utc)
    back = utc0.astimezone(tz)
    if (
        back.year,
        back.month,
        back.day,
        back.hour,
        back.minute,
        back.second,
        back.microsecond,
    ) == (
        wall.year,
        wall.month,
        wall.day,
        wall.hour,
        wall.minute,
        wall.second,
        wall.microsecond,
    ):
        return utc0

    # Gap: probe offsets around the missing hour and shift wall forward.
    before = (wall - timedelta(hours=3)).replace(tzinfo=tz).utcoffset()
    after = (wall + timedelta(hours=3)).replace(tzinfo=tz).utcoffset()
    if before is not None and after is not None and after > before:
        shifted = wall + (after - before)
        return shifted.replace(tzinfo=tz).astimezone(timezone.utc)
    return utc0


def iter_occurrence_starts(
    *,
    series_starts_at: datetime,
    freq: str,
    rec_until: date | None,
    rec_tz: str,
    range_from: datetime | None = None,
    range_to: datetime | None = None,
) -> list[datetime]:
    """Return original occurrence starts (UTC) intersecting optional ``[range_from, range_to)``.

    ``series_starts_at`` is the series anchor (UTC). Generation uses its wall time in ``rec_tz``.
    """
    if freq not in ("daily", "weekly", "monthly"):
        raise ValueError(f"unsupported freq: {freq}")
    tz = ZoneInfo(rec_tz)
    anchor_utc = series_starts_at.astimezone(timezone.utc)
    local = anchor_utc.astimezone(tz)
    wall_t = (local.hour, local.minute, local.second, local.microsecond)
    anchor_day = local.day

    range_from_u = range_from.astimezone(timezone.utc) if range_from else None
    range_to_u = range_to.astimezone(timezone.utc) if range_to else None

    cur_date = local.date()
    # For monthly, track (year, month) so clamp does not drift the month cursor.
    month_i = 0
    out: list[datetime] = []
    for _ in range(100_000):
        if freq == "monthly":
            y, m = _add_months(local.year, local.month, month_i)
            occ_date = _clamp_day(y, m, anchor_day)
        else:
            occ_date = cur_date

        if rec_until is not None and occ_date > rec_until:
            break

        wall = datetime(
            occ_date.year,
            occ_date.month,
            occ_date.day,
            wall_t[0],
            wall_t[1],
            wall_t[2],
            wall_t[3],
        )
        occ_utc = wall_to_utc(wall, tz)

        if range_to_u is not None and occ_utc >= range_to_u:
            break
        if range_from_u is None or occ_utc >= range_from_u:
            if range_to_u is None or occ_utc < range_to_u:
                out.append(occ_utc)

        if freq == "daily":
            cur_date = cur_date + timedelta(days=1)
        elif freq == "weekly":
            cur_date = cur_date + timedelta(days=7)
        else:
            month_i += 1

        if range_to_u is not None:
            limit_date = range_to_u.astimezone(tz).date() + timedelta(days=2)
            probe = (
                _clamp_day(*_add_months(local.year, local.month, month_i), anchor_day)
                if freq == "monthly"
                else cur_date
            )
            if probe > limit_date:
                break

    return out
