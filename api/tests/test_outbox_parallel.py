"""Outbox claim: concurrent cycles must not double-send SMTP (D-031)."""

from __future__ import annotations

import asyncio
import threading
import time
import uuid
from datetime import timedelta

import pytest
from httpx import AsyncClient

import app.db as db_module
from app.clock import FrozenClock
from app.models import EmailOutbox, Reminder
from app.services.worker_jobs import OutboxPayload, process_due_reminders, process_outbox
from sqlalchemy import select


async def _setup_user(client: AsyncClient) -> None:
    login = f"obx_{uuid.uuid4().hex[:10]}"
    r = await client.post("/api/auth/register", json={"login": login, "password": "x"})
    assert r.status_code == 200
    r = await client.patch("/api/me", json={"email": f"{login}@example.com"})
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_outbox_parallel_cycles_single_smtp(client: AsyncClient, clock: FrozenClock):
    """Two process_outbox in parallel → exactly one SMTP call for one pending row."""
    await _setup_user(client)
    starts = clock.now() + timedelta(hours=1)
    created = await client.post(
        "/api/notes",
        json={
            "title": "Outbox race",
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
            claimed = await process_due_reminders(session, clock.now())
    assert claimed == 1

    async with db_module.SessionLocal() as session:
        rem = (
            await session.execute(select(Reminder).where(Reminder.note_id == note_id))
        ).scalar_one()
        out = (
            await session.execute(select(EmailOutbox).where(EmailOutbox.reminder_id == rem.id))
        ).scalar_one()
        assert out.status == "pending"
        outbox_id = out.id
        message_id = out.message_id

    smtp_calls: list[str] = []
    lock = threading.Lock()

    def slow_smtp(payload: OutboxPayload) -> None:
        # Hold the in-flight window so a second cycle can try to claim while we "send".
        time.sleep(0.25)
        with lock:
            smtp_calls.append(payload.message_id)

    n1, n2 = await asyncio.gather(
        process_outbox(db_module.SessionLocal, clock.now(), smtp_send=slow_smtp),
        process_outbox(db_module.SessionLocal, clock.now(), smtp_send=slow_smtp),
    )
    # Exactly one cycle claims (returns 1); the other sees no pending (returns 0).
    assert sorted([n1, n2]) == [0, 1]
    assert smtp_calls == [message_id]

    async with db_module.SessionLocal() as session:
        out2 = await session.get(EmailOutbox, outbox_id)
        assert out2 is not None
        assert out2.status == "sent"
        assert out2.attempts == 1
