"""Notes CRUD, activate/deactivate, trash/restore, optimistic version."""

import uuid

import pytest
from httpx import AsyncClient


async def _register(client: AsyncClient) -> None:
    login = f"u_{uuid.uuid4().hex[:10]}"
    resp = await client.post("/api/auth/register", json={"login": login, "password": "x"})
    assert resp.status_code == 200


def _note_body(**overrides):
    base = {
        "title": "Hello",
        "body": "World",
        "starts_at": "2026-10-24T09:00:00Z",
        "tag_ids": [],
        "reminder_offsets": [10, 60],
    }
    base.update(overrides)
    return base


@pytest.mark.asyncio
async def test_notes_crud_activate_trash_restore(client: AsyncClient):
    await _register(client)

    t1 = (await client.post("/api/tags", json={"name": "A", "color": "#111111"})).json()
    t2 = (await client.post("/api/tags", json={"name": "B", "color": "#222222"})).json()

    created = await client.post(
        "/api/notes",
        json=_note_body(tag_ids=[t1["id"], t2["id"]]),
    )
    assert created.status_code == 201
    note = created.json()
    assert note["version"] == 1
    assert set(note["tag_ids"]) == {t1["id"], t2["id"]}
    assert note["starts_at"].endswith("Z")
    assert note["reminder_offsets"] == [10, 60]

    got = await client.get(f"/api/notes/{note['id']}")
    assert got.status_code == 200
    assert got.json()["title"] == "Hello"

    deactivated = await client.post(f"/api/notes/{note['id']}/deactivate")
    assert deactivated.status_code == 200
    assert deactivated.json()["status"] == "inactive"
    assert deactivated.json()["version"] == 2

    activated = await client.post(f"/api/notes/{note['id']}/activate")
    assert activated.status_code == 200
    assert activated.json()["status"] == "active"

    deleted = await client.delete(f"/api/notes/{note['id']}")
    assert deleted.status_code == 200
    assert deleted.json()["deleted_at"] is not None

    trash = await client.get("/api/notes/trash")
    assert trash.status_code == 200
    assert any(n["id"] == note["id"] for n in trash.json())

    # soft-deleted note cannot be patched
    bad_patch = await client.patch(
        f"/api/notes/{note['id']}",
        json={"version": deleted.json()["version"], "title": "x"},
    )
    assert bad_patch.status_code == 404

    restored = await client.post(f"/api/notes/{note['id']}/restore")
    assert restored.status_code == 200
    assert restored.json()["deleted_at"] is None

    trash_after = await client.get("/api/notes/trash")
    assert all(n["id"] != note["id"] for n in trash_after.json())


@pytest.mark.asyncio
async def test_concurrent_patch_409(client: AsyncClient):
    """Optimistic lock: stale version → 409 with current note (T14 mechanism; e2e later)."""
    await _register(client)
    created = await client.post("/api/notes", json=_note_body())
    note = created.json()

    ok = await client.patch(
        f"/api/notes/{note['id']}",
        json={"version": 1, "title": "First"},
    )
    assert ok.status_code == 200
    assert ok.json()["version"] == 2
    assert ok.json()["title"] == "First"

    conflict = await client.patch(
        f"/api/notes/{note['id']}",
        json={"version": 1, "title": "Stale"},
    )
    assert conflict.status_code == 409
    body = conflict.json()
    assert body["error"]["code"] == "version_conflict"
    assert body["note"]["version"] == 2
    assert body["note"]["title"] == "First"
