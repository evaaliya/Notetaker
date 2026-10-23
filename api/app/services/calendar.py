"""Calendar range and upcoming buckets (singles only until M5)."""

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


def local_midnight_utc(day: date, tz_name: str) -> datetime:
    try:
        tz = ZoneInfo(tz_name)
    except ZoneInfoNotFoundError as exc:
        raise AppError("validation_error", f"Unknown IANA timezone: {tz_name}") from exc
    return datetime(day.year, day.month, day.day, tzinfo=tz).astimezone(timezone.utc)


def upcoming_bounds(now: datetime, tz_name: str) -> tuple[datetime, datetime, datetime]:
    """Return (today_start, tomorrow_start, week_end) in UTC.

    today = [today_start, tomorrow_start)
    week  = [tomorrow_start, today_start + 7 days)  # rest of rolling week after today
    past  = starts_at < now
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


async def _singles_in_range(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    from_dt: datetime,
    to_dt: datetime,
    status: str | None = None,
) -> list[Note]:
    stmt = (
        select(Note)
        .where(
            Note.user_id == user_id,
            Note.deleted_at.is_(None),
            Note.rec_freq.is_(None),
            Note.starts_at >= from_dt,
            Note.starts_at < to_dt,
        )
        .order_by(Note.starts_at.asc(), Note.id.asc())
    )
    if status is not None:
        stmt = stmt.where(Note.status == status)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def _to_occurrences(db: AsyncSession, notes: list[Note]) -> list[OccurrenceOut]:
    out: list[OccurrenceOut] = []
    for note in notes:
        out.append(
            OccurrenceOut(
                occurrence_start=note.starts_at,
                note=await note_to_out(db, note),
            )
        )
    return out


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
    notes = await _singles_in_range(db, user_id=user_id, from_dt=from_u, to_dt=to_u)
    return await _to_occurrences(db, notes)


async def list_upcoming(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    now: datetime,
    tz_name: str,
) -> tuple[list[OccurrenceOut], list[OccurrenceOut], list[OccurrenceOut]]:
    today_start, tomorrow_start, week_end = upcoming_bounds(now, tz_name)
    now_u = now.astimezone(timezone.utc)

    today_notes = await _singles_in_range(
        db,
        user_id=user_id,
        from_dt=today_start,
        to_dt=tomorrow_start,
        status="active",
    )
    week_notes = await _singles_in_range(
        db,
        user_id=user_id,
        from_dt=tomorrow_start,
        to_dt=week_end,
        status="active",
    )

    past_stmt = (
        select(Note)
        .where(
            Note.user_id == user_id,
            Note.deleted_at.is_(None),
            Note.rec_freq.is_(None),
            Note.status == "active",
            Note.starts_at < now_u,
        )
        .order_by(Note.starts_at.desc(), Note.id.desc())
        .limit(100)
    )
    past_result = await db.execute(past_stmt)
    past_notes = list(past_result.scalars().all())

    return (
        await _to_occurrences(db, today_notes),
        await _to_occurrences(db, week_notes),
        await _to_occurrences(db, past_notes),
    )
