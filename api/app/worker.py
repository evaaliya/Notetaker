"""Worker process entrypoint.

M0: heartbeat only. Reminder/outbox/materializer/purge arrive in M3+.
"""

import asyncio
import logging

from sqlalchemy import select

from app.clock import SystemClock
from app.config import get_settings
from app import db as db_module
from app.migrate import run_migrations
from app.models import WorkerHeartbeat

logger = logging.getLogger("worker")


async def write_heartbeat(now) -> None:
    async with db_module.SessionLocal() as session:
        result = await session.execute(select(WorkerHeartbeat).where(WorkerHeartbeat.id == 1))
        row = result.scalar_one_or_none()
        if row is None:
            session.add(WorkerHeartbeat(id=1, last_seen_at=now))
        else:
            row.last_seen_at = now
        await session.commit()


async def tick(now) -> None:
    """Pure-ish tick boundary: later stages add reminder claim logic here."""
    await write_heartbeat(now)
    # TODO(spec-gap): reminders / outbox / materializer / trash purge — M3+


async def run() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    settings = get_settings()
    clock = SystemClock()
    run_migrations()
    logger.info("worker started (heartbeat only until M3)")
    while True:
        await tick(clock.now())
        await asyncio.sleep(settings.worker_tick_seconds)


def main() -> None:
    asyncio.run(run())


if __name__ == "__main__":
    main()
