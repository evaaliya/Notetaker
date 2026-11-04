import uuid

import pytest
from httpx import AsyncClient


def _login() -> str:
    return f"user_{uuid.uuid4().hex[:12]}"


@pytest.mark.asyncio
async def test_register_login_me_logout(client: AsyncClient):
    login = _login()
    password = "secret-pass"

    reg = await client.post("/api/auth/register", json={"login": login, "password": password})
    assert reg.status_code == 200
    assert reg.json()["login"] == login
    assert "session" in reg.cookies

    me = await client.get("/api/me")
    assert me.status_code == 200
    assert me.json()["login"] == login
    assert me.json()["timezone"] == "UTC"

    logout = await client.post("/api/auth/logout")
    assert logout.status_code == 200

    me_after = await client.get("/api/me")
    assert me_after.status_code == 401

    login_resp = await client.post("/api/auth/login", json={"login": login, "password": password})
    assert login_resp.status_code == 200
    assert login_resp.json()["login"] == login

    me2 = await client.get("/api/me")
    assert me2.status_code == 200


@pytest.mark.asyncio
async def test_register_duplicate_login(client: AsyncClient):
    login = _login()
    first = await client.post("/api/auth/register", json={"login": login, "password": "a"})
    assert first.status_code == 200
    await client.post("/api/auth/logout")
    second = await client.post("/api/auth/register", json={"login": login, "password": "b"})
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "conflict"


@pytest.mark.asyncio
async def test_login_wrong_password(client: AsyncClient):
    login = _login()
    await client.post("/api/auth/register", json={"login": login, "password": "right"})
    await client.post("/api/auth/logout")
    resp = await client.post("/api/auth/login", json={"login": login, "password": "wrong"})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_patch_me_timezone_and_email(client: AsyncClient):
    login = _login()
    await client.post("/api/auth/register", json={"login": login, "password": "x"})

    bad = await client.patch("/api/me", json={"timezone": "Not/AZone"})
    assert bad.status_code == 422

    ok = await client.patch(
        "/api/me",
        json={"timezone": "Asia/Bishkek", "email": "eva@example.com"},
    )
    assert ok.status_code == 200
    body = ok.json()
    assert body["timezone"] == "Asia/Bishkek"
    assert body["email"] == "eva@example.com"


@pytest.mark.asyncio
async def test_register_with_timezone(client: AsyncClient):
    login = _login()
    reg = await client.post(
        "/api/auth/register",
        json={"login": login, "password": "x", "timezone": "Europe/Berlin"},
    )
    assert reg.status_code == 200
    assert reg.json()["timezone"] == "Europe/Berlin"
    me = await client.get("/api/me")
    assert me.json()["timezone"] == "Europe/Berlin"

    bad = await client.post(
        "/api/auth/register",
        json={"login": _login(), "password": "x", "timezone": "Not/AZone"},
    )
    assert bad.status_code == 422


@pytest.mark.asyncio
async def test_create_note_after_settings_tz_differs_from_utc(client: AsyncClient):
    """Settings TZ ≠ UTC (device often Asia/*): create today and tomorrow must be 201.

    Regression for opaque UI «Unprocessable Entity» after timezone change — API
    accepts aware starts_at regardless of users.timezone (wall clock is client-side).
    """
    from datetime import datetime, timedelta, timezone
    from zoneinfo import ZoneInfo

    login = _login()
    await client.post("/api/auth/register", json={"login": login, "password": "x"})
    # Device-like default was UTC at register; switch away (phone repro).
    patched = await client.patch("/api/me", json={"timezone": "America/New_York"})
    assert patched.status_code == 200
    assert patched.json()["timezone"] == "America/New_York"

    tz = ZoneInfo("America/New_York")
    now_local = datetime.now(tz)
    today_local = (now_local + timedelta(hours=2)).replace(second=0, microsecond=0)
    tomorrow_local = (now_local + timedelta(days=1)).replace(
        hour=15, minute=0, second=0, microsecond=0
    )

    for label, wall in (("today", today_local), ("tomorrow", tomorrow_local)):
        starts = wall.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        created = await client.post(
            "/api/notes",
            json={
                "id": str(uuid.uuid4()),
                "title": f"tz-{label}",
                "body": "",
                "starts_at": starts,
                "reminder_offsets": [10],
                "tag_ids": [],
            },
        )
        assert created.status_code == 201, created.text
        assert created.json()["starts_at"] == starts


@pytest.mark.asyncio
async def test_create_note_rejects_non_uuid_client_id(client: AsyncClient):
    """M22 client id must be UUID; pre-D-137 fallback-… strings → 422 on id."""
    login = _login()
    await client.post("/api/auth/register", json={"login": login, "password": "x"})
    bad = await client.post(
        "/api/notes",
        json={
            "id": "fallback-m26lan-abc",
            "title": "bad-id",
            "body": "",
            "starts_at": "2026-11-05T15:00:00Z",
            "reminder_offsets": [],
            "tag_ids": [],
        },
    )
    assert bad.status_code == 422
    detail = bad.json()["detail"]
    assert any(d.get("loc") == ["body", "id"] for d in detail)
