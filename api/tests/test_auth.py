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
