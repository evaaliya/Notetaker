import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.clock import FrozenClock
from app.models import WorkerHeartbeat
from app.worker import write_heartbeat


@pytest.mark.asyncio
async def test_health_db_ok_worker_degraded_without_heartbeat(client: AsyncClient):
    resp = await client.get("/api/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["db"] == "ok"
    assert body["worker"]["ok"] is False
    assert body["status"] == "degraded"


@pytest.mark.asyncio
async def test_health_ok_after_worker_heartbeat(client: AsyncClient, clock: FrozenClock, postgres_url: str):
    engine = create_async_engine(postgres_url)
    Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    # Ensure worker path writes heartbeat via same DB
    import app.db as db_module

    old = db_module.SessionLocal
    db_module.SessionLocal = Session
    try:
        await write_heartbeat(clock.now())
    finally:
        db_module.SessionLocal = old

    async with Session() as session:
        row = (await session.execute(select(WorkerHeartbeat).where(WorkerHeartbeat.id == 1))).scalar_one()
        assert row.last_seen_at == clock.now()

    resp = await client.get("/api/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["worker"]["ok"] is True
    assert body["worker"]["last_seen_at"] is not None

    await engine.dispose()
