"""T17 load: perf_list_10k / perf_search_10k on real 10k seed (§8 thresholds)."""

from __future__ import annotations

import statistics
import time
import uuid

import pytest
from httpx import AsyncClient

import app.db as db_module
from app.services.seed import seed_notes_for_user

# Spec §8: first page p95 < 150 ms; search p95 < 300 ms.
LIST_P95_MS = 150.0
SEARCH_P95_MS = 300.0
SAMPLES = 21  # enough for a stable p95 index


def _p95(samples_ms: list[float]) -> float:
    ordered = sorted(samples_ms)
    # nearest-rank: ceil(0.95 * n) — 1-based → index
    idx = max(0, min(len(ordered) - 1, int(0.95 * len(ordered) + 0.999) - 1))
    return ordered[idx]


async def _seed_10k(client: AsyncClient) -> None:
    login = f"perf_{uuid.uuid4().hex[:10]}"
    r = await client.post("/api/auth/register", json={"login": login, "password": "x"})
    assert r.status_code == 200
    me = (await client.get("/api/me")).json()
    user_id = uuid.UUID(me["id"])
    async with db_module.SessionLocal() as session:
        async with session.begin():
            n = await seed_notes_for_user(session, user_id, count=10_000)
    assert n == 10_000


@pytest.mark.asyncio
async def perf_list_10k(client: AsyncClient):
    """T17: first page of list on 10k notes — p95 < 150 ms."""
    await _seed_10k(client)
    samples: list[float] = []
    for _ in range(SAMPLES):
        t0 = time.perf_counter()
        resp = await client.get("/api/notes", params={"limit": 40, "sort": "starts_at"})
        elapsed_ms = (time.perf_counter() - t0) * 1000
        assert resp.status_code == 200
        assert len(resp.json()["items"]) == 40
        samples.append(elapsed_ms)
    p95 = _p95(samples)
    print(
        f"perf_list_10k p95={p95:.1f}ms median={statistics.median(samples):.1f}ms "
        f"max={max(samples):.1f}ms samples={samples}"
    )
    assert p95 < LIST_P95_MS, f"list p95 {p95:.1f}ms >= {LIST_P95_MS}ms"


@pytest.mark.asyncio
async def perf_search_10k(client: AsyncClient):
    """T17: substring search on 10k notes — p95 < 300 ms."""
    await _seed_10k(client)
    samples: list[float] = []
    for _ in range(SAMPLES):
        t0 = time.perf_counter()
        resp = await client.get("/api/notes", params={"q": "apple", "limit": 40})
        elapsed_ms = (time.perf_counter() - t0) * 1000
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["items"]) >= 1
        samples.append(elapsed_ms)
    p95 = _p95(samples)
    print(
        f"perf_search_10k p95={p95:.1f}ms median={statistics.median(samples):.1f}ms "
        f"max={max(samples):.1f}ms samples={samples}"
    )
    assert p95 < SEARCH_P95_MS, f"search p95 {p95:.1f}ms >= {SEARCH_P95_MS}ms"
