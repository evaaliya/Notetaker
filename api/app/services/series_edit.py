"""Series edit scopes: this (override), following (split), all (master)."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import AppError
from app.models import Note, NoteTag, OccurrenceOverride
from app.services.notes import replace_note_tags
from app.services.occurrences import day_before_in_tz, iso_z
from app.services.reminders import rebuild_pending_for_occurrence, rebuild_pending_for_series


async def upsert_override(
    db: AsyncSession,
    *,
    note_id: uuid.UUID,
    original_start: datetime,
    is_deleted: bool = False,
    title: str | None = None,
    body: str | None = None,
    starts_at: datetime | None = None,
    set_starts: bool = False,
) -> OccurrenceOverride:
    orig = original_start.astimezone(timezone.utc)
    existing = await db.execute(
        select(OccurrenceOverride).where(
            OccurrenceOverride.note_id == note_id,
            OccurrenceOverride.original_start == orig,
        )
    )
    row = existing.scalar_one_or_none()
    starts_text = iso_z(starts_at) if set_starts and starts_at is not None else None
    if row is None:
        row = OccurrenceOverride(
            note_id=note_id,
            original_start=orig,
            is_deleted=is_deleted,
            title=title,
            body=body,
            starts_at=starts_text if set_starts else None,
        )
        db.add(row)
    else:
        row.is_deleted = is_deleted
        if title is not None:
            row.title = title
        if body is not None:
            row.body = body
        if set_starts:
            row.starts_at = starts_text
    await db.flush()
    return row


async def patch_occurrence_this(
    db: AsyncSession,
    *,
    note: Note,
    original_start: datetime,
    fields: dict[str, Any],
    now: datetime,
) -> Note:
    if note.rec_freq is None:
        raise AppError("validation_error", "scope=this requires a recurring note")
    if any(k in fields for k in ("reminder_offsets", "tag_ids", "recurrence")):
        raise AppError(
            "validation_error",
            "scope=this only supports title, body, starts_at",
        )
    await upsert_override(
        db,
        note_id=note.id,
        original_start=original_start,
        is_deleted=False,
        title=fields.get("title") if "title" in fields else None,
        body=fields.get("body") if "body" in fields else None,
        starts_at=fields.get("starts_at") if "starts_at" in fields else None,
        set_starts="starts_at" in fields,
    )
    # Bump master version so clients invalidate
    note.updated_at = now
    note.version += 1
    await rebuild_pending_for_occurrence(db, note=note, original_start=original_start, now=now)
    return note


async def delete_occurrence_this(
    db: AsyncSession,
    *,
    note: Note,
    original_start: datetime,
    now: datetime,
) -> Note:
    if note.rec_freq is None:
        raise AppError("validation_error", "scope=this delete requires a recurring note")
    await upsert_override(
        db,
        note_id=note.id,
        original_start=original_start,
        is_deleted=True,
    )
    note.updated_at = now
    note.version += 1
    await rebuild_pending_for_occurrence(db, note=note, original_start=original_start, now=now)
    return note


async def patch_series_following(
    db: AsyncSession,
    *,
    note: Note,
    original_start: datetime,
    fields: dict[str, Any],
    now: datetime,
    user_id: uuid.UUID,
) -> Note:
    """Split series at occurrence: old ends day_before; new note from this day onward."""
    if note.rec_freq is None or note.rec_tz is None:
        raise AppError("validation_error", "scope=following requires a recurring note")

    prior_until = note.rec_until
    split = original_start.astimezone(timezone.utc)
    until_old = day_before_in_tz(split, note.rec_tz)

    note.rec_until = until_old
    note.updated_at = now
    note.version += 1

    new_starts = fields["starts_at"].astimezone(timezone.utc) if "starts_at" in fields else split
    new_title = fields["title"] if "title" in fields else note.title
    new_body = fields["body"] if "body" in fields else note.body
    new_offsets = (
        fields["reminder_offsets"]
        if "reminder_offsets" in fields
        else list(note.reminder_offsets or [])
    )

    if "recurrence" in fields and fields["recurrence"] is not None:
        rec = fields["recurrence"]
        new_freq = rec["freq"] if isinstance(rec, dict) else rec.freq
        new_until = rec["until"] if isinstance(rec, dict) else rec.until
        new_tz = rec["tz"] if isinstance(rec, dict) else rec.tz
    else:
        new_freq = note.rec_freq
        new_until = prior_until
        new_tz = note.rec_tz

    new_note = Note(
        id=uuid.uuid4(),
        user_id=user_id,
        title=new_title,
        body=new_body,
        starts_at=new_starts,
        status=note.status,
        reminder_offsets=new_offsets,
        version=1,
        created_at=now,
        updated_at=now,
        rec_freq=new_freq,
        rec_until=new_until,
        rec_tz=new_tz,
    )
    db.add(new_note)
    await db.flush()

    tag_result = await db.execute(select(NoteTag.tag_id).where(NoteTag.note_id == note.id))
    tag_ids = list(tag_result.scalars().all())
    if "tag_ids" in fields:
        tag_ids = fields["tag_ids"]
    await replace_note_tags(db, user_id=user_id, note_id=new_note.id, tag_ids=tag_ids)

    ov_result = await db.execute(
        select(OccurrenceOverride).where(OccurrenceOverride.note_id == note.id)
    )
    for ov in list(ov_result.scalars().all()):
        if ov.original_start.astimezone(timezone.utc) >= split:
            ov.note_id = new_note.id

    await rebuild_pending_for_series(db, note=note, now=now)
    await rebuild_pending_for_series(db, note=new_note, now=now)
    return new_note
