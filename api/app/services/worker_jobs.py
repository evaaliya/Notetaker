"""Worker jobs: claim due reminders, flush outbox, purge trash.

SMTP stays outside DB transactions (D-005). Time comes from ``Clock`` via ``tick(now)``.
"""

from __future__ import annotations

import asyncio
import logging
import smtplib
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from email.utils import format_datetime

from sqlalchemy import delete, select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import Settings, get_settings
from app.models import EmailOutbox, Note, Notification, OccurrenceOverride, Reminder, User
from app.services.occurrences import effective_start
from app.services.realtime import notify_user

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

        ov = None
        if note.rec_freq is not None:
            ov_result = await session.execute(
                select(OccurrenceOverride).where(
                    OccurrenceOverride.note_id == note.id,
                    OccurrenceOverride.original_start == rem.occurrence_start,
                )
            )
            ov = ov_result.scalar_one_or_none()
            if ov is not None and ov.is_deleted:
                rem.status = "skipped"
                continue

        occ_effective = effective_start(rem.occurrence_start, ov)
        if occ_effective < now:
            rem.status = "missed"
            continue

        user = await session.get(User, note.user_id)
        title = (ov.title if ov is not None and ov.title is not None else note.title) or "(без названия)"
        body = (ov.body if ov is not None and ov.body is not None else note.body) or ""
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
            starts = occ_effective.isoformat().replace("+00:00", "Z")
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
        await notify_user(
            session,
            note.user_id,
            "notification.new",
            ids=[notify_id],
            extra={"title": title, "body": body},
        )

    return len(ids)


async def reclaim_stale_sending(
    session: AsyncSession,
    now: datetime,
    *,
    timeout_minutes: int,
) -> int:
    """Return ``sending`` rows older than timeout to ``pending`` (D-032).

    Increments ``attempts`` so abandoned in-flight claims stay visible in metrics.
    """
    cutoff = now - timedelta(minutes=timeout_minutes)
    result = await session.execute(
        update(EmailOutbox)
        .where(
            EmailOutbox.status == "sending",
            EmailOutbox.sending_at.is_not(None),
            EmailOutbox.sending_at <= cutoff,
        )
        .values(
            status="pending",
            sending_at=None,
            attempts=EmailOutbox.attempts + 1,
        )
    )
    return result.rowcount or 0


async def process_outbox(
    session_factory: async_sessionmaker[AsyncSession],
    now: datetime,
    *,
    settings: Settings | None = None,
    batch_size: int = BATCH,
    smtp_send: Callable[[OutboxPayload], None] | None = None,
) -> int:
    """Claim pending outbox as ``sending``, SMTP outside the TX, then sent/failed.

    Status flips to ``sending`` under ``FOR UPDATE SKIP LOCKED`` before commit so a
    concurrent worker (or e2e ``tick_reminders`` + real worker) cannot re-claim the
    same row while SMTP is in flight (D-031). Stuck ``sending`` rows are returned by
    ``reclaim_stale_sending`` on each tick (D-032).
    """
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
                row.status = "sending"
                row.sending_at = now
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

    send = smtp_send or (lambda p: _smtp_send_sync(p, settings, now))
    for payload in payloads:
        try:
            await asyncio.to_thread(send, payload)
            async with session_factory() as session:
                async with session.begin():
                    await session.execute(
                        update(EmailOutbox)
                        .where(EmailOutbox.id == payload.id, EmailOutbox.status == "sending")
                        .values(status="sent", sent_at=now, sending_at=None)
                    )
        except Exception:
            logger.exception("SMTP failed for outbox %s", payload.id)
            async with session_factory() as session:
                async with session.begin():
                    await session.execute(
                        update(EmailOutbox)
                        .where(EmailOutbox.id == payload.id, EmailOutbox.status == "sending")
                        .values(status="failed", sending_at=None)
                    )
    return len(payloads)


def build_outbox_message(payload: OutboxPayload, settings: Settings, now: datetime) -> EmailMessage:
    """Build MIME message; ``Date`` from Clock in UTC (D-033)."""
    msg = EmailMessage()
    msg["From"] = settings.smtp_from
    msg["To"] = payload.to_addr
    msg["Subject"] = payload.subject
    msg["Message-ID"] = payload.message_id
    msg["Date"] = format_datetime(now.astimezone(timezone.utc))
    msg.set_content(payload.body)
    return msg


def _smtp_send_sync(payload: OutboxPayload, settings: Settings, now: datetime) -> None:
    msg = build_outbox_message(payload, settings, now)
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=30) as smtp:
        smtp.send_message(msg)


async def purge_trash(session: AsyncSession, now: datetime, *, retention_days: int = 30) -> int:
    cutoff = now - timedelta(days=retention_days)
    result = await session.execute(delete(Note).where(Note.deleted_at.is_not(None), Note.deleted_at < cutoff))
    return result.rowcount or 0
