import uuid
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_clock, get_current_user
from app.clock import Clock
from app.db import get_session
from app.errors import AppError
from app.models import Note, User
from app.schemas.notes import NoteCreate, NoteListOut, NoteOut, NotePatch
from app.services.note_list import list_notes
from app.services.notes import note_to_out, replace_note_tags

router = APIRouter(prefix="/notes", tags=["notes"])


@router.get("", response_model=NoteListOut)
async def get_notes(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_session)],
    q: str | None = None,
    tags: Annotated[list[uuid.UUID] | None, Query()] = None,
    tag_mode: Literal["any", "all"] = "any",
    status: str | None = None,
    from_: Annotated[datetime | None, Query(alias="from")] = None,
    to: datetime | None = None,
    sort: Literal["starts_at", "updated_at"] = "starts_at",
    dir: Literal["asc", "desc"] = "asc",
    cursor: str | None = None,
    limit: int = 50,
) -> NoteListOut:
    rows, next_cursor = await list_notes(
        db,
        user_id=user.id,
        q=q,
        tags=tags,
        tag_mode=tag_mode,
        status=status,
        from_dt=from_,
        to_dt=to,
        sort=sort,
        dir=dir,
        cursor=cursor,
        limit=limit,
    )
    items = [await note_to_out(db, n) for n in rows]
    return NoteListOut(items=items, next_cursor=next_cursor)


@router.post("", response_model=NoteOut, status_code=201)
async def create_note(
    body: NoteCreate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_session)],
    clock: Annotated[Clock, Depends(get_clock)],
) -> NoteOut:
    now = clock.now()
    note = Note(
        id=uuid.uuid4(),
        user_id=user.id,
        title=body.title,
        body=body.body,
        starts_at=body.starts_at,
        status=body.status,
        reminder_offsets=body.reminder_offsets,
        version=1,
        created_at=now,
        updated_at=now,
    )
    if body.recurrence is not None:
        # TODO(spec-gap): occurrence generation / materialization — M5 / M3
        note.rec_freq = body.recurrence.freq
        note.rec_until = body.recurrence.until
        note.rec_tz = body.recurrence.tz
    db.add(note)
    await db.flush()
    await replace_note_tags(db, user_id=user.id, note_id=note.id, tag_ids=body.tag_ids)
    # TODO(spec-gap): reminder materialization — M3
    await db.commit()
    await db.refresh(note)
    return await note_to_out(db, note)


@router.get("/trash", response_model=list[NoteOut])
async def list_trash(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_session)],
) -> list[NoteOut]:
    result = await db.execute(
        select(Note)
        .where(Note.user_id == user.id, Note.deleted_at.is_not(None))
        .order_by(Note.deleted_at.desc(), Note.id.desc())
    )
    notes = list(result.scalars().all())
    return [await note_to_out(db, n) for n in notes]


@router.get("/{note_id}", response_model=NoteOut)
async def get_note(
    note_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_session)],
) -> NoteOut:
    note = await _get_owned_note(db, user.id, note_id, allow_deleted=True)
    return await note_to_out(db, note)


@router.patch("/{note_id}", response_model=NoteOut)
async def patch_note(
    note_id: uuid.UUID,
    body: NotePatch,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_session)],
    clock: Annotated[Clock, Depends(get_clock)],
) -> NoteOut:
    note = await _get_owned_note(db, user.id, note_id, allow_deleted=False)
    data = body.model_dump(exclude_unset=True)
    version = data.pop("version")
    if not data:
        raise AppError("validation_error", "No fields to update besides version")

    values: dict = {"version": Note.version + 1, "updated_at": clock.now()}
    if "title" in data:
        values["title"] = data["title"]
    if "body" in data:
        values["body"] = data["body"]
    if "starts_at" in data:
        values["starts_at"] = data["starts_at"]
    if "reminder_offsets" in data:
        values["reminder_offsets"] = data["reminder_offsets"]
        # TODO(spec-gap): rebuild pending reminders — M3
    if "recurrence" in data:
        # TODO(spec-gap): series split / overrides — M5
        rec = data["recurrence"]
        if rec is None:
            values["rec_freq"] = None
            values["rec_until"] = None
            values["rec_tz"] = None
        else:
            values["rec_freq"] = rec["freq"]
            values["rec_until"] = rec["until"]
            values["rec_tz"] = rec["tz"]

    user_id = user.id
    result = await db.execute(
        update(Note)
        .where(
            Note.id == note_id,
            Note.user_id == user_id,
            Note.version == version,
            Note.deleted_at.is_(None),
        )
        .values(**values)
    )
    if result.rowcount == 0:
        await db.rollback()
        current = await _get_owned_note(db, user_id, note_id, allow_deleted=True)
        out = await note_to_out(db, current)
        raise AppError(
            "version_conflict",
            "note was modified",
            status_code=409,
            extra={"note": out.model_dump(mode="json")},
        )

    if "tag_ids" in data:
        await replace_note_tags(db, user_id=user_id, note_id=note_id, tag_ids=data["tag_ids"])

    await db.commit()
    note = await _get_owned_note(db, user_id, note_id, allow_deleted=False)
    return await note_to_out(db, note)


@router.delete("/{note_id}", response_model=NoteOut)
async def delete_note(
    note_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_session)],
    clock: Annotated[Clock, Depends(get_clock)],
) -> NoteOut:
    note = await _get_owned_note(db, user.id, note_id, allow_deleted=False)
    now = clock.now()
    note.deleted_at = now
    note.updated_at = now
    note.version += 1
    await db.commit()
    await db.refresh(note)
    return await note_to_out(db, note)


@router.post("/{note_id}/activate", response_model=NoteOut)
async def activate_note(
    note_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_session)],
    clock: Annotated[Clock, Depends(get_clock)],
) -> NoteOut:
    return await _set_status(db, user.id, note_id, "active", clock)


@router.post("/{note_id}/deactivate", response_model=NoteOut)
async def deactivate_note(
    note_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_session)],
    clock: Annotated[Clock, Depends(get_clock)],
) -> NoteOut:
    return await _set_status(db, user.id, note_id, "inactive", clock)


@router.post("/{note_id}/restore", response_model=NoteOut)
async def restore_note(
    note_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_session)],
    clock: Annotated[Clock, Depends(get_clock)],
) -> NoteOut:
    note = await _get_owned_note(db, user.id, note_id, allow_deleted=True)
    if note.deleted_at is None:
        raise AppError("validation_error", "note is not in trash")
    now = clock.now()
    note.deleted_at = None
    note.updated_at = now
    note.version += 1
    await db.commit()
    await db.refresh(note)
    return await note_to_out(db, note)


async def _set_status(
    db: AsyncSession,
    user_id: uuid.UUID,
    note_id: uuid.UUID,
    status: str,
    clock: Clock,
) -> NoteOut:
    note = await _get_owned_note(db, user_id, note_id, allow_deleted=False)
    note.status = status
    note.updated_at = clock.now()
    note.version += 1
    await db.commit()
    await db.refresh(note)
    return await note_to_out(db, note)


async def _get_owned_note(
    db: AsyncSession,
    user_id: uuid.UUID,
    note_id: uuid.UUID,
    *,
    allow_deleted: bool,
) -> Note:
    result = await db.execute(select(Note).where(Note.id == note_id, Note.user_id == user_id))
    note = result.scalar_one_or_none()
    if note is None:
        raise AppError("not_found", "note not found", status_code=404)
    if not allow_deleted and note.deleted_at is not None:
        raise AppError("not_found", "note not found", status_code=404)
    return note
