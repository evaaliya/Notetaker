"""M5: series reminders, split, overrides (T9–T11)."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select

import app.db as db_module
from app.clock import FrozenClock
from app.models import OccurrenceOverride, Reminder
from app.services.worker_jobs import process_due_reminders


async def _register(client: AsyncClient) -> None:
    login = f"ser_{uuid.uuid4().hex[:10]}"
    resp = await client.post(
        "/api/auth/register", json={"login": login, "password": "x", "timezone": "UTC"}
    )
    assert resp.status_code == 200
    me = await client.patch("/api/me", json={"email": "s@example.com"})
    assert me.status_code == 200


@pytest.mark.asyncio
async def test_series_reminder_each_occurrence(client: AsyncClient, clock: FrozenClock):
    """T9: daily series materializes one reminder per occurrence × offset within horizon."""
    await _register(client)
    # now = 2026-10-23 12:00 UTC (FrozenClock default)
    starts = "2026-10-24T12:00:00Z"  # tomorrow
    resp = await client.post(
        "/api/notes",
        json={
            "title": "Daily",
            "starts_at": starts,
            "reminder_offsets": [60],
            "recurrence": {"freq": "daily", "until": "2026-10-26", "tz": "UTC"},
        },
    )
    assert resp.status_code == 201, resp.text
    note_id = uuid.UUID(resp.json()["id"])

    async with db_module.SessionLocal() as session:
        result = await session.execute(
            select(Reminder).where(Reminder.note_id == note_id).order_by(Reminder.occurrence_start)
        )
        rems = list(result.scalars().all())

    # 24, 25, 26 Oct → 3 occurrences, offset 60 → fire 11:00 each day; all > now
    assert len(rems) == 3
    assert [r.occurrence_start.isoformat().replace("+00:00", "Z") for r in rems] == [
        "2026-10-24T12:00:00Z",
        "2026-10-25T12:00:00Z",
        "2026-10-26T12:00:00Z",
    ]
    assert all(r.status == "pending" for r in rems)
    assert all(r.fire_at == r.occurrence_start - timedelta(minutes=60) for r in rems)

    # Fire first occurrence reminder
    clock.advance(hours=23, minutes=1)  # now = Oct 24 11:01 — past first fire_at
    async with db_module.SessionLocal() as session:
        async with session.begin():
            n = await process_due_reminders(session, clock.now())
    assert n >= 1

    async with db_module.SessionLocal() as session:
        result = await session.execute(select(Reminder.status).where(Reminder.note_id == note_id))
        statuses = sorted(result.scalars().all())
    assert statuses.count("sent") == 1
    assert statuses.count("pending") == 2


@pytest.mark.asyncio
async def test_split_series_keeps_past(client: AsyncClient, clock: FrozenClock):
    """T10: scope=following does not change past occurrences / their sent reminders."""
    await _register(client)
    # Series: Oct 20,21,22,23,24 daily; now is Oct 23 12:00
    resp = await client.post(
        "/api/notes",
        json={
            "title": "SplitMe",
            "starts_at": "2026-10-20T15:00:00Z",
            "reminder_offsets": [10],
            "recurrence": {"freq": "daily", "until": "2026-10-28", "tz": "UTC"},
        },
    )
    assert resp.status_code == 201
    old = resp.json()
    old_id = old["id"]

    # Past occurrence (Oct 20) was never materialized (fire_at < now at create).
    # Insert a historical sent row — split must leave it on the old note.
    sent_id = uuid.uuid4()
    async with db_module.SessionLocal() as session:
        session.add(
            Reminder(
                id=sent_id,
                note_id=uuid.UUID(old_id),
                occurrence_start=datetime(2026, 10, 20, 15, 0, tzinfo=timezone.utc),
                offset_min=10,
                fire_at=datetime(2026, 10, 20, 14, 50, tzinfo=timezone.utc),
                status="sent",
            )
        )
        await session.commit()

    # Split at Oct 24: past stays on old note; new series from Oct 24 with new title
    split_at = "2026-10-24T15:00:00Z"
    patch = await client.patch(
        f"/api/notes/{old_id}",
        params={"scope": "following", "occurrence_start": split_at},
        json={"version": old["version"], "title": "FromHere"},
    )
    assert patch.status_code == 200, patch.text
    new = patch.json()
    assert new["id"] != old_id
    assert new["title"] == "FromHere"
    assert new["starts_at"] == split_at
    assert new["rec_freq"] == "daily"

    old_after = await client.get(f"/api/notes/{old_id}")
    assert old_after.json()["rec_until"] == "2026-10-23"  # day before split
    assert old_after.json()["title"] == "SplitMe"

    # Past sent reminder untouched
    async with db_module.SessionLocal() as session:
        rem2 = await session.get(Reminder, sent_id)
        assert rem2 is not None
        assert rem2.note_id == uuid.UUID(old_id)
        assert rem2.status == "sent"

    # Calendar: Oct 20–23 still SplitMe; Oct 24+ FromHere
    cal = await client.get(
        "/api/calendar",
        params={"from": "2026-10-20T00:00:00Z", "to": "2026-10-27T00:00:00Z"},
    )
    items = cal.json()["items"]
    by_day = {it["occurrence_start"][:10]: it["note"]["title"] for it in items if "15:00" in it["occurrence_start"]}
    assert by_day["2026-10-20"] == "SplitMe"
    assert by_day["2026-10-23"] == "SplitMe"
    assert by_day["2026-10-24"] == "FromHere"
    assert by_day["2026-10-25"] == "FromHere"


@pytest.mark.asyncio
async def test_override_single_occurrence(client: AsyncClient, clock: FrozenClock):
    """T11: edit/delete one occurrence via override without touching the rest."""
    await _register(client)
    resp = await client.post(
        "/api/notes",
        json={
            "title": "Master",
            "starts_at": "2026-10-24T10:00:00Z",
            "reminder_offsets": [30],
            "recurrence": {"freq": "daily", "until": "2026-10-27", "tz": "UTC"},
        },
    )
    assert resp.status_code == 201
    note = resp.json()
    note_id = note["id"]
    target = "2026-10-25T10:00:00Z"

    # Rename + move only Oct 25
    patched = await client.patch(
        f"/api/notes/{note_id}",
        params={"scope": "this", "occurrence_start": target},
        json={
            "version": note["version"],
            "title": "Only25",
            "starts_at": "2026-10-25T14:00:00Z",
        },
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["title"] == "Master"  # master unchanged
    version = patched.json()["version"]

    cal = await client.get(
        "/api/calendar",
        params={"from": "2026-10-24T00:00:00Z", "to": "2026-10-28T00:00:00Z"},
    )
    items = {it["original_start"]: it for it in cal.json()["items"] if it["note"]["id"] == note_id}
    assert items["2026-10-24T10:00:00Z"]["note"]["title"] == "Master"
    assert items["2026-10-25T10:00:00Z"]["note"]["title"] == "Only25"
    assert items["2026-10-25T10:00:00Z"]["occurrence_start"] == "2026-10-25T14:00:00Z"
    assert items["2026-10-26T10:00:00Z"]["note"]["title"] == "Master"

    # Reminder for Oct 25 uses effective 14:00 → fire 13:30
    async with db_module.SessionLocal() as session:
        result = await session.execute(
            select(Reminder).where(
                Reminder.note_id == uuid.UUID(note_id),
                Reminder.occurrence_start == datetime(2026, 10, 25, 10, 0, tzinfo=timezone.utc),
            )
        )
        rem = result.scalar_one()
        assert rem.fire_at == datetime(2026, 10, 25, 13, 30, tzinfo=timezone.utc)

    # Delete Oct 26 only
    deleted = await client.delete(
        f"/api/notes/{note_id}",
        params={"scope": "this", "occurrence_start": "2026-10-26T10:00:00Z"},
    )
    assert deleted.status_code == 200

    cal2 = await client.get(
        "/api/calendar",
        params={"from": "2026-10-24T00:00:00Z", "to": "2026-10-28T00:00:00Z"},
    )
    originals = {it["original_start"] for it in cal2.json()["items"] if it["note"]["id"] == note_id}
    assert "2026-10-26T10:00:00Z" not in originals
    assert "2026-10-25T10:00:00Z" in originals
    assert "2026-10-27T10:00:00Z" in originals

    async with db_module.SessionLocal() as session:
        n_pending_26 = await session.scalar(
            select(func.count())
            .select_from(Reminder)
            .where(
                Reminder.note_id == uuid.UUID(note_id),
                Reminder.occurrence_start == datetime(2026, 10, 26, 10, 0, tzinfo=timezone.utc),
                Reminder.status == "pending",
            )
        )
        assert n_pending_26 == 0
        ov = await session.scalar(
            select(OccurrenceOverride).where(
                OccurrenceOverride.note_id == uuid.UUID(note_id),
                OccurrenceOverride.original_start
                == datetime(2026, 10, 26, 10, 0, tzinfo=timezone.utc),
            )
        )
        assert ov is not None and ov.is_deleted
