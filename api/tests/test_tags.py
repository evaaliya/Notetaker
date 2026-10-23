"""T20: tags CRUD, color, several tags on a note (note attach covered in notes tests)."""

import uuid

import pytest
from httpx import AsyncClient


async def _register(client: AsyncClient) -> None:
    login = f"u_{uuid.uuid4().hex[:10]}"
    resp = await client.post("/api/auth/register", json={"login": login, "password": "x"})
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_tags_crud_and_multi(client: AsyncClient):
    await _register(client)

    create1 = await client.post("/api/tags", json={"name": "Work", "color": "#aabbcc"})
    assert create1.status_code == 201
    t1 = create1.json()
    assert t1["name"] == "Work"
    assert t1["color"] == "#AABBCC"

    create2 = await client.post("/api/tags", json={"name": "Home", "color": "#112233"})
    assert create2.status_code == 201
    t2 = create2.json()

    listed = await client.get("/api/tags")
    assert listed.status_code == 200
    names = {t["name"] for t in listed.json()}
    assert names == {"Work", "Home"}

    dup = await client.post("/api/tags", json={"name": "work", "color": "#000000"})
    assert dup.status_code == 409

    patched = await client.patch(
        f"/api/tags/{t1['id']}",
        json={"name": "Office", "color": "#ff00aa"},
    )
    assert patched.status_code == 200
    assert patched.json()["name"] == "Office"
    assert patched.json()["color"] == "#FF00AA"

    # several tags can exist; attach to note is exercised when notes API lands
    assert t1["id"] != t2["id"]

    deleted = await client.delete(f"/api/tags/{t2['id']}")
    assert deleted.status_code == 204
    after = await client.get("/api/tags")
    assert {t["name"] for t in after.json()} == {"Office"}

    missing = await client.delete(f"/api/tags/{t2['id']}")
    assert missing.status_code == 404
