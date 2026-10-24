"""M4: pg_notify → hub → WS; notifications API (supports T2/T13/T14)."""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import update
from starlette.websockets import WebSocketState

import app.db as db_module
from app.clock import FrozenClock
from app.main import app
from app.models import Reminder
from app.realtime_hub import RealtimeHub
from app.services.worker_jobs import process_due_reminders


async def _register(client: AsyncClient, login: str | None = None) -> dict:
    login = login or f"m4_{uuid.uuid4().hex[:10]}"
    r = await client.post("/api/auth/register", json={"login": login, "password": "secret"})
    assert r.status_code == 200
    return r.json()


async def _wait_until(predicate, *, timeout: float = 3.0, interval: float = 0.05):
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while loop.time() < deadline:
        if await predicate():
            return
        await asyncio.sleep(interval)
    raise TimeoutError("condition not met within timeout")


class _RecordingSocket:
    def __init__(self) -> None:
        self.messages: list[str] = []
        self.client_state = WebSocketState.CONNECTED

    async def send_text(self, data: str) -> None:
        self.messages.append(data)


@pytest.mark.asyncio
async def test_pg_notify_note_changed_on_user_channel(client: AsyncClient):
    user = await _register(client)
    hub: RealtimeHub = app.state.realtime_hub
    sock = _RecordingSocket()
    await hub.register(uuid.UUID(user["id"]), sock)

    created = await client.post(
        "/api/notes",
        json={
            "title": "Live",
            "body": "",
            "starts_at": "2026-10-24T15:00:00Z",
            "reminder_offsets": [],
            "tag_ids": [],
        },
    )
    assert created.status_code == 201
    note_id = created.json()["id"]

    async def got_create():
        return any(
            (p := json.loads(m)).get("type") == "note.changed" and note_id in p.get("ids", [])
            for m in sock.messages
        )

    await _wait_until(got_create)

    before = len(sock.messages)
    patched = await client.patch(
        f"/api/notes/{note_id}",
        json={"version": 1, "title": "Updated live"},
    )
    assert patched.status_code == 200

    async def got_patch():
        for m in sock.messages[before:]:
            payload = json.loads(m)
            if payload.get("type") == "note.changed" and payload.get("version") == 2:
                return True
        return False

    await _wait_until(got_patch)
    await hub.unregister(uuid.UUID(user["id"]), sock)


@pytest.mark.asyncio
async def test_notification_new_over_user_channel(client: AsyncClient, clock: FrozenClock):
    await _register(client)
    await client.patch("/api/me", json={"email": "m4@example.com"})
    starts = clock.now() + timedelta(hours=2)
    created = await client.post(
        "/api/notes",
        json={
            "title": "Toast title",
            "body": "body",
            "starts_at": starts.isoformat().replace("+00:00", "Z"),
            "reminder_offsets": [10],
            "tag_ids": [],
        },
    )
    assert created.status_code == 201
    note_id = uuid.UUID(created.json()["id"])
    me = (await client.get("/api/me")).json()

    hub: RealtimeHub = app.state.realtime_hub
    sock = _RecordingSocket()
    await hub.register(uuid.UUID(me["id"]), sock)

    async with db_module.SessionLocal() as session:
        async with session.begin():
            await session.execute(
                update(Reminder)
                .where(Reminder.note_id == note_id, Reminder.status == "pending")
                .values(fire_at=clock.now() - timedelta(seconds=1))
            )
        async with session.begin():
            await process_due_reminders(session, clock.now())

    async def got_toast():
        for m in sock.messages:
            payload = json.loads(m)
            if payload.get("type") == "notification.new":
                return payload.get("title") == "Toast title"
        return False

    await _wait_until(got_toast)
    await hub.unregister(uuid.UUID(me["id"]), sock)


@pytest.mark.asyncio
async def test_notifications_unseen_and_seen(client: AsyncClient, clock: FrozenClock):
    await _register(client)
    starts = clock.now() + timedelta(hours=2)
    created = await client.post(
        "/api/notes",
        json={
            "title": "N",
            "body": "",
            "starts_at": starts.isoformat().replace("+00:00", "Z"),
            "reminder_offsets": [5],
            "tag_ids": [],
        },
    )
    note_id = uuid.UUID(created.json()["id"])
    async with db_module.SessionLocal() as session:
        async with session.begin():
            await session.execute(
                update(Reminder)
                .where(Reminder.note_id == note_id)
                .values(fire_at=clock.now() - timedelta(seconds=1))
            )
        async with session.begin():
            await process_due_reminders(session, clock.now())

    unseen = await client.get("/api/notifications?unseen=1")
    assert unseen.status_code == 200
    items = unseen.json()
    assert len(items) == 1
    nid = items[0]["id"]

    hub: RealtimeHub = app.state.realtime_hub
    me = (await client.get("/api/me")).json()
    sock = _RecordingSocket()
    await hub.register(uuid.UUID(me["id"]), sock)

    marked = await client.post(f"/api/notifications/{nid}/seen")
    assert marked.status_code == 200
    assert marked.json()["seen_at"] is not None

    async def got_seen():
        return any(json.loads(m).get("type") == "notification.seen" for m in sock.messages)

    await _wait_until(got_seen)

    unseen2 = await client.get("/api/notifications?unseen=1")
    assert unseen2.json() == []
    await hub.unregister(uuid.UUID(me["id"]), sock)
