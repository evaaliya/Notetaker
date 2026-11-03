"""M21: extract config, preflight, pending TTL, Russian failure messages — no network/keys."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import httpx
import pytest
from httpx import AsyncClient

from app.clock import FrozenClock
from app.config import get_settings
from app.errors import AppError
from app.main import app
from app.services.extract_errors import MISSING_AI_KEY_MSG, failure_for
from app.services.extract_jobs import process_due_extract_jobs

NOW = datetime(2026, 11, 4, 12, 0, 0, tzinfo=timezone.utc)
TZ = "UTC"
EN = "Hello elephants. Short caption sample for M21."


@pytest.fixture
def clock():
    c = FrozenClock(NOW)
    app.state.clock = c
    return c


async def _register(client: AsyncClient, login: str) -> None:
    r = await client.post(
        "/api/auth/register",
        json={"login": login, "password": "password1", "timezone": TZ},
    )
    assert r.status_code == 200, r.text


@pytest.fixture(autouse=True)
def _clear_settings_cache():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _set_provider(monkeypatch, *, provider: str, key: str | None) -> None:
    monkeypatch.setenv("AI_PROVIDER", provider)
    if key is None:
        monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
        monkeypatch.setenv("OPENROUTER_API_KEY", "")
    else:
        monkeypatch.setenv("OPENROUTER_API_KEY", key)
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_m21_a_stub_works_without_key(client: AsyncClient, clock, monkeypatch):
    """(a) AI_PROVIDER=stub, no key → job completes via stub."""
    _set_provider(monkeypatch, provider="stub", key=None)
    await _register(client, "m21a_stub")

    cfg = await client.get("/api/extract/config")
    assert cfg.status_code == 200
    body = cfg.json()
    assert body["provider"] == "stub"
    assert body["configured"] is True

    def fake_fetch(url: str, **kwargs):
        return EN, "en/asr"

    r = await client.post(
        "/api/extract/youtube/jobs",
        json={"url": "https://youtu.be/m21StubAAAA", "timezone": TZ},
    )
    assert r.status_code == 200, r.text
    job_id = r.json()["id"]

    from app import db as db_module

    n = await process_due_extract_jobs(
        db_module.SessionLocal,
        now=NOW,
        fetch_captions_fn=fake_fetch,
    )
    assert n == 1
    got = await client.get(f"/api/extract/jobs/{job_id}")
    assert got.json()["status"] == "done"
    assert got.json()["result"]["provider"] == "stub"


@pytest.mark.asyncio
async def test_m21_b_openrouter_missing_key_before_job(client: AsyncClient, clock, monkeypatch):
    """(b) openrouter without key → 503 instantly, no job row."""
    _set_provider(monkeypatch, provider="openrouter", key="")
    await _register(client, "m21b_nokey")

    cfg = await client.get("/api/extract/config")
    assert cfg.status_code == 200
    assert cfg.json()["provider"] == "openrouter"
    assert cfg.json()["configured"] is False

    r = await client.post(
        "/api/extract/youtube/jobs",
        json={"url": "https://youtu.be/m21NoKeyBBB", "timezone": TZ},
    )
    assert r.status_code == 503
    err = r.json()["error"]
    assert err["code"] == "missing_ai_key"
    assert err["message"] == MISSING_AI_KEY_MSG
    assert "OPENROUTER_API_KEY" in err["message"]
    assert "AI_PROVIDER=stub" in err["message"]


@pytest.mark.asyncio
async def test_m21_c_invalid_key_message(client: AsyncClient, clock, monkeypatch):
    """(c) key rejected → Russian «Ключ отклонён провайдером»."""
    _set_provider(monkeypatch, provider="openrouter", key="sk-or-v1-bad")
    await _register(client, "m21c_badkey")

    f = failure_for("invalid_key")
    assert f.message == "Ключ отклонён провайдером"

    def fake_fetch(url: str, **kwargs):
        return EN, "en"

    def boom_extract(*a, **k):
        raise AppError(
            "invalid_key",
            f.message,
            status_code=503,
            extra={"hint": f.hint},
        )

    r = await client.post(
        "/api/extract/youtube/jobs",
        json={"url": "https://youtu.be/m21BadKeyCCC", "timezone": TZ},
    )
    assert r.status_code == 200, r.text
    job_id = r.json()["id"]

    from app import db as db_module

    await process_due_extract_jobs(
        db_module.SessionLocal,
        now=NOW,
        fetch_captions_fn=fake_fetch,
        run_extract_fn=boom_extract,
    )
    got = await client.get(f"/api/extract/jobs/{job_id}")
    body = got.json()
    assert body["status"] == "error"
    assert body["error_code"] == "invalid_key"
    assert body["error_message"] == "Ключ отклонён провайдером"


@pytest.mark.asyncio
async def test_m21_d_pending_without_worker_ttl(client: AsyncClient, clock: FrozenClock, monkeypatch):
    """(d) pending >60s without worker heartbeat → failed worker_unavailable."""
    _set_provider(monkeypatch, provider="stub", key=None)
    await _register(client, "m21d_noworker")

    # No WorkerHeartbeat row → worker_ok false
    cfg = await client.get("/api/extract/config")
    assert cfg.json()["worker_ok"] is False

    r = await client.post(
        "/api/extract/youtube/jobs",
        json={"url": "https://youtu.be/m21NoWorkerDD", "timezone": TZ},
    )
    assert r.status_code == 200
    job_id = r.json()["id"]

    # Still pending immediately
    mid = await client.get(f"/api/extract/jobs/{job_id}")
    assert mid.json()["status"] == "pending"

    # Advance past pending TTL
    clock.set(NOW + timedelta(seconds=61))
    app.state.clock = clock

    got = await client.get(f"/api/extract/jobs/{job_id}")
    body = got.json()
    assert body["status"] == "error"
    assert body["error_code"] == "worker_unavailable"
    assert "docker compose ps" in body["error_message"]


@pytest.mark.asyncio
async def test_m21_e_youtube_unreachable(client: AsyncClient, clock, monkeypatch):
    """(e) ConnectError on captions → youtube_unreachable / «Нет доступа к youtube.com»."""
    _set_provider(monkeypatch, provider="stub", key=None)
    await _register(client, "m21e_noyt")

    r = await client.post(
        "/api/extract/youtube/jobs",
        json={"url": "https://youtu.be/m21NoYtEEEEE", "timezone": TZ},
    )
    job_id = r.json()["id"]

    def boom(*a, **k):
        raise httpx.ConnectError("youtube blocked")

    from app import db as db_module

    await process_due_extract_jobs(
        db_module.SessionLocal,
        now=NOW,
        fetch_captions_fn=boom,
    )
    got = await client.get(f"/api/extract/jobs/{job_id}")
    body = got.json()
    assert body["status"] == "error"
    assert body["error_code"] == "youtube_unreachable"
    assert body["error_message"] == "Нет доступа к youtube.com"
