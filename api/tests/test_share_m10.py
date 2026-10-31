"""M10: shared notes — ACL, 409 across users, realtime fan-out."""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime, timezone

import pytest
from httpx import AsyncClient
from starlette.websockets import WebSocketState

from app.main import app
from app.realtime_hub import RealtimeHub


async def _register(client: AsyncClient, login: str) -> dict:
    r = await client.post("/api/auth/register", json={"login": login, "password": "secret"})
    assert r.status_code == 200, r.text
    return r.json()


async def _login(client: AsyncClient, login: str) -> None:
    r = await client.post("/api/auth/login", json={"login": login, "password": "secret"})
    assert r.status_code == 200, r.text


async def _logout(client: AsyncClient) -> None:
    r = await client.post("/api/auth/logout")
    assert r.status_code in (200, 204)


async def _create_note(client: AsyncClient, title: str = "Shared") -> dict:
    r = await client.post(
        "/api/notes",
        json={
            "title": title,
            "body": "body",
            "starts_at": "2026-10-23T15:00:00Z",
            "reminder_offsets": [],
            "tag_ids": [],
        },
    )
    assert r.status_code == 201, r.text
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
async def test_share_note_visible_to_member(client: AsyncClient):
    owner_login = f"own_{uuid.uuid4().hex[:8]}"
    member_login = f"mem_{uuid.uuid4().hex[:8]}"
    await _register(client, owner_login)
    note = await _create_note(client, "Visible shared")
    note_id = note["id"]

    await _logout(client)
    await _register(client, member_login)
    await _logout(client)

    await _login(client, owner_login)
    shared = await client.post(f"/api/notes/{note_id}/members", json={"login": member_login})
    assert shared.status_code == 201, shared.text

    await _logout(client)
    await _login(client, member_login)

    listed = await client.get("/api/notes")
    assert listed.status_code == 200
    items = listed.json()["items"]
    assert any(i["id"] == note_id for i in items)
    got = next(i for i in items if i["id"] == note_id)
    assert got["role"] == "editor"
    assert got["owner_login"] == owner_login

    cal = await client.get(
        "/api/calendar",
        params={"from": "2026-10-23T00:00:00Z", "to": "2026-10-24T00:00:00Z"},
    )
    assert cal.status_code == 200
    assert any(o["note"]["id"] == note_id for o in cal.json()["items"])

    up = await client.get("/api/upcoming")
    assert up.status_code == 200
    bucket = up.json()["today"] + up.json()["week"] + up.json()["past"]
    assert any(o["note"]["id"] == note_id for o in bucket)

    notifs = await client.get("/api/notifications?unseen=1")
    assert notifs.status_code == 200
    assert any(n["title"] == "Вам открыт доступ" for n in notifs.json())


@pytest.mark.asyncio
async def test_member_edit_triggers_409_for_owner(client: AsyncClient):
    owner_login = f"o409_{uuid.uuid4().hex[:8]}"
    member_login = f"m409_{uuid.uuid4().hex[:8]}"
    await _register(client, owner_login)
    note = await _create_note(client, "Conflict")
    note_id = note["id"]
    version = note["version"]

    await _logout(client)
    await _register(client, member_login)
    await _logout(client)

    await _login(client, owner_login)
    assert (
        await client.post(f"/api/notes/{note_id}/members", json={"login": member_login})
    ).status_code == 201

    await _logout(client)
    await _login(client, member_login)
    patched = await client.patch(
        f"/api/notes/{note_id}",
        json={"version": version, "title": "Member edit"},
    )
    assert patched.status_code == 200, patched.text
    member_version = patched.json()["version"]
    assert patched.json()["updated_by_login"] == member_login

    await _logout(client)
    await _login(client, owner_login)
    conflict = await client.patch(
        f"/api/notes/{note_id}",
        json={"version": version, "title": "Owner stale"},
    )
    assert conflict.status_code == 409, conflict.text
    body = conflict.json()
    assert body["note"]["version"] == member_version
    assert body["note"]["title"] == "Member edit"
    assert body["note"]["updated_by_login"] == member_login


@pytest.mark.asyncio
async def test_non_member_gets_404(client: AsyncClient):
    owner_login = f"o404_{uuid.uuid4().hex[:8]}"
    stranger_login = f"s404_{uuid.uuid4().hex[:8]}"
    await _register(client, owner_login)
    note = await _create_note(client)
    note_id = note["id"]

    await _logout(client)
    await _register(client, stranger_login)

    r = await client.get(f"/api/notes/{note_id}")
    assert r.status_code == 404
    r = await client.patch(
        f"/api/notes/{note_id}", json={"version": 1, "title": "hack"}
    )
    assert r.status_code == 404
    r = await client.get(f"/api/notes/{note_id}/attachments")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_member_cannot_delete_or_share(client: AsyncClient):
    owner_login = f"odel_{uuid.uuid4().hex[:8]}"
    member_login = f"mdel_{uuid.uuid4().hex[:8]}"
    other_login = f"xdel_{uuid.uuid4().hex[:8]}"
    await _register(client, owner_login)
    note = await _create_note(client)
    note_id = note["id"]

    await _logout(client)
    await _register(client, member_login)
    await _logout(client)
    await _register(client, other_login)
    await _logout(client)

    await _login(client, owner_login)
    assert (
        await client.post(f"/api/notes/{note_id}/members", json={"login": member_login})
    ).status_code == 201

    await _logout(client)
    await _login(client, member_login)

    assert (await client.delete(f"/api/notes/{note_id}")).status_code == 404
    assert (
        await client.post(f"/api/notes/{note_id}/members", json={"login": other_login})
    ).status_code == 404
    leave = await client.post(f"/api/notes/{note_id}/members/me/leave")
    assert leave.status_code == 204

    listed = await client.get("/api/notes")
    assert all(i["id"] != note_id for i in listed.json()["items"])


@pytest.mark.asyncio
async def test_realtime_event_reaches_member(client: AsyncClient):
    owner_login = f"ort_{uuid.uuid4().hex[:8]}"
    member_login = f"mrt_{uuid.uuid4().hex[:8]}"
    owner = await _register(client, owner_login)
    note = await _create_note(client, "Live share")
    note_id = note["id"]

    await _logout(client)
    member = await _register(client, member_login)
    await _logout(client)

    await _login(client, owner_login)
    assert (
        await client.post(f"/api/notes/{note_id}/members", json={"login": member_login})
    ).status_code == 201

    hub: RealtimeHub = app.state.realtime_hub
    sock = _RecordingSocket()
    await hub.register(uuid.UUID(member["id"]), sock)

    before = len(sock.messages)
    patched = await client.patch(
        f"/api/notes/{note_id}",
        json={"version": note["version"], "title": "Owner pushed"},
    )
    assert patched.status_code == 200, patched.text

    async def got_event():
        for m in sock.messages[before:]:
            payload = json.loads(m)
            if (
                payload.get("type") == "note.changed"
                and note_id in payload.get("ids", [])
            ):
                return True
        return False

    await _wait_until(got_event)
    await hub.unregister(uuid.UUID(member["id"]), sock)
    # silence unused
    assert owner["id"]
    assert datetime.now(timezone.utc)
