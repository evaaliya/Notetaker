"""Outgoing mail must include Date from Clock (UTC)."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

from app.config import get_settings
from app.services.worker_jobs import OutboxPayload, build_outbox_message


def test_outbox_message_has_date_header_from_clock():
    now = datetime(2026, 10, 24, 11, 47, 0, tzinfo=timezone.utc)
    payload = OutboxPayload(
        id=uuid.uuid4(),
        to_addr="user@example.com",
        subject="Hello",
        body="body",
        message_id=f"<{uuid.uuid4()}@notetaker.local>",
    )
    msg = build_outbox_message(payload, get_settings(), now)
    assert "Date" in msg
    parsed = parsedate_to_datetime(msg["Date"])
    assert parsed == now
