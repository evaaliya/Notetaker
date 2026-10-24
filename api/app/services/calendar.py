"""Calendar range and upcoming buckets (singles + expanded series)."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import AppError
from app.models import Note
from app.schemas.calendar import OccurrenceOut
from app.services.notes import note_to_out
from app.services.occurrences import expand_note_in_range, load_overrides, series_may_intersect


def local_midnight_utc(day: date, tz_name: str) -> datetime:
    try:
        tz = ZoneInfo(tz_name)
    except ZoneInfoNotFoundError as exc:
        raise AppError("validation_error", f"Unknown IANA timezone: {tz_name}") from exc
    return datetime(day.year, day.month, day.day, tzinfo=tz).astimezone(timezone.utc)


def upcoming_bounds(now: datetime, tz_name: str) -> tuple[datetime, datetime, datetime]:
    """Return (today_start, tomorrow_start, week_end) in UTC.

    today = [today_start, tomorrow_start)
    week  = [tomorrow_start, today_start + 7 days)
    past  = effective start < now
    """
    if now.tzinfo is None:
        raise ValueError("now must be timezone-aware")
    try:
        tz = ZoneInfo(tz_name)
    except ZoneInfoNotFoundError as exc:
        raise AppError("validation_error", f"Unknown IANA timezone: {tz_name}") from exc
    local_day = now.astimezone(tz).date()
    today_start = local_midnight_utc(local_day, tz_name)
    tomorrow_start = local_midnight_utc(local_day + timedelta(days=1), tz_name)
    week_end = local_midnight_utc(local_day + timedelta(days=7), tz_name)
    return today_start, tomorrow_start, week_end


async def _notes_for_window(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    range_from: datetime,
    range_to: datetime,
    status: str | None = None,
) -> list[Note]:
    """Load candidate notes that may produce occurrences in the window."""
    stmt = select(Note).where(Note.user_id == user_id, Note.deleted_at.is_(None))
    if status is not None:
        stmt = stmt.where(Note.status == status)
    result = await db.execute(stmt)
    notes = list(result.scalars().all())
    return [n for n in notes if series_may_intersect(n, range_from, range_to) or (
        n.rec_freq is None and range_from <= n.starts_at.astimezone(timezone.utc) < range_to
    )]


async def expand_window(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    range_from: datetime,
    range_to: datetime,
    status: str | None = None,
) -> list[OccurrenceOut]:
    notes = await _notes_for_window(
        db, user_id=user_id, range_from=range_from, range_to=range_to, status=status
    )
    ov_map = await load_overrides(db, [n.id for n in notes])
    items: list[OccurrenceOut] = []
    for note in notes:
        base = await note_to_out(db, note)
        items.extend(
            await expand_note_in_range(
                db,
                note,
                range_from=range_from,
                range_to=range_to,
                overrides=ov_map,
                base_out=base,
            )
        )
    items.sort(key=lambda o: (o.occurrence_start, o.note.id))
    return items


async def list_calendar(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    from_dt: datetime,
    to_dt: datetime,
) -> list[OccurrenceOut]:
    if from_dt.tzinfo is None or to_dt.tzinfo is None:
        raise AppError("validation_error", "from/to must be timezone-aware")
    from_u = from_dt.astimezone(timezone.utc)
    to_u = to_dt.astimezone(timezone.utc)
    if from_u >= to_u:
        raise AppError("validation_error", "from must be before to")
    return await expand_window(db, user_id=user_id, range_from=from_u, range_to=to_u)


async def list_upcoming(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    now: datetime,
    tz_name: str,
) -> tuple[list[OccurrenceOut], list[OccurrenceOut], list[OccurrenceOut]]:
    today_start, tomorrow_start, week_end = upcoming_bounds(now, tz_name)
    now_u = now.astimezone(timezone.utc)

    today = await expand_window(
        db, user_id=user_id, range_from=today_start, range_to=tomorrow_start, status="active"
    )
    week = await expand_window(
        db, user_id=user_id, range_from=tomorrow_start, range_to=week_end, status="active"
    )

    # Past: occurrences with effective start in [now-30d, now) — cap volume for series.
    past_from = now_u - timedelta(days=30)
    past_all = await expand_window(
        db, user_id=user_id, range_from=past_from, range_to=now_u, status="active"
    )
    past_all.sort(key=lambda o: (o.occurrence_start, o.note.id), reverse=True)
    past = past_all[:100]

    return today, week, past
