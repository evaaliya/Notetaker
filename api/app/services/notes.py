"""Note helpers: tag ownership and serialization payload."""

import uuid

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import AppError
from app.models import Note, NoteTag, Tag
from app.schemas.notes import NoteOut


async def load_tag_ids(db: AsyncSession, note_id: uuid.UUID) -> list[uuid.UUID]:
    result = await db.execute(select(NoteTag.tag_id).where(NoteTag.note_id == note_id))
    return list(result.scalars().all())


async def note_to_out(db: AsyncSession, note: Note) -> NoteOut:
    tag_ids = await load_tag_ids(db, note.id)
    return NoteOut(
        id=note.id,
        title=note.title,
        body=note.body,
        starts_at=note.starts_at,
        status=note.status,
        reminder_offsets=list(note.reminder_offsets or []),
        version=note.version,
        deleted_at=note.deleted_at,
        created_at=note.created_at,
        updated_at=note.updated_at,
        tag_ids=tag_ids,
        rec_freq=note.rec_freq,
        rec_until=note.rec_until,
        rec_tz=note.rec_tz,
    )


async def replace_note_tags(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    note_id: uuid.UUID,
    tag_ids: list[uuid.UUID],
) -> None:
    unique_ids = list(dict.fromkeys(tag_ids))
    if unique_ids:
        result = await db.execute(
            select(Tag.id).where(Tag.user_id == user_id, Tag.id.in_(unique_ids))
        )
        found = set(result.scalars().all())
        missing = [str(t) for t in unique_ids if t not in found]
        if missing:
            raise AppError("validation_error", f"unknown tag_ids: {', '.join(missing)}")
    await db.execute(delete(NoteTag).where(NoteTag.note_id == note_id))
    for tag_id in unique_ids:
        db.add(NoteTag(note_id=note_id, tag_id=tag_id))
