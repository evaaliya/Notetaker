"""Reminder materialization for singles and series (60-day horizon)."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Note, OccurrenceOverride, Reminder
from app.services.occurrences import effective_start, load_overrides
from app.services.recurrence import iter_occurrence_starts

SERIES_HORIZON_DAYS = 60


async def materialize_single_note(
    db: AsyncSession,
    *,
    note_id: uuid.UUID,
    starts_at: datetime,
    reminder_offsets: list[int],
    now: datetime,
) -> int:
    """Insert pending reminders for a non-recurring note.

    Rows with ``fire_at <= now`` are skipped (cannot remind in the past).
    ``ON CONFLICT DO NOTHING`` keeps existing rows (e.g. already ``sent``).
    """
    if not reminder_offsets:
        return 0
    rows: list[dict] = []
    for offset_min in reminder_offsets:
        fire_at = starts_at - timedelta(minutes=offset_min)
        if fire_at <= now:
            continue
        rows.append(
            {
                "id": uuid.uuid4(),
                "note_id": note_id,
                "occurrence_start": starts_at,
                "offset_min": offset_min,
                "fire_at": fire_at,
                "status": "pending",
            }
        )
    if not rows:
        return 0
    stmt = insert(Reminder).values(rows).on_conflict_do_nothing(
        constraint="uq_reminders_note_occ_offset"
    )
    result = await db.execute(stmt)
    return result.rowcount or 0


async def materialize_series_note(
    db: AsyncSession,
    *,
    note: Note,
    now: datetime,
    horizon_days: int = SERIES_HORIZON_DAYS,
) -> int:
    """Materialize reminders for series occurrences up to ``now + horizon_days``.

    ``occurrence_start`` in reminders is the **original** key; ``fire_at`` uses effective start.
    Deleted overrides are skipped. ``ON CONFLICT DO NOTHING``.
    """
    offsets = list(note.reminder_offsets or [])
    if not offsets or note.rec_freq is None or note.rec_tz is None:
        return 0
    now_u = now.astimezone(timezone.utc)
    max_offset = max(offsets) if offsets else 0
    range_from = now_u - timedelta(minutes=max_offset)
    range_to = now_u + timedelta(days=horizon_days)
    originals = iter_occurrence_starts(
        series_starts_at=note.starts_at,
        freq=note.rec_freq,
        rec_until=note.rec_until,
        rec_tz=note.rec_tz,
        range_from=range_from,
        range_to=range_to,
    )
    ov_map = await load_overrides(db, [note.id])
    rows: list[dict] = []
    for original in originals:
        key = original.astimezone(timezone.utc)
        ov = ov_map.get((note.id, key))
        if ov is not None and ov.is_deleted:
            continue
        eff = effective_start(original, ov)
        for offset_min in offsets:
            fire_at = eff - timedelta(minutes=offset_min)
            if fire_at <= now_u:
                continue
            rows.append(
                {
                    "id": uuid.uuid4(),
                    "note_id": note.id,
                    "occurrence_start": key,
                    "offset_min": offset_min,
                    "fire_at": fire_at,
                    "status": "pending",
                }
            )
    if not rows:
        return 0
    # insert in chunks to avoid huge payloads
    inserted = 0
    chunk = 500
    for i in range(0, len(rows), chunk):
        stmt = insert(Reminder).values(rows[i : i + chunk]).on_conflict_do_nothing(
            constraint="uq_reminders_note_occ_offset"
        )
        result = await db.execute(stmt)
        inserted += result.rowcount or 0
    return inserted


async def rebuild_pending_for_note(
    db: AsyncSession,
    *,
    note_id: uuid.UUID,
    starts_at: datetime,
    reminder_offsets: list[int],
    now: datetime,
) -> None:
    """Drop pending rows and recreate for a single (non-series) note."""
    await db.execute(
        delete(Reminder).where(Reminder.note_id == note_id, Reminder.status == "pending")
    )
    await materialize_single_note(
        db,
        note_id=note_id,
        starts_at=starts_at,
        reminder_offsets=reminder_offsets,
        now=now,
    )
    await db.execute(text("SELECT pg_notify('reminders_changed', :payload)"), {"payload": str(note_id)})


async def rebuild_pending_for_series(db: AsyncSession, *, note: Note, now: datetime) -> None:
    """Drop all pending for series note and rematerialize horizon (sent stay)."""
    await db.execute(
        delete(Reminder).where(Reminder.note_id == note.id, Reminder.status == "pending")
    )
    await materialize_series_note(db, note=note, now=now)
    await db.execute(text("SELECT pg_notify('reminders_changed', :payload)"), {"payload": str(note.id)})


async def rebuild_pending_for_occurrence(
    db: AsyncSession,
    *,
    note: Note,
    original_start: datetime,
    now: datetime,
) -> None:
    """Recreate pending reminders for one occurrence (after override edit)."""
    orig = original_start.astimezone(timezone.utc)
    await db.execute(
        delete(Reminder).where(
            Reminder.note_id == note.id,
            Reminder.occurrence_start == orig,
            Reminder.status == "pending",
        )
    )
    offsets = list(note.reminder_offsets or [])
    if not offsets:
        return
    result = await db.execute(
        select(OccurrenceOverride).where(
            OccurrenceOverride.note_id == note.id,
            OccurrenceOverride.original_start == orig,
        )
    )
    ov = result.scalar_one_or_none()
    if ov is not None and ov.is_deleted:
        return
    eff = effective_start(orig, ov)
    now_u = now.astimezone(timezone.utc)
    rows: list[dict] = []
    for offset_min in offsets:
        fire_at = eff - timedelta(minutes=offset_min)
        if fire_at <= now_u:
            continue
        rows.append(
            {
                "id": uuid.uuid4(),
                "note_id": note.id,
                "occurrence_start": orig,
                "offset_min": offset_min,
                "fire_at": fire_at,
                "status": "pending",
            }
        )
    if rows:
        await db.execute(
            insert(Reminder).values(rows).on_conflict_do_nothing(
                constraint="uq_reminders_note_occ_offset"
            )
        )
    await db.execute(text("SELECT pg_notify('reminders_changed', :payload)"), {"payload": str(note.id)})


async def extend_all_series_horizons(db: AsyncSession, now: datetime) -> int:
    """Hourly / startup: materialize upcoming reminders for all active series (ON CONFLICT)."""
    result = await db.execute(
        select(Note).where(
            Note.deleted_at.is_(None),
            Note.rec_freq.is_not(None),
            Note.status == "active",
        )
    )
    total = 0
    for note in result.scalars().all():
        total += await materialize_series_note(db, note=note, now=now)
    return total
