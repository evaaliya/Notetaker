"""Worker jobs: claim due reminders, flush outbox, purge trash.

SMTP stays outside DB transactions (D-005). Time comes from ``Clock`` via ``tick(now)``.
"""

from __future__ import annotations

import asyncio
import json
import logging
import smtplib
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from email.message import EmailMessage

from sqlalchemy import delete, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import Settings, get_settings
from app.models import EmailOutbox, Note, Notification, Reminder, User

logger = logging.getLogger("worker")

BATCH = 100


@dataclass(frozen=True)
class OutboxPayload:
    id: uuid.UUID
    to_addr: str
    subject: str
    body: str
    message_id: str


async def process_due_reminders(session: AsyncSession, now: datetime, *, batch_size: int = BATCH) -> int:
    """Claim pending reminders with SKIP LOCKED and apply fire rules (D-007).

    Returns number of rows claimed.
    """
    result = await session.execute(
        text(
            """
            SELECT id FROM reminders
             WHERE status = 'pending' AND fire_at <= :now
             ORDER BY fire_at
             LIMIT :lim
             FOR UPDATE SKIP LOCKED
            """
        ),
        {"now": now, "lim": batch_size},
    )
    ids = [row[0] for row in result.fetchall()]
    if not ids:
        return 0

    for reminder_id in ids:
        rem = await session.get(Reminder, reminder_id)
        if rem is None or rem.status != "pending":
            continue
        note = await session.get(Note, rem.note_id)
        if note is None or note.deleted_at is not None or note.status != "active":
            rem.status = "skipped"
            continue
        # M5: occurrence deleted via override → skipped; singles use occurrence_start as-is
        if rem.occurrence_start < now:
            rem.status = "missed"
            continue

        user = await session.get(User, note.user_id)
        title = note.title or "(без названия)"
        body = note.body or ""
        notify_id = uuid.uuid4()
        await session.execute(
            insert(Notification)
            .values(
                id=notify_id,
                user_id=note.user_id,
                reminder_id=rem.id,
                title=title,
                body=body,
                created_at=now,
                seen_at=None,
            )
            .on_conflict_do_nothing(index_elements=["reminder_id"])
        )

        to_addr = (user.email if user else None) or ""
        if to_addr:
            outbox_id = uuid.uuid4()
            message_id = f"<{outbox_id}@notetaker.local>"
            starts = rem.occurrence_start.isoformat().replace("+00:00", "Z")
            mail_body = f"{body}\n\nStarts at: {starts}" if body else f"Starts at: {starts}"
            await session.execute(
                insert(EmailOutbox)
                .values(
                    id=outbox_id,
                    reminder_id=rem.id,
                    to_addr=to_addr,
                    subject=title,
                    body=mail_body,
                    status="pending",
                    attempts=0,
                    message_id=message_id,
                    sent_at=None,
                )
                .on_conflict_do_nothing(index_elements=["reminder_id"])
            )

        rem.status = "sent"
        await session.execute(
            text("SELECT pg_notify('notification.new', :payload)"),
            {"payload": json.dumps({"id": str(notify_id), "user_id": str(note.user_id)})},
        )

    return len(ids)


async def process_outbox(
    session_factory: async_sessionmaker[AsyncSession],
    now: datetime,
    *,
    settings: Settings | None = None,
    batch_size: int = BATCH,
    smtp_send: Callable[[OutboxPayload], None] | None = None,
) -> int:
    """Claim pending outbox, send SMTP outside the transaction, then mark sent/failed."""
    settings = settings or get_settings()

    async with session_factory() as session:
        async with session.begin():
            result = await session.execute(
                text(
                    """
                    SELECT id FROM email_outbox
                     WHERE status = 'pending'
                     ORDER BY id
                     LIMIT :lim
                     FOR UPDATE SKIP LOCKED
                    """
                ),
                {"lim": batch_size},
            )
            ids = [row[0] for row in result.fetchall()]
            payloads: list[OutboxPayload] = []
            for oid in ids:
                row = await session.get(EmailOutbox, oid)
                if row is None or row.status != "pending":
                    continue
                row.attempts = int(row.attempts or 0) + 1
                payloads.append(
                    OutboxPayload(
                        id=row.id,
                        to_addr=row.to_addr,
                        subject=row.subject,
                        body=row.body,
                        message_id=row.message_id,
                    )
                )

    if not payloads:
        return 0

    send = smtp_send or (lambda p: _smtp_send_sync(p, settings))
    for payload in payloads:
        try:
            await asyncio.to_thread(send, payload)
            async with session_factory() as session:
                async with session.begin():
                    await session.execute(
                        update(EmailOutbox)
                        .where(EmailOutbox.id == payload.id, EmailOutbox.status == "pending")
                        .values(status="sent", sent_at=now)
                    )
        except Exception:
            logger.exception("SMTP failed for outbox %s", payload.id)
            async with session_factory() as session:
                async with session.begin():
                    await session.execute(
                        update(EmailOutbox)
                        .where(EmailOutbox.id == payload.id, EmailOutbox.status == "pending")
                        .values(status="failed")
                    )
    return len(payloads)


def _smtp_send_sync(payload: OutboxPayload, settings: Settings) -> None:
    msg = EmailMessage()
    msg["From"] = settings.smtp_from
    msg["To"] = payload.to_addr
    msg["Subject"] = payload.subject
    msg["Message-ID"] = payload.message_id
    msg.set_content(payload.body)
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=30) as smtp:
        smtp.send_message(msg)


async def purge_trash(session: AsyncSession, now: datetime, *, retention_days: int = 30) -> int:
    cutoff = now - timedelta(days=retention_days)
    result = await session.execute(delete(Note).where(Note.deleted_at.is_not(None), Note.deleted_at < cutoff))
    return result.rowcount or 0
