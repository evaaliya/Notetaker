"""M16: personal tags on shared notes + show_in_calendar."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient


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


async def _create_tag(client: AsyncClient, name: str, color: str = "#2563EB") -> dict:
    r = await client.post("/api/tags", json={"name": name, "color": color})
    assert r.status_code == 201, r.text
    return r.json()


async def _create_note(
    client: AsyncClient,
    *,
    title: str = "N",
    tag_ids: list[str] | None = None,
    show_in_calendar: bool = True,
    starts_at: str = "2026-11-02T12:00:00Z",
) -> dict:
    r = await client.post(
        "/api/notes",
        json={
            "title": title,
            "body": "body",
            "starts_at": starts_at,
            "reminder_offsets": [],
            "tag_ids": tag_ids or [],
            "show_in_calendar": show_in_calendar,
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


@pytest.mark.asyncio
async def test_member_personal_tags_isolated(client: AsyncClient):
    owner_login = f"own_t_{uuid.uuid4().hex[:8]}"
    member_login = f"mem_t_{uuid.uuid4().hex[:8]}"
    await _register(client, owner_login)
    owner_tag = await _create_tag(client, "owner-work")
    note = await _create_note(client, title="Tagged shared", tag_ids=[owner_tag["id"]])
    note_id = note["id"]
    assert note["tag_ids"] == [owner_tag["id"]]

    await _logout(client)
    await _register(client, member_login)
    member_tag = await _create_tag(client, "member-focus", "#16A34A")
    await _logout(client)

    await _login(client, owner_login)
    shared = await client.post(f"/api/notes/{note_id}/members", json={"login": member_login})
    assert shared.status_code == 201, shared.text

    await _logout(client)
    await _login(client, member_login)

    got = await client.get(f"/api/notes/{note_id}")
    assert got.status_code == 200
    assert got.json()["tag_ids"] == []

    patched = await client.patch(
        f"/api/notes/{note_id}",
        json={"version": got.json()["version"], "tag_ids": [member_tag["id"]]},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["tag_ids"] == [member_tag["id"]]

    # Foreign (owner) tag id → 404
    bad = await client.patch(
        f"/api/notes/{note_id}",
        json={"version": patched.json()["version"], "tag_ids": [owner_tag["id"]]},
    )
    assert bad.status_code == 404

    listed = await client.get("/api/notes", params={"tags": [member_tag["id"]]})
    assert listed.status_code == 200
    assert any(i["id"] == note_id for i in listed.json()["items"])

    await _logout(client)
    await _login(client, owner_login)
    owner_view = await client.get(f"/api/notes/{note_id}")
    assert owner_view.status_code == 200
    assert owner_view.json()["tag_ids"] == [owner_tag["id"]]
    assert member_tag["id"] not in owner_view.json()["tag_ids"]


@pytest.mark.asyncio
async def test_owner_tags_not_visible_to_member(client: AsyncClient):
    owner_login = f"own_v_{uuid.uuid4().hex[:8]}"
    member_login = f"mem_v_{uuid.uuid4().hex[:8]}"
    await _register(client, owner_login)
    tag = await _create_tag(client, "secret-owner-tag")
    note = await _create_note(client, title="Owner tags only", tag_ids=[tag["id"]])
    note_id = note["id"]

    await _logout(client)
    await _register(client, member_login)
    await _logout(client)

    await _login(client, owner_login)
    assert (
        await client.post(f"/api/notes/{note_id}/members", json={"login": member_login})
    ).status_code == 201

    await _logout(client)
    await _login(client, member_login)

    got = await client.get(f"/api/notes/{note_id}")
    assert got.status_code == 200
    assert got.json()["tag_ids"] == []

    cal = await client.get(
        "/api/calendar",
        params={"from": "2026-11-02T00:00:00Z", "to": "2026-11-03T00:00:00Z"},
    )
    assert cal.status_code == 200
    occ = next(o for o in cal.json()["items"] if o["note"]["id"] == note_id)
    assert occ["note"]["tag_ids"] == []

    filtered = await client.get("/api/notes", params={"tags": [tag["id"]]})
    assert filtered.status_code == 200
    assert not any(i["id"] == note_id for i in filtered.json()["items"])


@pytest.mark.asyncio
async def test_show_in_calendar_false_hidden_from_calendar_but_in_list(client: AsyncClient):
    login = f"cal_{uuid.uuid4().hex[:8]}"
    await _register(client, login)
    starts = "2026-11-02T14:00:00Z"
    note = await _create_note(
        client,
        title="Video-like hidden",
        show_in_calendar=False,
        starts_at=starts,
    )
    note_id = note["id"]
    assert note["show_in_calendar"] is False

    listed = await client.get("/api/notes")
    assert listed.status_code == 200
    assert any(i["id"] == note_id for i in listed.json()["items"])

    cal = await client.get(
        "/api/calendar",
        params={"from": "2026-11-02T00:00:00Z", "to": "2026-11-03T00:00:00Z"},
    )
    assert cal.status_code == 200
    assert not any(o["note"]["id"] == note_id for o in cal.json()["items"])

    # Reminders still materialize for hidden-from-calendar notes.
    with_reminder = await client.post(
        "/api/notes",
        json={
            "title": "Remind me",
            "body": "",
            "starts_at": (datetime.now(timezone.utc) + timedelta(hours=2))
            .isoformat()
            .replace("+00:00", "Z"),
            "reminder_offsets": [10],
            "tag_ids": [],
            "show_in_calendar": False,
        },
    )
    assert with_reminder.status_code == 201, with_reminder.text
    # Patch toggle back on → appears in calendar
    shown = await client.patch(
        f"/api/notes/{note_id}",
        json={"version": note["version"], "show_in_calendar": True},
    )
    assert shown.status_code == 200
    assert shown.json()["show_in_calendar"] is True
    cal2 = await client.get(
        "/api/calendar",
        params={"from": "2026-11-02T00:00:00Z", "to": "2026-11-03T00:00:00Z"},
    )
    assert any(o["note"]["id"] == note_id for o in cal2.json()["items"])
