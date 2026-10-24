"""Worker process: heartbeat, due reminders, outbox SMTP, hourly trash purge."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta

from sqlalchemy import select

from app import db as db_module
from app.clock import SystemClock
from app.config import get_settings
from app.migrate import run_migrations
from app.models import WorkerHeartbeat
from app.services.reminders import extend_all_series_horizons
from app.services.worker_jobs import (
    process_due_reminders,
    process_outbox,
    purge_trash,
    reclaim_stale_sending,
)

logger = logging.getLogger("worker")

_last_hourly_at: datetime | None = None


async def write_heartbeat(now: datetime) -> None:
    async with db_module.SessionLocal() as session:
        result = await session.execute(select(WorkerHeartbeat).where(WorkerHeartbeat.id == 1))
        row = result.scalar_one_or_none()
        if row is None:
            session.add(WorkerHeartbeat(id=1, last_seen_at=now))
        else:
            row.last_seen_at = now
        await session.commit()


async def tick(
    now: datetime,
    *,
    run_outbox: bool = True,
    force_hourly: bool = False,
    smtp_send=None,
) -> None:
    """Process due work at ``now``. Pure w.r.t. wall clock — callers pass time (tests: FrozenClock)."""
    global _last_hourly_at
    settings = get_settings()

    await write_heartbeat(now)

    async with db_module.SessionLocal() as session:
        async with session.begin():
            n = await process_due_reminders(session, now, batch_size=settings.worker_batch_size)
            if n:
                logger.info("claimed %s due reminder(s)", n)
            reclaimed = await reclaim_stale_sending(
                session,
                now,
                timeout_minutes=settings.outbox_sending_timeout_minutes,
            )
            if reclaimed:
                logger.info("reclaimed %s stale sending outbox row(s)", reclaimed)

    if run_outbox:
        sent = await process_outbox(
            db_module.SessionLocal,
            now,
            settings=settings,
            batch_size=settings.worker_batch_size,
            smtp_send=smtp_send,
        )
        if sent:
            logger.info("outbox processed %s row(s)", sent)

    do_hourly = force_hourly or _last_hourly_at is None or (now - _last_hourly_at) >= timedelta(hours=1)
    if do_hourly:
        async with db_module.SessionLocal() as session:
            async with session.begin():
                purged = await purge_trash(session, now, retention_days=settings.trash_retention_days)
                if purged:
                    logger.info("purged %s trash note(s)", purged)
                extended = await extend_all_series_horizons(session, now)
                if extended:
                    logger.info("extended series reminders: %s row(s)", extended)
        _last_hourly_at = now


async def run() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    settings = get_settings()
    clock = SystemClock()
    run_migrations()
    logger.info("worker started")
    while True:
        await tick(clock.now())
        await asyncio.sleep(settings.worker_tick_seconds)


def main() -> None:
    asyncio.run(run())


if __name__ == "__main__":
    main()
