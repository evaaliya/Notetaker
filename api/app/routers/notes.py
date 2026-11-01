import uuid
from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_clock, get_current_user
from app.clock import Clock
from app.db import get_session
from app.errors import AppError
from app.models import Note, NoteMember, User
from app.schemas.notes import MemberOut, NoteCreate, NoteListOut, NoteOut, NotePatch, ShareIn
from app.services.access import (
    create_access_granted_notification,
    get_note_access,
    notify_note_audience,
)
from app.services.note_list import list_notes
from app.services.notes import note_to_out, notes_to_out, replace_note_tags
from app.services.reminders import (
    materialize_series_note,
    materialize_single_note,
    rebuild_pending_for_note,
    rebuild_pending_for_series,
)
from app.services.series_edit import (
    delete_occurrence_this,
    patch_occurrence_this,
    patch_series_following,
)

router = APIRouter(prefix="/notes", tags=["notes"])

Scope = Literal["this", "following", "all"]


def _parse_occurrence_start(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        raise AppError("validation_error", "occurrence_start must be timezone-aware")
    return value.astimezone(timezone.utc)


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
    items = await notes_to_out(db, rows, viewer_id=user.id)
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
        updated_by_user_id=user.id,
        source=body.source,
        source_url=body.source_url,
        source_ts=body.source_ts,
        ai_generated=body.ai_generated,
        show_in_calendar=body.show_in_calendar,
    )
    if body.recurrence is not None:
        note.rec_freq = body.recurrence.freq
        note.rec_until = body.recurrence.until
        note.rec_tz = body.recurrence.tz
    db.add(note)
    await db.flush()
    await replace_note_tags(db, user_id=user.id, note_id=note.id, tag_ids=body.tag_ids)
    if note.rec_freq is None:
        await materialize_single_note(
            db,
            note_id=note.id,
            starts_at=note.starts_at,
            reminder_offsets=list(note.reminder_offsets or []),
            now=now,
        )
    else:
        await materialize_series_note(db, note=note, now=now)
    await notify_note_audience(db, note, "note.changed", ids=[note.id], version=note.version)
    await db.commit()
    await db.refresh(note)
    return await note_to_out(db, note, viewer_id=user.id)


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
    return await notes_to_out(db, notes, viewer_id=user.id)


@router.get("/{note_id}/members", response_model=list[MemberOut])
async def list_members(
    note_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_session)],
) -> list[MemberOut]:
    await get_note_access(db, user.id, note_id, allow_deleted=False, require_owner=True)
    result = await db.execute(
        select(NoteMember, User)
        .join(User, User.id == NoteMember.user_id)
        .where(NoteMember.note_id == note_id)
        .order_by(User.login.asc())
    )
    rows = result.all()
    return [
        MemberOut(user_id=m.user_id, login=u.login, role="editor", created_at=m.created_at)
        for m, u in rows
    ]


