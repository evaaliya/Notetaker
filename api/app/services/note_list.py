"""Server-side note list: filters, pg_trgm search, keyset pagination (D-014)."""

from __future__ import annotations

import base64
import json
import uuid
from datetime import datetime, timezone
from typing import Literal

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import ColumnElement

from app.errors import AppError
from app.models import Note, NoteTag

SortField = Literal["starts_at", "updated_at"]
SortDir = Literal["asc", "desc"]
TagMode = Literal["any", "all"]


def encode_cursor(sort_value: datetime, note_id: uuid.UUID) -> str:
    payload = {
        "k": sort_value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "id": str(note_id),
    }
    raw = json.dumps(payload, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        pad = "=" * (-len(cursor) % 4)
        data = json.loads(base64.urlsafe_b64decode(cursor + pad))
        k = datetime.fromisoformat(data["k"].replace("Z", "+00:00"))
        if k.tzinfo is None:
            raise ValueError("cursor k must be aware")
        return k.astimezone(timezone.utc), uuid.UUID(data["id"])
    except (KeyError, ValueError, json.JSONDecodeError, TypeError) as exc:
        raise AppError("validation_error", "invalid cursor") from exc


def _search_clause(q: str) -> ColumnElement[bool]:
    needle = q.strip().casefold()
    expr = func.lower(Note.title + " " + Note.body)
    return expr.like(f"%{needle}%")


def _period_clause(from_dt: datetime | None, to_dt: datetime | None) -> ColumnElement[bool] | None:
    """Period filter; series use approximate [starts_at, rec_until] intersection (spec §8)."""
    if from_dt is None and to_dt is None:
        return None
    clauses: list[ColumnElement[bool]] = []
    if to_dt is not None:
        clauses.append(Note.starts_at <= to_dt)
    if from_dt is not None:
        from_date = from_dt.astimezone(timezone.utc).date()
        single = and_(Note.rec_freq.is_(None), Note.starts_at >= from_dt)
        series = and_(
            Note.rec_freq.is_not(None),
            or_(Note.rec_until.is_(None), Note.rec_until >= from_date),
        )
        clauses.append(or_(single, series))
    return and_(*clauses)


async def list_notes(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    q: str | None = None,
    tags: list[uuid.UUID] | None = None,
    tag_mode: TagMode = "any",
    status: str | None = None,
    from_dt: datetime | None = None,
    to_dt: datetime | None = None,
    sort: SortField = "starts_at",
    dir: SortDir = "asc",
    cursor: str | None = None,
    limit: int = 50,
) -> tuple[list[Note], str | None]:
    if limit < 1 or limit > 200:
        raise AppError("validation_error", "limit must be 1..200")

    sort_col = Note.starts_at if sort == "starts_at" else Note.updated_at
    descending = dir == "desc"

    stmt = select(Note).where(Note.user_id == user_id, Note.deleted_at.is_(None))

    if status is not None:
        if status not in ("active", "inactive"):
            raise AppError("validation_error", "status must be active|inactive")
        stmt = stmt.where(Note.status == status)

    if q and q.strip():
        stmt = stmt.where(_search_clause(q))

    period = _period_clause(from_dt, to_dt)
    if period is not None:
        stmt = stmt.where(period)

    if tags:
        nt = (
            select(NoteTag.note_id)
            .where(NoteTag.tag_id.in_(tags))
            .group_by(NoteTag.note_id)
        )
        if tag_mode == "all":
            nt = nt.having(func.count(func.distinct(NoteTag.tag_id)) >= len(tags))
        stmt = stmt.where(Note.id.in_(nt))

    if cursor:
        ck, cid = decode_cursor(cursor)
        if descending:
            stmt = stmt.where(
                or_(
                    sort_col < ck,
                    and_(sort_col == ck, Note.id < cid),
                )
            )
        else:
            stmt = stmt.where(
                or_(
                    sort_col > ck,
                    and_(sort_col == ck, Note.id > cid),
                )
            )

    if descending:
        stmt = stmt.order_by(sort_col.desc(), Note.id.desc())
    else:
        stmt = stmt.order_by(sort_col.asc(), Note.id.asc())

    stmt = stmt.limit(limit + 1)
    rows = list((await db.execute(stmt)).scalars().all())
    next_cursor = None
    if len(rows) > limit:
        rows = rows[:limit]
        last = rows[-1]
        sort_value = last.starts_at if sort == "starts_at" else last.updated_at
        next_cursor = encode_cursor(sort_value, last.id)
    return rows, next_cursor
