"""M14: extract jobs, caption cache, timeouts/retry — no live YouTube/OpenRouter."""

from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone

import httpx
import pytest
from httpx import AsyncClient

from app.clock import FrozenClock
from app.errors import AppError
from app.main import app
from app.services.extract_jobs import (
    create_youtube_job,
    process_due_extract_jobs,
    request_cancel,
)
from app.services.http_retry import call_with_retry
from app.services.youtube_captions import fetch_youtube_captions

NOW = datetime(2026, 11, 1, 12, 0, 0, tzinfo=timezone.utc)
TZ = "UTC"
EN = "Hello world. Machine learning basics for beginners."


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


def test_http_retry_retries_once_on_transient():
    n = {"i": 0}

    def flaky():
        n["i"] += 1
        if n["i"] == 1:
            raise httpx.ConnectError("boom")
        return "ok"

    assert call_with_retry(flaky, retries=1, pause_sec=0) == "ok"
    assert n["i"] == 2


def test_http_retry_no_retry_on_app_error():
    n = {"i": 0}

    def boom():
        n["i"] += 1
        raise AppError("no_captions", "нет", status_code=404)

    with pytest.raises(AppError) as ei:
        call_with_retry(boom, retries=3, pause_sec=0)
    assert n["i"] == 1
    assert ei.value.code == "no_captions"


@pytest.mark.asyncio
async def test_extract_job_youtube_happy_path(client: AsyncClient, clock):
    await _register(client, "m14job1")

    def fake_fetch(url: str, **kwargs):
        return EN, "en/asr"

    def fake_extract(text, *, user, clock, timezone_name, transcript=None):
        from app.schemas.extract import DraftOut, ExtractOut

        return ExtractOut(
            summary=DraftOut(
                title="T",
                body="## Main idea\nHi",
                starts_at=None,
                reminder_offsets=[],
                tag_names=[],
                kind="summary",
            ),
            drafts=[],
            provider="stub",
            transcript=transcript,
            source_lang="en",
            summary_ru=DraftOut(
                title="Т",
                body="## Главная мысль\nПривет",
                starts_at=None,
                reminder_offsets=[],
                tag_names=[],
                kind="summary",
            ),
        )

    # Start job via API
    vid_url = "https://youtu.be/m14JobHappy01"
    r = await client.post(
        "/api/extract/youtube/jobs",
        json={"url": vid_url, "timezone": TZ},
    )
    assert r.status_code == 200, r.text
    job_id = r.json()["id"]
    assert r.json()["reused"] is False

    # Second start reuses in-flight
    r2 = await client.post(
        "/api/extract/youtube/jobs",
        json={"url": vid_url, "timezone": TZ},
    )
    assert r2.status_code == 200
    assert r2.json()["id"] == job_id
    assert r2.json()["reused"] is True

    from app import db as db_module

    n = await process_due_extract_jobs(
        db_module.SessionLocal,
        now=NOW,
        fetch_captions_fn=fake_fetch,
        run_extract_fn=fake_extract,
    )
    assert n == 1

    got = await client.get(f"/api/extract/jobs/{job_id}")
    assert got.status_code == 200
    body = got.json()
    assert body["status"] == "done"
    assert body["step"] == "done"
    assert body["result"]["summary"]["title"] == "T"
    assert body["result"]["transcript"] == EN


@pytest.mark.asyncio
async def test_extract_job_cancel_discards_result(client: AsyncClient, clock):
    await _register(client, "m14cancel")
    r = await client.post(
        "/api/extract/youtube/jobs",
        json={"url": "https://www.youtube.com/watch?v=m14Cancel0001"},
    )
    job_id = r.json()["id"]

    # Cancel while pending
    c = await client.post(f"/api/extract/jobs/{job_id}/cancel")
    assert c.status_code == 200
    assert c.json()["status"] == "cancelled"
    assert c.json()["result"] is None

    from app import db as db_module

    n = await process_due_extract_jobs(
        db_module.SessionLocal,
        now=NOW,
        fetch_captions_fn=lambda *a, **k: (EN, "en"),
    )
    assert n == 0  # nothing pending

    got = await client.get(f"/api/extract/jobs/{job_id}")
    assert got.json()["status"] == "cancelled"
    assert got.json()["result"] is None


@pytest.mark.asyncio
async def test_extract_job_timeout_captions(client: AsyncClient, clock):
    await _register(client, "m14timeout")
    r = await client.post(
        "/api/extract/youtube/jobs",
        json={"url": "https://youtu.be/aaaaaaaaaaa"},
    )
    job_id = r.json()["id"]

    def slow_fetch(*a, **k):
        time.sleep(1.0)
        return EN, "en"

    from app import db as db_module
    from app.config import get_settings

    settings = get_settings()
    # Force tiny captions budget via monkeypatch on settings object used inside
    object.__setattr__(settings, "youtube_captions_timeout_sec", 0.05)
    object.__setattr__(settings, "extract_retry_pause_sec", 0)
    object.__setattr__(settings, "extract_transient_retries", 0)

    await process_due_extract_jobs(
        db_module.SessionLocal,
        now=NOW,
        settings=settings,
        fetch_captions_fn=slow_fetch,
        run_extract_fn=lambda *a, **k: (_ for _ in ()).throw(AssertionError("should not run")),
    )

    got = await client.get(f"/api/extract/jobs/{job_id}")
    assert got.json()["status"] == "error"
    assert got.json()["error_code"] == "timeout"
    assert got.json()["error_hint"]
    assert got.json()["result"] is None


@pytest.mark.asyncio
async def test_extract_job_upstream_500_mapped(client: AsyncClient, clock):
    await _register(client, "m14500")
    r = await client.post(
        "/api/extract/youtube/jobs",
        json={"url": "https://youtu.be/bbbbbbbbbbb"},
    )
    job_id = r.json()["id"]

    def boom(*a, **k):
        raise AppError("upstream_error", "fail", status_code=502, extra={"hint": "hint"})

    from app import db as db_module

    await process_due_extract_jobs(
        db_module.SessionLocal,
        now=NOW,
        fetch_captions_fn=boom,
    )
    got = await client.get(f"/api/extract/jobs/{job_id}")
    assert got.json()["status"] == "error"
    assert got.json()["error_code"] == "upstream_error"


@pytest.mark.asyncio
async def test_sync_youtube_uses_cache(client: AsyncClient, clock, monkeypatch):
    await _register(client, "m14cache")
    calls = {"n": 0}

    def fake_fetch(url: str, **_kwargs):
        calls["n"] += 1
        return EN, "en/manual"

    monkeypatch.setattr(
        "app.routers.extract.fetch_youtube_captions",
        fake_fetch,
    )
    # stub provider already default in tests usually
    r1 = await client.post(
        "/api/extract/youtube",
        json={"url": "https://youtu.be/cQcQcQcQcQc", "timezone": TZ},
    )
    assert r1.status_code == 200, r1.text
    r2 = await client.post(
        "/api/extract/youtube",
        json={"url": "https://youtu.be/cQcQcQcQcQc", "timezone": TZ},
    )
    assert r2.status_code == 200
    assert calls["n"] == 1  # second hit cache


@pytest.mark.asyncio
async def test_fetch_youtube_captions_empty_response_code(monkeypatch):
    def boom(*a, **k):
        raise AppError("no_captions", "empty", status_code=404)

    monkeypatch.setattr(
        "app.services.youtube_captions._fetch_captions_once",
        boom,
    )
    with pytest.raises(AppError) as ei:
        fetch_youtube_captions("dQw4w9WgXcQ", timeout=1, retries=0)
    assert ei.value.code == "no_captions"
