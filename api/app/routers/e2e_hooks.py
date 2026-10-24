"""Optional hooks for Playwright (enabled only when E2E_HOOKS=1)."""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_clock, get_current_user
from app.clock import Clock
from app.config import get_settings
from app.db import SessionLocal, get_session
from app.errors import AppError
from app.models import Note, Reminder, User
from app.services.seed import seed_notes_for_user
from app.services.worker_jobs import process_due_reminders, process_outbox


def require_e2e_enabled() -> None:
    """Fail with 404 before auth when hooks are off (ordinary ``make up``)."""
    if not get_settings().e2e_hooks:
        raise AppError("not_found", "not found", status_code=404)


router = APIRouter(
    prefix="/e2e",
    tags=["e2e"],
    dependencies=[Depends(require_e2e_enabled)],
)


class MakeDueBody(BaseModel):
    note_id: uuid.UUID


@router.post("/make_reminder_due")
async def make_reminder_due(
    body: MakeDueBody,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_session)],
    clock: Annotated[Clock, Depends(get_clock)],
) -> dict:
    note = await db.get(Note, body.note_id)
    if note is None or note.user_id != user.id:
        raise AppError("not_found", "note not found", status_code=404)
    now = clock.now()
    result = await db.execute(
        update(Reminder)
        .where(Reminder.note_id == note.id, Reminder.status == "pending")
        .values(fire_at=now - timedelta(seconds=1))
    )
    await db.commit()
    return {"updated": result.rowcount or 0}


@router.post("/tick_reminders")
async def tick_reminders(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_session)],
    clock: Annotated[Clock, Depends(get_clock)],
) -> dict:
    _ = user
    now = clock.now()
    claimed = await process_due_reminders(db, now)
    await db.commit()
    # Flush outbox so MailHog sees the letter without waiting on the worker cycle.
    sent = await process_outbox(SessionLocal, now)
    return {"claimed": claimed, "outbox_sent": sent}


class SeedNotesBody(BaseModel):
    count: int = 10_000


@router.post("/seed_notes")
async def seed_notes(
    body: SeedNotesBody,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_session)],
    clock: Annotated[Clock, Depends(get_clock)],
) -> dict:
    """Bulk-insert notes for the current user (Playwright T17 scroll)."""
    if body.count < 1 or body.count > 20_000:
        raise AppError("bad_request", "count must be 1..20000", status_code=400)
    n = await seed_notes_for_user(db, user.id, count=body.count, now=clock.now())
    await db.commit()
    return {"inserted": n}