@router.post("/{note_id}/members", response_model=MemberOut, status_code=201)
async def add_member(
    note_id: uuid.UUID,
    body: ShareIn,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_session)],
    clock: Annotated[Clock, Depends(get_clock)],
) -> MemberOut:
    access = await get_note_access(db, user.id, note_id, allow_deleted=False, require_owner=True)
    login = body.login.strip()
    if not login:
        raise AppError("validation_error", "Укажите логин пользователя")
    target = (
        await db.execute(
            select(User).where((User.login == login) | (User.email == login))
        )
    ).scalar_one_or_none()
    if target is None:
        raise AppError(
            "not_found",
            "Пользователь с таким логином не найден",
            status_code=404,
        )
    if target.id == access.note.user_id:
        raise AppError("validation_error", "cannot share with the owner")
    existing = (
        await db.execute(
            select(NoteMember).where(
                NoteMember.note_id == note_id, NoteMember.user_id == target.id
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return MemberOut(
            user_id=existing.user_id,
            login=target.login,
            role="editor",
            created_at=existing.created_at,
        )
    now = clock.now()
    member = NoteMember(
        note_id=note_id, user_id=target.id, role="editor", created_at=now
    )
    db.add(member)
    await db.flush()
    await create_access_granted_notification(
        db,
        member_id=target.id,
        note=access.note,
        owner_login=access.owner.login,
        now=now,
    )
    await notify_note_audience(
        db, access.note, "note.changed", ids=[note_id], version=access.note.version
    )
    await db.commit()
    return MemberOut(
        user_id=member.user_id, login=target.login, role="editor", created_at=member.created_at
    )


@router.delete("/{note_id}/members/{member_id}", status_code=204)
async def remove_member(
    note_id: uuid.UUID,
    member_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    access = await get_note_access(db, user.id, note_id, allow_deleted=False, require_owner=True)
    result = await db.execute(
        select(NoteMember).where(NoteMember.note_id == note_id, NoteMember.user_id == member_id)
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise AppError("not_found", "member not found", status_code=404)
    await db.delete(row)
    from app.services.realtime import notify_user

    await notify_note_audience(
        db, access.note, "note.changed", ids=[note_id], version=access.note.version
    )
    # Removed member is no longer in audience — notify explicitly so list drops the note.
    await notify_user(
        db, member_id, "note.changed", ids=[note_id], version=access.note.version
    )
    await db.commit()


@router.post("/{note_id}/members/me/leave", status_code=204)
async def leave_note(
    note_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    access = await get_note_access(db, user.id, note_id, allow_deleted=False)
    if access.role != "editor":
        raise AppError("not_found", "note not found", status_code=404)
    result = await db.execute(
        select(NoteMember).where(NoteMember.note_id == note_id, NoteMember.user_id == user.id)
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise AppError("not_found", "note not found", status_code=404)
    await db.delete(row)
    await notify_note_audience(
        db, access.note, "note.changed", ids=[note_id], version=access.note.version
    )
    await db.commit()


@router.get("/{note_id}", response_model=NoteOut)
async def get_note(
    note_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_session)],
) -> NoteOut:
    access = await get_note_access(db, user.id, note_id, allow_deleted=True)
    return await note_to_out(
        db, access.note, viewer_id=user.id, owner_login=access.owner.login, role=access.role
    )


@router.patch("/{note_id}", response_model=NoteOut)
async def patch_note(
    note_id: uuid.UUID,
    body: NotePatch,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_session)],
    clock: Annotated[Clock, Depends(get_clock)],
    scope: Scope = Query("all"),
    occurrence_start: datetime | None = None,
) -> NoteOut:
    access = await get_note_access(db, user.id, note_id, allow_deleted=False)
    note = access.note
    data = body.model_dump(exclude_unset=True)
    version = data.pop("version")
    if not data:
        raise AppError("validation_error", "No fields to update besides version")

    now = clock.now()
    occ = _parse_occurrence_start(occurrence_start)

    if note.version != version:
        out = await note_to_out(
            db, note, viewer_id=user.id, owner_login=access.owner.login, role=access.role
        )
        raise AppError(
            "version_conflict",
            "note was modified",
            status_code=409,
            extra={"note": out.model_dump(mode="json")},
        )

    if scope == "this":
        if occ is None:
            raise AppError("validation_error", "occurrence_start required for scope=this")
        note = await patch_occurrence_this(
            db, note=note, original_start=occ, fields=data, now=now
        )
        note.updated_by_user_id = user.id
        await notify_note_audience(db, note, "note.changed", ids=[note.id], version=note.version)
        await db.commit()
        access = await get_note_access(db, user.id, note_id, allow_deleted=False)
        return await note_to_out(
            db, access.note, viewer_id=user.id, owner_login=access.owner.login, role=access.role
        )

    if scope == "following":
        if occ is None:
            raise AppError("validation_error", "occurrence_start required for scope=following")
        # New series stays with the note owner (not the editor).
        new_note = await patch_series_following(
            db,
            note=note,
            original_start=occ,
            fields=data,
            now=now,
            user_id=note.user_id,
            actor_id=user.id,
        )
        new_note.updated_by_user_id = user.id
        note.updated_by_user_id = user.id
        await notify_note_audience(
            db,
            note,
            "note.changed",
            ids=[note.id, new_note.id],
            version=new_note.version,
        )
        await db.commit()
        return await note_to_out(db, new_note, viewer_id=user.id)

    # scope=all — update master (optimistic lock via UPDATE … version)
    schedule_changed = "starts_at" in data or "reminder_offsets" in data or "recurrence" in data
    values: dict = {
        "version": Note.version + 1,
        "updated_at": now,
        "updated_by_user_id": user.id,
    }
    if "title" in data:
        values["title"] = data["title"]
    if "body" in data:
        values["body"] = data["body"]
    if "starts_at" in data:
        values["starts_at"] = data["starts_at"]
    if "reminder_offsets" in data:
        values["reminder_offsets"] = data["reminder_offsets"]
    if "source" in data:
        values["source"] = data["source"]
    if "source_url" in data:
        values["source_url"] = data["source_url"]
    if "source_ts" in data:
        values["source_ts"] = data["source_ts"]
    if "ai_generated" in data:
        values["ai_generated"] = data["ai_generated"]
    if "show_in_calendar" in data:
        values["show_in_calendar"] = data["show_in_calendar"]
    if "recurrence" in data:
        rec = data["recurrence"]
        if rec is None:
            values["rec_freq"] = None
            values["rec_until"] = None
            values["rec_tz"] = None
        else:
            values["rec_freq"] = rec["freq"]
            values["rec_until"] = rec["until"]
            if note.rec_tz is None:
                values["rec_tz"] = rec["tz"]

    result = await db.execute(
        update(Note)
        .where(
            Note.id == note_id,
            Note.version == version,
            Note.deleted_at.is_(None),
        )
        .values(**values)
    )
    if result.rowcount == 0:
        await db.rollback()
        access = await get_note_access(db, user.id, note_id, allow_deleted=True)
        out = await note_to_out(
            db,
            access.note,
            viewer_id=user.id,
            owner_login=access.owner.login,
            role=access.role,
        )
        raise AppError(
            "version_conflict",
            "note was modified",
            status_code=409,
            extra={"note": out.model_dump(mode="json")},
        )

    if "tag_ids" in data:
        # Personal tags for the acting user (M16); do not touch others' assignments.
        await replace_note_tags(
            db, user_id=user.id, note_id=note_id, tag_ids=data["tag_ids"]
        )

    access = await get_note_access(db, user.id, note_id, allow_deleted=False)
    note = access.note
    if schedule_changed:
        if note.rec_freq is None:
            await rebuild_pending_for_note(
                db,
                note_id=note.id,
                starts_at=note.starts_at,
                reminder_offsets=list(note.reminder_offsets or []),
                now=now,
            )
        else:
            await rebuild_pending_for_series(db, note=note, now=now)

    await notify_note_audience(db, note, "note.changed", ids=[note.id], version=note.version)
    await db.commit()
    access = await get_note_access(db, user.id, note_id, allow_deleted=False)
    return await note_to_out(
        db, access.note, viewer_id=user.id, owner_login=access.owner.login, role=access.role
    )


@router.delete("/{note_id}", response_model=NoteOut)
async def delete_note(
    note_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_session)],
    clock: Annotated[Clock, Depends(get_clock)],
    scope: Scope = Query("all"),
    occurrence_start: datetime | None = None,
) -> NoteOut:
    access = await get_note_access(
        db, user.id, note_id, allow_deleted=False, require_owner=True
    )
    note = access.note
    now = clock.now()
    if scope == "this":
        occ = _parse_occurrence_start(occurrence_start)
        if occ is None:
            raise AppError("validation_error", "occurrence_start required for scope=this")
        note = await delete_occurrence_this(db, note=note, original_start=occ, now=now)
        note.updated_by_user_id = user.id
        await notify_note_audience(db, note, "note.changed", ids=[note.id], version=note.version)
        await db.commit()
        access = await get_note_access(db, user.id, note_id, allow_deleted=False)
        return await note_to_out(
            db, access.note, viewer_id=user.id, owner_login=access.owner.login, role=access.role
        )

    note.deleted_at = now
    note.updated_at = now
    note.version += 1
    note.updated_by_user_id = user.id
    await notify_note_audience(db, note, "note.deleted", ids=[note.id], version=note.version)
    await db.commit()
    await db.refresh(note)
    return await note_to_out(
        db, note, viewer_id=user.id, owner_login=access.owner.login, role="owner"
    )


@router.post("/{note_id}/activate", response_model=NoteOut)
async def activate_note(
    note_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_session)],
    clock: Annotated[Clock, Depends(get_clock)],
) -> NoteOut:
    return await _set_status(db, user, note_id, "active", clock)


