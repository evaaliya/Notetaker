"""Note helpers: tag ownership and serialization payload."""

import uuid

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import AppError
from app.models import Note, NoteMember, NoteTag, Tag, User
from app.schemas.notes import NoteOut
from app.services.attachments import note_ids_with_attachments


async def load_tag_ids(db: AsyncSession, note_id: uuid.UUID) -> list[uuid.UUID]:
    result = await db.execute(select(NoteTag.tag_id).where(NoteTag.note_id == note_id))
    return list(result.scalars().all())


async def _login_map(db: AsyncSession, user_ids: list[uuid.UUID]) -> dict[uuid.UUID, str]:
    ids = list({u for u in user_ids if u is not None})
    if not ids:
        return {}
    result = await db.execute(select(User.id, User.login).where(User.id.in_(ids)))
    return {row.id: row.login for row in result.all()}


async def note_to_out(
    db: AsyncSession,
    note: Note,
    *,
    viewer_id: uuid.UUID | None = None,
    has_attachments: bool | None = None,
    owner_login: str | None = None,
    updated_by_login: str | None = None,
    role: str | None = None,
) -> NoteOut:
    tag_ids = await load_tag_ids(db, note.id)
    if has_attachments is None:
        flagged = await note_ids_with_attachments(db, [note.id])
        has_attachments = note.id in flagged

    if owner_login is None or updated_by_login is None:
        logins = await _login_map(
            db, [note.user_id, note.updated_by_user_id]  # type: ignore[list-item]
        )
        if owner_login is None:
            owner_login = logins.get(note.user_id)
        if updated_by_login is None and note.updated_by_user_id is not None:
            updated_by_login = logins.get(note.updated_by_user_id)

    if role is None and viewer_id is not None:
        if note.user_id == viewer_id:
            role = "owner"
        else:
            mem = await db.execute(
                select(NoteMember.user_id).where(
                    NoteMember.note_id == note.id, NoteMember.user_id == viewer_id
                )
            )
            role = "editor" if mem.scalar_one_or_none() is not None else None

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
        has_attachments=has_attachments,
        owner_login=owner_login,
        role=role,  # type: ignore[arg-type]
        updated_by_login=updated_by_login,
        source=note.source or "manual",  # type: ignore[arg-type]
        source_url=note.source_url,
        source_ts=note.source_ts,
        ai_generated=bool(note.ai_generated),
    )


async def notes_to_out(
    db: AsyncSession,
    notes: list[Note],
    *,
    viewer_id: uuid.UUID | None = None,
) -> list[NoteOut]:
    if not notes:
        return []
    flagged = await note_ids_with_attachments(db, [n.id for n in notes])
    login_ids: list[uuid.UUID] = []
    for n in notes:
        login_ids.append(n.user_id)
        if n.updated_by_user_id is not None:
            login_ids.append(n.updated_by_user_id)
    logins = await _login_map(db, login_ids)

    member_note_ids: set[uuid.UUID] = set()
    if viewer_id is not None:
        owned = {n.id for n in notes if n.user_id == viewer_id}
        candidates = [n.id for n in notes if n.id not in owned]
        if candidates:
            result = await db.execute(
                select(NoteMember.note_id).where(
                    NoteMember.user_id == viewer_id, NoteMember.note_id.in_(candidates)
                )
            )
            member_note_ids = set(result.scalars().all())

    out: list[NoteOut] = []
    for n in notes:
        role = None
        if viewer_id is not None:
            if n.user_id == viewer_id:
                role = "owner"
            elif n.id in member_note_ids:
                role = "editor"
        out.append(
            await note_to_out(
                db,
                n,
                viewer_id=viewer_id,
                has_attachments=n.id in flagged,
                owner_login=logins.get(n.user_id),
                updated_by_login=(
                    logins.get(n.updated_by_user_id) if n.updated_by_user_id else None
                ),
                role=role,
            )
        )
    return out


async def replace_note_tags(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    note_id: uuid.UUID,
    tag_ids: list[uuid.UUID],
) -> None:
    """``user_id`` must be the note owner (tags belong to the owner)."""
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
