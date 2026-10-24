"""Reminder materialization for single notes (series horizon — M5)."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta

from sqlalchemy import delete, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Reminder


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


async def rebuild_pending_for_note(
    db: AsyncSession,
    *,
    note_id: uuid.UUID,
    starts_at: datetime,
    reminder_offsets: list[int],
    now: datetime,
) -> None:
    """Drop pending rows and recreate from current note schedule (sent stay)."""
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
