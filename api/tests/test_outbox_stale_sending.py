"""Stale outbox ``sending`` reclaim (D-032): Clock only, no sleep."""

from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select

import app.db as db_module
from app.clock import FrozenClock
from app.config import get_settings
from app.models import EmailOutbox, Reminder
from app.services.worker_jobs import OutboxPayload, process_due_reminders, process_outbox, reclaim_stale_sending
from app.worker import tick


async def _setup_user(client: AsyncClient) -> None:
    login = f"stale_{uuid.uuid4().hex[:10]}"
    r = await client.post("/api/auth/register", json={"login": login, "password": "x"})
    assert r.status_code == 200
    r = await client.patch("/api/me", json={"email": f"{login}@example.com"})
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_stale_sending_reclaimed_and_sent_once(client: AsyncClient, clock: FrozenClock):
    """Stale sending → pending (+attempts) → exactly one SMTP; fresh sending untouched."""
    await _setup_user(client)
    # Same starts_at so both reminders become due on one clock jump.
    starts = clock.now() + timedelta(hours=2)
    created = await client.post(
        "/api/notes",
        json={
            "title": "Stale reclaim",
            "body": "",
            "starts_at": starts.isoformat().replace("+00:00", "Z"),
            "reminder_offsets": [10],
            "tag_ids": [],
        },
    )
    assert created.status_code == 201
    note_id = uuid.UUID(created.json()["id"])

    created2 = await client.post(
        "/api/notes",
        json={
            "title": "Fresh sending",
            "body": "",
            "starts_at": starts.isoformat().replace("+00:00", "Z"),
            "reminder_offsets": [10],
            "tag_ids": [],
        },
    )
    assert created2.status_code == 201
    note_id_fresh = uuid.UUID(created2.json()["id"])

    clock.set(clock.now() + timedelta(hours=1, minutes=51))
    async with db_module.SessionLocal() as session:
        async with session.begin():
            claimed = await process_due_reminders(session, clock.now())
    assert claimed == 2

    async with db_module.SessionLocal() as session:
        rem_stale = (
            await session.execute(select(Reminder).where(Reminder.note_id == note_id))
        ).scalar_one()
        rem_fresh = (
            await session.execute(select(Reminder).where(Reminder.note_id == note_id_fresh))
        ).scalar_one()
        out_stale = (
            await session.execute(select(EmailOutbox).where(EmailOutbox.reminder_id == rem_stale.id))
        ).scalar_one()
        out_fresh = (
            await session.execute(select(EmailOutbox).where(EmailOutbox.reminder_id == rem_fresh.id))
        ).scalar_one()
        stale_id = out_stale.id
        fresh_id = out_fresh.id
        stale_mid = out_stale.message_id

    timeout = get_settings().outbox_sending_timeout_minutes
    async with db_module.SessionLocal() as session:
        async with session.begin():
            stale = await session.get(EmailOutbox, stale_id)
            fresh = await session.get(EmailOutbox, fresh_id)
            assert stale is not None and fresh is not None
            stale.status = "sending"
            stale.sending_at = clock.now() - timedelta(minutes=timeout + 1)
            stale.attempts = 1
            fresh.status = "sending"
            fresh.sending_at = clock.now() - timedelta(minutes=1)
            fresh.attempts = 1

    smtp_calls: list[str] = []

    def capture_smtp(payload: OutboxPayload) -> None:
        smtp_calls.append(payload.message_id)

    async with db_module.SessionLocal() as session:
        async with session.begin():
            n = await reclaim_stale_sending(
                session, clock.now(), timeout_minutes=timeout
            )
    assert n == 1

    async with db_module.SessionLocal() as session:
        stale = await session.get(EmailOutbox, stale_id)
        fresh = await session.get(EmailOutbox, fresh_id)
        assert stale is not None and fresh is not None
        assert stale.status == "pending"
        assert stale.sending_at is None
        assert stale.attempts == 2
        assert fresh.status == "sending"
        assert fresh.attempts == 1

    await process_outbox(db_module.SessionLocal, clock.now(), smtp_send=capture_smtp)
    assert smtp_calls.count(stale_mid) == 1

    async with db_module.SessionLocal() as session:
        stale = await session.get(EmailOutbox, stale_id)
        fresh = await session.get(EmailOutbox, fresh_id)
        assert stale is not None and fresh is not None
        assert stale.status == "sent"
        assert fresh.status == "sending"


@pytest.mark.asyncio
async def test_tick_reclaims_stale_then_sends(client: AsyncClient, clock: FrozenClock):
    """Full worker tick recovers a stale sending row and delivers once."""
    await _setup_user(client)
    starts = clock.now() + timedelta(hours=1)
    created = await client.post(
        "/api/notes",
        json={
            "title": "Tick reclaim",
            "body": "",
            "starts_at": starts.isoformat().replace("+00:00", "Z"),
            "reminder_offsets": [10],
            "tag_ids": [],
        },
    )
    assert created.status_code == 201
    note_id = uuid.UUID(created.json()["id"])

    clock.set(clock.now() + timedelta(minutes=50, seconds=1))
    async with db_module.SessionLocal() as session:
        async with session.begin():
            await process_due_reminders(session, clock.now())

    async with db_module.SessionLocal() as session:
        rem = (await session.execute(select(Reminder).where(Reminder.note_id == note_id))).scalar_one()
        out = (
            await session.execute(select(EmailOutbox).where(EmailOutbox.reminder_id == rem.id))
        ).scalar_one()
        outbox_id = out.id
        message_id = out.message_id

    timeout = get_settings().outbox_sending_timeout_minutes
    async with db_module.SessionLocal() as session:
        async with session.begin():
            row = await session.get(EmailOutbox, outbox_id)
            assert row is not None
            row.status = "sending"
            row.sending_at = clock.now() - timedelta(minutes=timeout + 1)
            row.attempts = 1

    smtp_calls: list[str] = []

    def capture_smtp(payload: OutboxPayload) -> None:
        smtp_calls.append(payload.message_id)

    await tick(clock.now(), run_outbox=True, smtp_send=capture_smtp)
    assert smtp_calls.count(message_id) == 1

    async with db_module.SessionLocal() as session:
        row = await session.get(EmailOutbox, outbox_id)
        assert row is not None
        assert row.status == "sent"
        # reclaim (+1) then claim (+1) after initial abandoned claim (=1)
        assert row.attempts == 3
