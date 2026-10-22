import os
from collections.abc import AsyncGenerator, Generator
from datetime import datetime, timezone

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from testcontainers.postgres import PostgresContainer

from app.clock import FrozenClock
from app.config import get_settings
from app.db import Base, get_session
from app.main import app
from app.migrate import run_migrations


@pytest.fixture(scope="session")
def postgres_url() -> Generator[str, None, None]:
    with PostgresContainer("postgres:16") as pg:
        url = pg.get_connection_url().replace("psycopg2", "asyncpg")
        # testcontainers may return postgresql+psycopg2://...
        if url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
        os.environ["DATABASE_URL"] = url
        get_settings.cache_clear()
        run_migrations()
        yield url
        get_settings.cache_clear()


@pytest_asyncio.fixture
async def db_session(postgres_url: str) -> AsyncGenerator[AsyncSession, None]:
    engine = create_async_engine(postgres_url, pool_pre_ping=True)
    session_factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    async with session_factory() as session:
        yield session
    await engine.dispose()


@pytest_asyncio.fixture
async def client(postgres_url: str) -> AsyncGenerator[AsyncClient, None]:
    engine = create_async_engine(postgres_url, pool_pre_ping=True)
    session_factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    async def override_get_session() -> AsyncGenerator[AsyncSession, None]:
        async with session_factory() as session:
            yield session

    clock = FrozenClock(datetime(2026, 10, 23, 12, 0, 0, tzinfo=timezone.utc))
    app.dependency_overrides[get_session] = override_get_session
    app.state.clock = clock

    # Point app module engine at test DB for any direct use
    import app.db as db_module

    old_engine = db_module.engine
    old_session = db_module.SessionLocal
    db_module.engine = engine
    db_module.SessionLocal = session_factory

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()
    db_module.engine = old_engine
    db_module.SessionLocal = old_session
    await engine.dispose()


@pytest.fixture
def clock(client: AsyncClient) -> FrozenClock:
    return app.state.clock
