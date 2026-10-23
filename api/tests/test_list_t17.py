"""T17 server part (M1): search/filters/keyset. 10k load / e2e_scroll — M6."""

import uuid

import pytest
from httpx import AsyncClient


async def _register(client: AsyncClient) -> None:
    login = f"u_{uuid.uuid4().hex[:10]}"
    assert (
        await client.post("/api/auth/register", json={"login": login, "password": "x"})
    ).status_code == 200


async def _create(client: AsyncClient, **kw):
    body = {
        "title": "t",
        "body": "b",
        "starts_at": "2026-10-24T09:00:00Z",
        **kw,
    }
    resp = await client.post("/api/notes", json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


@pytest.mark.asyncio
async def perf_search_10k(client: AsyncClient):
    """T17 search/filters — functional (no 10k seed in M1)."""
    await _register(client)
    tag = (await client.post("/api/tags", json={"name": "red", "color": "#FF0000"})).json()
    tag2 = (await client.post("/api/tags", json={"name": "blue", "color": "#0000FF"})).json()

    await _create(
        client,
        title="Alpha apple",
        body="one",
        starts_at="2026-10-20T10:00:00Z",
        tag_ids=[tag["id"]],
    )
    await _create(
        client,
        title="Beta",
        body="apple pie",
        starts_at="2026-10-21T10:00:00Z",
        tag_ids=[tag["id"], tag2["id"]],
    )
    await _create(
        client,
        title="Gamma",
        body="other",
        starts_at="2026-10-22T10:00:00Z",
        tag_ids=[tag2["id"]],
        status="inactive",
    )
    await _create(client, title="Delta", body="x", starts_at="2026-10-23T10:00:00Z")

    search = await client.get("/api/notes", params={"q": "apple"})
    assert search.status_code == 200
    assert {n["title"] for n in search.json()["items"]} == {"Alpha apple", "Beta"}

    by_tag = await client.get("/api/notes", params={"tags": [tag["id"]], "tag_mode": "any"})
    assert {n["title"] for n in by_tag.json()["items"]} == {"Alpha apple", "Beta"}

    all_tags = await client.get(
        "/api/notes",
        params=[("tags", tag["id"]), ("tags", tag2["id"]), ("tag_mode", "all")],
    )
    assert [n["title"] for n in all_tags.json()["items"]] == ["Beta"]

    inactive = await client.get("/api/notes", params={"status": "inactive"})
    assert [n["title"] for n in inactive.json()["items"]] == ["Gamma"]

    period = await client.get(
        "/api/notes",
        params={"from": "2026-10-21T00:00:00Z", "to": "2026-10-22T23:59:59Z"},
    )
    assert {n["title"] for n in period.json()["items"]} == {"Beta", "Gamma"}


@pytest.mark.asyncio
async def perf_list_10k(client: AsyncClient):
    """T17 keyset list — functional pages (no 10k seed in M1)."""
    await _register(client)
    for i in range(5):
        await _create(client, title=f"n{i}", starts_at=f"2026-11-0{i + 1}T12:00:00Z")

    page1 = await client.get(
        "/api/notes",
        params={"sort": "starts_at", "dir": "asc", "limit": 2},
    )
    assert page1.status_code == 200
    body1 = page1.json()
    assert len(body1["items"]) == 2
    assert body1["next_cursor"]
    assert [n["title"] for n in body1["items"]] == ["n0", "n1"]

    page2 = await client.get(
        "/api/notes",
        params={
            "sort": "starts_at",
            "dir": "asc",
            "limit": 2,
            "cursor": body1["next_cursor"],
        },
    )
    body2 = page2.json()
    assert [n["title"] for n in body2["items"]] == ["n2", "n3"]
    assert body2["next_cursor"]

    page3 = await client.get(
        "/api/notes",
        params={
            "sort": "starts_at",
            "dir": "asc",
            "limit": 2,
            "cursor": body2["next_cursor"],
        },
    )
    body3 = page3.json()
    assert [n["title"] for n in body3["items"]] == ["n4"]
    assert body3["next_cursor"] is None

    all_ids = [n["id"] for n in body1["items"] + body2["items"] + body3["items"]]
    assert len(all_ids) == len(set(all_ids)) == 5
