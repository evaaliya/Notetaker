"""M2: GET /upcoming buckets via Clock + user timezone (no sleep)."""

import uuid

import pytest
from httpx import AsyncClient

from app.clock import FrozenClock


async def _register(client: AsyncClient) -> str:
    login = f"up_{uuid.uuid4().hex[:10]}"
    resp = await client.post("/api/auth/register", json={"login": login, "password": "x"})
    assert resp.status_code == 200
    return login


def _note(**overrides):
    base = {
        "title": "N",
        "body": "",
        "starts_at": "2026-10-24T09:00:00Z",
    }
    base.update(overrides)
    return base


@pytest.mark.asyncio
async def test_upcoming_buckets(client: AsyncClient, clock: FrozenClock):
    """FrozenClock default: 2026-10-23 12:00 UTC; user TZ UTC → today=Oct 23."""
    await _register(client)
    await client.patch("/api/me", json={"timezone": "UTC"})

    # past (active)
    past = await client.post(
        "/api/notes",
        json=_note(title="Past", starts_at="2026-10-22T15:00:00Z"),
    )
    # today
    today = await client.post(
        "/api/notes",
        json=_note(title="Today", starts_at="2026-10-23T18:00:00Z"),
    )
    # week (tomorrow .. +6d after today start)
    week = await client.post(
        "/api/notes",
        json=_note(title="Week", starts_at="2026-10-25T09:00:00Z"),
    )
    # beyond week window
    await client.post(
        "/api/notes",
        json=_note(title="Later", starts_at="2026-10-31T09:00:00Z"),
    )
    # inactive past — excluded from past
    await client.post(
        "/api/notes",
        json=_note(title="InactivePast", starts_at="2026-10-21T09:00:00Z", status="inactive"),
    )
    # series occurrence later today (M5: expanded into today bucket)
    series = await client.post(
        "/api/notes",
        json=_note(
            title="SeriesToday",
            starts_at="2026-10-23T16:00:00Z",
            recurrence={"freq": "daily", "until": "2026-10-23", "tz": "UTC"},
        ),
    )
    assert series.status_code == 201

    resp = await client.get("/api/upcoming")
    assert resp.status_code == 200
    body = resp.json()

    today_ids = {it["note"]["id"] for it in body["today"]}
    week_ids = {it["note"]["id"] for it in body["week"]}
    past_ids = {it["note"]["id"] for it in body["past"]}

    assert today.json()["id"] in today_ids
    assert week.json()["id"] in week_ids
    assert past.json()["id"] in past_ids
    assert today.json()["id"] not in week_ids
    assert today.json()["id"] not in past_ids

    titles_past = {it["note"]["title"] for it in body["past"]}
    assert "InactivePast" not in titles_past
    assert "SeriesToday" in {it["note"]["title"] for it in body["today"]}
    assert series.json()["id"] in today_ids
    assert "Later" not in {it["note"]["title"] for it in body["week"]}

    # advancing clock moves today's note into past on next fetch
    clock.set(clock.now().replace(day=24, hour=0, minute=0))
    # 2026-10-24 00:00 UTC — previous "Today" (Oct 23 18:00) is past
    after = await client.get("/api/upcoming")
    assert after.status_code == 200
    assert today.json()["id"] in {it["note"]["id"] for it in after.json()["past"]}
    assert today.json()["id"] not in {it["note"]["id"] for it in after.json()["today"]}
