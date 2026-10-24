"""pg_notify helpers — same transaction as the mutation (spec §2, §5)."""

from __future__ import annotations

import json
import uuid
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


def user_channel(user_id: uuid.UUID) -> str:
    return f"u_{user_id}"


async def notify_user(
    db: AsyncSession,
    user_id: uuid.UUID,
    event_type: str,
    *,
    ids: list[uuid.UUID] | None = None,
    version: int | None = None,
    extra: dict[str, Any] | None = None,
) -> None:
    """Emit LISTEN/NOTIFY payload on channel ``u_<user_id>``.

    Must be called before ``commit`` so the event is delivered only after commit.
    """
    payload: dict[str, Any] = {"type": event_type}
    if ids is not None:
        payload["ids"] = [str(i) for i in ids]
    if version is not None:
        payload["version"] = version
    if extra:
        payload.update(extra)
    await db.execute(
        text("SELECT pg_notify(:channel, :payload)"),
        {"channel": user_channel(user_id), "payload": json.dumps(payload)},
    )
