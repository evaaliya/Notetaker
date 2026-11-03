"""M22: idempotent create by client-supplied id."""

import uuid

import pytest
from httpx import AsyncClient


async def _register(client: AsyncClient, login: str | None = None) -> str:
    login = login or f"u_{uuid.uuid4().hex[:10]}"
    resp = await client.post("/api/auth/register", json={"login": login, "password": "x"})
    assert resp.status_code == 200
    return login


def _body(**overrides):
    base = {
        "title": "Hello",
        "body": "World",
        "starts_at": "2026-10-24T09:00:00Z",
        "tag_ids": [],
        "reminder_offsets": [],
    }
    base.update(overrides)
    return base


@pytest.mark.asyncio
async def test_create_note_idempotent(client: AsyncClient):
    """Повторный POST с тем же id → одна заметка."""
    await _register(client)
    note_id = str(uuid.uuid4())
    first = await client.post("/api/notes", json=_body(id=note_id, title="A"))
    assert first.status_code == 201
    assert first.json()["id"] == note_id

    second = await client.post("/api/notes", json=_body(id=note_id, title="B"))
    assert second.status_code == 201
    assert second.json()["id"] == note_id
    # Body of first create wins until PATCH; still a single row.
    assert second.json()["title"] == "A"

    listed = await client.get("/api/notes")
    assert listed.status_code == 200
    assert len(listed.json()["items"]) == 1


@pytest.mark.asyncio
async def test_create_note_id_foreign_conflict(client: AsyncClient):
    await _register(client, "owner_m22")
    note_id = str(uuid.uuid4())
    created = await client.post("/api/notes", json=_body(id=note_id))
    assert created.status_code == 201

    await client.post("/api/auth/logout")
    await _register(client, "other_m22")
    conflict = await client.post("/api/notes", json=_body(id=note_id, title="steal"))
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "id_conflict"
    assert "note" not in conflict.json()


@pytest.mark.asyncio
async def test_create_note_id_deleted_no_resurrect(client: AsyncClient):
    await _register(client)
    note_id = str(uuid.uuid4())
    created = await client.post("/api/notes", json=_body(id=note_id))
    assert created.status_code == 201
    deleted = await client.delete(f"/api/notes/{note_id}")
    assert deleted.status_code == 200
    assert deleted.json()["deleted_at"] is not None

    again = await client.post("/api/notes", json=_body(id=note_id, title="zombie"))
    assert again.status_code == 409
    assert again.json()["error"]["code"] == "id_conflict"

    # GET soft-deleted is allowed for owner; must stay deleted (not resurrected).
    got = await client.get(f"/api/notes/{note_id}")
    assert got.status_code == 200
    assert got.json()["deleted_at"] is not None
    assert got.json()["title"] != "zombie"
