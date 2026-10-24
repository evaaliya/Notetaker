"""Bulk seed notes for demo / perf / e2e (T17)."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.passwords import hash_password
from app.models import Note, NoteTag, Tag, User
from app.services.tags import set_tag_name

TAG_SPECS = [
    ("работа", "#2563EB"),
    ("дом", "#16A34A"),
    ("срочно", "#DC2626"),
    ("идеи", "#CA8A04"),
    ("здоровье", "#7C3AED"),
]

FREQS = ("daily", "weekly", "monthly")


async def ensure_demo_user(
    session: AsyncSession,
    *,
    login: str = "demo",
    password: str = "demo",
    email: str = "demo@example.com",
    timezone_name: str = "UTC",
    now: datetime | None = None,
) -> User:
    now = now or datetime.now(timezone.utc)
    result = await session.execute(select(User).where(User.login == login))
    user = result.scalar_one_or_none()
    if user is not None:
        user.email = email
        user.timezone = timezone_name
        return user
    user = User(
        id=uuid.uuid4(),
        login=login,
        password_hash=hash_password(password),
        email=email,
        timezone=timezone_name,
        created_at=now,
    )
    session.add(user)
    await session.flush()
    return user


async def ensure_seed_tags(session: AsyncSession, user_id: uuid.UUID) -> list[Tag]:
    tags: list[Tag] = []
    for name, color in TAG_SPECS:
        result = await session.execute(
            select(Tag).where(Tag.user_id == user_id, Tag.name_lower == name.casefold())
        )
        tag = result.scalar_one_or_none()
        if tag is None:
            tag = Tag(id=uuid.uuid4(), user_id=user_id, color=color)
            set_tag_name(tag, name)
            session.add(tag)
            await session.flush()
        tags.append(tag)
    return tags


async def count_user_notes(session: AsyncSession, user_id: uuid.UUID) -> int:
    result = await session.execute(
        select(func.count()).select_from(Note).where(Note.user_id == user_id)
    )
    return int(result.scalar_one())


async def seed_notes_for_user(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    count: int,
    now: datetime | None = None,
    batch_size: int = 500,
) -> int:
    """Insert ``count`` notes (tags, mixed dates, ~10% series). Returns inserted count.

    Skips reminder materialization — seed is for list/search/scroll load (T17).
    """
    if count <= 0:
        return 0
    now = now or datetime.now(timezone.utc)
    tags = await ensure_seed_tags(session, user_id)
    tag_ids = [t.id for t in tags]

    inserted = 0
    note_rows: list[dict] = []
    link_rows: list[dict] = []

    for i in range(count):
        note_id = uuid.uuid4()
        day_offset = (i % 730) - 365  # ~2 years window
        starts = now + timedelta(days=day_offset, hours=i % 24, minutes=(i * 7) % 60)
        is_series = i % 10 == 0
        rec_freq = FREQS[i % 3] if is_series else None
        rec_until: date | None = None
        rec_tz: str | None = None
        if is_series:
            rec_until = (starts.date() + timedelta(days=60))
            rec_tz = "UTC"
        status = "inactive" if i % 17 == 0 else "active"
        title = f"Seed note {i:05d}"
        body = f"body seed marker-{i % 97} apple" if i % 5 == 0 else f"note body {i}"
        note_rows.append(
            {
                "id": note_id,
                "user_id": user_id,
                "title": title,
                "body": body,
                "starts_at": starts,
                "status": status,
                "reminder_offsets": [],
                "version": 1,
                "deleted_at": None,
                "created_at": now,
                "updated_at": now,
                "rec_freq": rec_freq,
                "rec_until": rec_until,
                "rec_tz": rec_tz,
            }
        )
        # 0–2 tags
        n_tags = i % 3
        for t in range(n_tags):
            link_rows.append({"note_id": note_id, "tag_id": tag_ids[(i + t) % len(tag_ids)]})

        if len(note_rows) >= batch_size:
            await session.execute(insert(Note), note_rows)
            if link_rows:
                await session.execute(insert(NoteTag), link_rows)
            inserted += len(note_rows)
            note_rows.clear()
            link_rows.clear()

    if note_rows:
        await session.execute(insert(Note), note_rows)
        if link_rows:
            await session.execute(insert(NoteTag), link_rows)
        inserted += len(note_rows)

    return inserted