@router.post("/{note_id}/deactivate", response_model=NoteOut)
async def deactivate_note(
    note_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_session)],
    clock: Annotated[Clock, Depends(get_clock)],
) -> NoteOut:
    return await _set_status(db, user, note_id, "inactive", clock)


@router.post("/{note_id}/restore", response_model=NoteOut)
async def restore_note(
    note_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_session)],
    clock: Annotated[Clock, Depends(get_clock)],
) -> NoteOut:
    access = await get_note_access(
        db, user.id, note_id, allow_deleted=True, require_owner=True
    )
    note = access.note
    if note.deleted_at is None:
        raise AppError("validation_error", "note is not in trash")
    now = clock.now()
    note.deleted_at = None
    note.updated_at = now
    note.version += 1
    note.updated_by_user_id = user.id
    await notify_note_audience(db, note, "note.restored", ids=[note.id], version=note.version)
    await db.commit()
    await db.refresh(note)
    return await note_to_out(
        db, note, viewer_id=user.id, owner_login=access.owner.login, role="owner"
    )


async def _set_status(
    db: AsyncSession,
    user: User,
    note_id: uuid.UUID,
    status: str,
    clock: Clock,
) -> NoteOut:
    access = await get_note_access(
        db, user.id, note_id, allow_deleted=False, require_owner=True
    )
    note = access.note
    note.status = status
    note.updated_at = clock.now()
    note.version += 1
    note.updated_by_user_id = user.id
    await notify_note_audience(db, note, "note.changed", ids=[note.id], version=note.version)
    await db.commit()
    await db.refresh(note)
    return await note_to_out(
        db, note, viewer_id=user.id, owner_login=access.owner.login, role="owner"
    )
