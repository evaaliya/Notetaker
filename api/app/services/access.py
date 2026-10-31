"""Note access control for owners and shared members (M10)."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import ColumnElement

from app.errors import AppError
from app.models import Note, NoteMember, Notification, User
from app.services.realtime import notify_user

Role = Literal["owner", "editor"]


@dataclass(frozen=True)
class NoteAccess:
    note: Note
    role: Role
    owner: User


def accessible_notes_clause(user_id: uuid.UUID) -> ColumnElement[bool]:
    """SQL filter: own notes OR shared via note_members."""
    member_ids = select(NoteMember.note_id).where(NoteMember.user_id == user_id)
    return or_(Note.user_id == user_id, Note.id.in_(member_ids))


async def get_note_access(
    db: AsyncSession,
    user_id: uuid.UUID,
    note_id: uuid.UUID,
    *,
    allow_deleted: bool = True,
    require_owner: bool = False,
) -> NoteAccess:
    result = await db.execute(select(Note).where(Note.id == note_id))
    note = result.scalar_one_or_none()
    if note is None:
        raise AppError("not_found", "note not found", status_code=404)
    if not allow_deleted and note.deleted_at is not None:
        raise AppError("not_found", "note not found", status_code=404)

    owner = await db.get(User, note.user_id)
    if owner is None:
        raise AppError("not_found", "note not found", status_code=404)

    if note.user_id == user_id:
        return NoteAccess(note=note, role="owner", owner=owner)

    mem = await db.execute(
        select(NoteMember).where(NoteMember.note_id == note_id, NoteMember.user_id == user_id)
    )
    if mem.scalar_one_or_none() is None:
        raise AppError("not_found", "note not found", status_code=404)
    if require_owner:
        raise AppError("not_found", "note not found", status_code=404)
    return NoteAccess(note=note, role="editor", owner=owner)


async def list_audience_user_ids(db: AsyncSession, note: Note) -> list[uuid.UUID]:
    result = await db.execute(select(NoteMember.user_id).where(NoteMember.note_id == note.id))
    members = list(result.scalars().all())
    ids = [note.user_id, *members]
    seen: set[uuid.UUID] = set()
    out: list[uuid.UUID] = []
    for uid in ids:
        if uid not in seen:
            seen.add(uid)
            out.append(uid)
    return out


async def notify_note_audience(
    db: AsyncSession,
    note: Note,
    event_type: str,
    *,
    ids: list[uuid.UUID] | None = None,
    version: int | None = None,
    extra: dict[str, Any] | None = None,
) -> None:
    for uid in await list_audience_user_ids(db, note):
        await notify_user(db, uid, event_type, ids=ids, version=version, extra=extra)


async def create_access_granted_notification(
    db: AsyncSession,
    *,
    member_id: uuid.UUID,
    note: Note,
    owner_login: str,
    now: datetime,
) -> Notification:
    label = note.title.strip() if note.title and note.title.strip() else "Без названия"
    notif = Notification(
        id=uuid.uuid4(),
        user_id=member_id,
        reminder_id=None,
        title="Вам открыт доступ",
        body=f"Заметка «{label}» · владелец: {owner_login}",
        created_at=now,
        seen_at=None,
    )
    db.add(notif)
    await db.flush()
    await notify_user(
        db,
        member_id,
        "notification.new",
        ids=[notif.id],
        extra={"title": notif.title, "body": notif.body, "note_id": str(note.id)},
    )
    return notif
