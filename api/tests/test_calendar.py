"""M2: GET /calendar range for single notes (series expansion is M5)."""

import uuid

import pytest
from httpx import AsyncClient


async def _register(client: AsyncClient) -> None:
    login = f"cal_{uuid.uuid4().hex[:10]}"
    resp = await client.post("/api/auth/register", json={"login": login, "password": "x"})
    assert resp.status_code == 200


def _note(**overrides):
    base = {
        "title": "N",
        "body": "",
        "starts_at": "2026-10-24T09:00:00Z",
    }
    base.update(overrides)
    return base


@pytest.mark.asyncio
async def test_calendar_range_singles(client: AsyncClient):
    await _register(client)

    in_range = await client.post(
        "/api/notes",
        json=_note(title="In", starts_at="2026-10-15T10:00:00Z"),
    )
    assert in_range.status_code == 201
    in_id = in_range.json()["id"]

    await client.post(
        "/api/notes",
        json=_note(title="Out", starts_at="2026-11-01T10:00:00Z"),
    )

    series = await client.post(
        "/api/notes",
        json=_note(
            title="Series",
            starts_at="2026-10-16T10:00:00Z",
            recurrence={"freq": "daily", "tz": "UTC"},
        ),
    )
    assert series.status_code == 201

    trashed = await client.post(
        "/api/notes",
        json=_note(title="Trash", starts_at="2026-10-17T10:00:00Z"),
    )
    tid = trashed.json()["id"]
    await client.delete(f"/api/notes/{tid}")

    bad = await client.get(
        "/api/calendar",
        params={"from": "2026-10-31T00:00:00Z", "to": "2026-10-01T00:00:00Z"},
    )
    assert bad.status_code == 400

    resp = await client.get(
        "/api/calendar",
        params={"from": "2026-10-01T00:00:00Z", "to": "2026-11-01T00:00:00Z"},
    )
    assert resp.status_code == 200
    items = resp.json()["items"]
    ids = {it["note"]["id"] for it in items}
    assert in_id in ids
    assert all(it["note"]["rec_freq"] is None for it in items)
    assert tid not in ids
    assert series.json()["id"] not in ids

    hit = next(it for it in items if it["note"]["id"] == in_id)
    assert hit["occurrence_start"] == "2026-10-15T10:00:00Z"
    assert hit["note"]["title"] == "In"
