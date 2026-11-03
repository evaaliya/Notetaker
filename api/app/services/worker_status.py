"""Shared worker heartbeat check (health + extract config / TTL)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.models import WorkerHeartbeat


def _utc(now: datetime) -> datetime:
    if now.tzinfo is None:
        return now.replace(tzinfo=timezone.utc)
    return now.astimezone(timezone.utc)


async def worker_ok(
    session: AsyncSession, *, now: datetime, settings: Settings
) -> tuple[bool, str | None]:
    """Return (ok, last_seen_at ISO-Z or None)."""
    result = await session.execute(select(WorkerHeartbeat).where(WorkerHeartbeat.id == 1))
    heartbeat = result.scalar_one_or_none()
    if heartbeat is None:
        return False, None
    last = _utc(heartbeat.last_seen_at)
    last_s = last.isoformat().replace("+00:00", "Z")
    ok = last >= _utc(now) - timedelta(seconds=settings.worker_heartbeat_stale_seconds)
    return ok, last_s


def ai_provider_configured(settings: Settings) -> tuple[str, bool]:
    """Return (provider_name, configured). Stub always configured; openrouter needs key."""
    name = (settings.ai_provider or "stub").strip().lower() or "stub"
    if name == "openrouter":
        return name, bool((settings.openrouter_api_key or "").strip())
    return name, True
