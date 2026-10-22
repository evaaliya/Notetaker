from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_clock
from app.clock import Clock
from app.config import Settings, get_settings
from app.db import get_session
from app.models import WorkerHeartbeat

router = APIRouter(tags=["health"])


@router.get("/health")
async def health(
    db: Annotated[AsyncSession, Depends(get_session)],
    clock: Annotated[Clock, Depends(get_clock)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict:
    await db.execute(text("SELECT 1"))

    result = await db.execute(select(WorkerHeartbeat).where(WorkerHeartbeat.id == 1))
    heartbeat = result.scalar_one_or_none()
    now = clock.now()
    worker_ok = False
    worker_last_seen = None
    if heartbeat is not None:
        worker_last_seen = heartbeat.last_seen_at.isoformat().replace("+00:00", "Z")
        worker_ok = heartbeat.last_seen_at >= now - timedelta(
            seconds=settings.worker_heartbeat_stale_seconds
        )

    status = "ok" if worker_ok else "degraded"
    return {
        "status": status,
        "db": "ok",
        "worker": {
            "ok": worker_ok,
            "last_seen_at": worker_last_seen,
        },
    }
