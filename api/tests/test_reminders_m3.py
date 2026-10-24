"""M3: reminders worker, outbox uniqueness, downtime policy, trash purge (T1, T4–T8, T18–T19)."""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select, update

import app.db as db_module
import app.worker as worker_mod
from app.clock import FrozenClock
from app.models import EmailOutbox, Note, Notification, Reminder
from app.services.worker_jobs import OutboxPayload, purge_trash
from app.worker import tick

UTC = timezone.utc


async def _setup_user(client: AsyncClient, *, email: str = "u@example.com") -> None:
    login = f"m3_{uuid.uuid4().hex[:10]}"
    r = await client.post("/api/auth/register", json={"login": login, "password": "x"})
    assert r.status_code == 200
    r = await client.patch("/api/me", json={"email": email})
    assert r.status_code == 200


def _noop_smtp(_payload: OutboxPayload) -> None:
    return None


async def _count(model, **filters) -> int:
    async with db_module.SessionLocal() as session:
        stmt = select(func.count()).select_from(model)
        for k, v in filters.items():
            stmt = stmt.where(getattr(model, k) == v)
        return int((await session.execute(stmt)).scalar_one())


async def _outbox_count_for_note(note_id: uuid.UUID) -> int:
    async with db_module.SessionLocal() as session:
        stmt = (
            select(func.count())
            .select_from(EmailOutbox)
            .join(Reminder, Reminder.id == EmailOutbox.reminder_id)
            .where(Reminder.note_id == note_id)
        )
        return int((await session.execute(stmt)).scalar_one())


async def _notif_count_for_note(note_id: uuid.UUID) -> int:
    async with db_module.SessionLocal() as session:
        stmt = (
            select(func.count())
            .select_from(Notification)
            .join(Reminder, Reminder.id == Notification.reminder_id)
            .where(Reminder.note_id == note_id)
        )
        return int((await session.execute(stmt)).scalar_one())


async def _reminders_by_offset(note_id: uuid.UUID) -> dict[int, list[str]]:
    async with db_module.SessionLocal() as session:
        rows = (
            await session.execute(select(Reminder).where(Reminder.note_id == note_id))
        ).scalars().all()
        out: dict[int, list[str]] = {}
        for r in rows:
            out.setdefault(r.offset_min, []).append(r.status)
        return out


async def _one_reminder(note_id: uuid.UUID) -> Reminder:
    async with db_module.SessionLocal() as session:
        rem = (
            await session.execute(select(Reminder).where(Reminder.note_id == note_id))
        ).scalar_one()
        session.expunge(rem)
        return rem


@pytest.mark.asyncio
async def test_reminder_single_email_with_two_workers(client: AsyncClient, clock: FrozenClock):
    """T1: two concurrent ticks → one outbox / one notification; 1000 more ticks stay at one."""
    await _setup_user(client)
    starts = clock.now() + timedelta(hours=1)
    created = await client.post(
        "/api/notes",
        json={
            "title": "T1",
            "body": "one mail",
            "starts_at": starts.isoformat().replace("+00:00", "Z"),
            "reminder_offsets": [10],
            "tag_ids": [],
        },
    )
    assert created.status_code == 201
    note_id = uuid.UUID(created.json()["id"])

    clock.set(clock.now() + timedelta(minutes=50, seconds=1))

    # Two concurrent production ticks — each opens its own SessionLocal (own connection).
    await asyncio.gather(
        tick(clock.now(), smtp_send=_noop_smtp),
        tick(clock.now(), smtp_send=_noop_smtp),
    )

    assert await _count(Reminder, note_id=note_id, status="sent") == 1
    assert await _notif_count_for_note(note_id) == 1
    assert await _outbox_count_for_note(note_id) == 1

    for _ in range(1000):
        await tick(clock.now(), smtp_send=_noop_smtp)

    assert await _outbox_count_for_note(note_id) == 1
    assert await _notif_count_for_note(note_id) == 1


@pytest.mark.asyncio
async def test_inactive_note_no_reminder(client: AsyncClient, clock: FrozenClock):
    """T4."""
    await _setup_user(client)
    starts = clock.now() + timedelta(hours=1)
    created = await client.post(
        "/api/notes",
        json={
            "title": "inactive",
            "body": "",
            "starts_at": starts.isoformat().replace("+00:00", "Z"),
            "reminder_offsets": [10],
            "tag_ids": [],
        },
    )
    note_id = uuid.UUID(created.json()["id"])
    assert (await client.post(f"/api/notes/{note_id}/deactivate")).status_code == 200

    clock.set(clock.now() + timedelta(minutes=50, seconds=1))
    await tick(clock.now(), smtp_send=_noop_smtp)

    rem = await _one_reminder(note_id)
    assert rem.status == "skipped"
    assert await _outbox_count_for_note(note_id) == 0
    assert await _notif_count_for_note(note_id) == 0


@pytest.mark.asyncio
async def test_reactivate_before_due(client: AsyncClient, clock: FrozenClock):
    """T5a: deactivate then activate before fire_at → reminder still fires."""
    await _setup_user(client)
    starts = clock.now() + timedelta(hours=1)
    created = await client.post(
        "/api/notes",
        json={
            "title": "reactivate-before",
            "body": "",
            "starts_at": starts.isoformat().replace("+00:00", "Z"),
            "reminder_offsets": [10],
            "tag_ids": [],
        },
    )
    note_id = uuid.UUID(created.json()["id"])
    await client.post(f"/api/notes/{note_id}/deactivate")
    await client.post(f"/api/notes/{note_id}/activate")

    clock.set(clock.now() + timedelta(minutes=50, seconds=1))
    await tick(clock.now(), smtp_send=_noop_smtp)

    rem = await _one_reminder(note_id)
    assert rem.status == "sent"
    assert await _outbox_count_for_note(note_id) == 1


@pytest.mark.asyncio
async def test_reactivate_after_due_no_backfill(client: AsyncClient, clock: FrozenClock):
    """T5b: fire while inactive → skipped; reactivate does not backfill."""
    await _setup_user(client)
    starts = clock.now() + timedelta(hours=1)
    created = await client.post(
        "/api/notes",
        json={
            "title": "reactivate-after",
            "body": "",
            "starts_at": starts.isoformat().replace("+00:00", "Z"),
            "reminder_offsets": [10],
            "tag_ids": [],
        },
    )
    note_id = uuid.UUID(created.json()["id"])
    await client.post(f"/api/notes/{note_id}/deactivate")

    clock.set(clock.now() + timedelta(minutes=50, seconds=1))
    await tick(clock.now(), smtp_send=_noop_smtp)
    rem = await _one_reminder(note_id)
    assert rem.status == "skipped"

    await client.post(f"/api/notes/{note_id}/activate")
    await tick(clock.now(), smtp_send=_noop_smtp)

    rem2 = await _one_reminder(note_id)
    assert rem2.status == "skipped"
    assert await _outbox_count_for_note(note_id) == 0


@pytest.mark.asyncio
async def test_reschedule_moves_reminders(client: AsyncClient, clock: FrozenClock):
    """T6a."""
    await _setup_user(client)
    starts = clock.now() + timedelta(hours=2)
    created = await client.post(
        "/api/notes",
        json={
            "title": "move",
            "body": "",
            "starts_at": starts.isoformat().replace("+00:00", "Z"),
            "reminder_offsets": [30],
            "tag_ids": [],
        },
    )
    note = created.json()
    old = await _one_reminder(uuid.UUID(note["id"]))
    old_fire = old.fire_at

    new_starts = starts + timedelta(hours=1)
    patched = await client.patch(
        f"/api/notes/{note['id']}",
        json={"version": note["version"], "starts_at": new_starts.isoformat().replace("+00:00", "Z")},
    )
    assert patched.status_code == 200

    rem = await _one_reminder(uuid.UUID(note["id"]))
    assert rem.status == "pending"
    assert rem.fire_at == new_starts - timedelta(minutes=30)
    assert rem.fire_at != old_fire


@pytest.mark.asyncio
async def test_sent_not_resent_on_edit(client: AsyncClient, clock: FrozenClock):
    """T6b: after sent, edit schedule → old sent stays; no second outbox for old reminder."""
    await _setup_user(client)
    starts = clock.now() + timedelta(hours=1)
    created = await client.post(
        "/api/notes",
        json={
            "title": "sent-stay",
            "body": "",
            "starts_at": starts.isoformat().replace("+00:00", "Z"),
            "reminder_offsets": [10],
            "tag_ids": [],
        },
    )
    note = created.json()
    note_id = uuid.UUID(note["id"])
    clock.set(clock.now() + timedelta(minutes=50, seconds=1))
    await tick(clock.now(), smtp_send=_noop_smtp)
    assert await _outbox_count_for_note(note_id) == 1

    async with db_module.SessionLocal() as session:
        sent_id = (
            await session.execute(
                select(EmailOutbox.reminder_id)
                .join(Reminder, Reminder.id == EmailOutbox.reminder_id)
                .where(Reminder.note_id == note_id)
            )
        ).scalar_one()

    new_starts = starts + timedelta(days=1)
    version = (await client.get(f"/api/notes/{note['id']}")).json()["version"]
    patched = await client.patch(
        f"/api/notes/{note['id']}",
        json={
            "version": version,
            "starts_at": new_starts.isoformat().replace("+00:00", "Z"),
            "reminder_offsets": [10],
        },
    )
    assert patched.status_code == 200

    by_offset = await _reminders_by_offset(note_id)
    statuses = set(by_offset.get(10, []))
    assert "sent" in statuses
    assert "pending" in statuses
    assert await _outbox_count_for_note(note_id) == 1
    async with db_module.SessionLocal() as session:
        still = (
            await session.execute(
                select(EmailOutbox.reminder_id)
                .join(Reminder, Reminder.id == EmailOutbox.reminder_id)
                .where(Reminder.note_id == note_id)
            )
        ).scalar_one()
    assert still == sent_id


@pytest.mark.asyncio
async def test_delete_cancels(client: AsyncClient, clock: FrozenClock):
    """T7a."""
    await _setup_user(client)
    starts = clock.now() + timedelta(hours=1)
    created = await client.post(
        "/api/notes",
        json={
            "title": "trash-me",
            "body": "",
            "starts_at": starts.isoformat().replace("+00:00", "Z"),
            "reminder_offsets": [10],
            "tag_ids": [],
        },
    )
    note_id = uuid.UUID(created.json()["id"])
    assert (await client.delete(f"/api/notes/{note_id}")).status_code == 200

    clock.set(clock.now() + timedelta(minutes=50, seconds=1))
    await tick(clock.now(), smtp_send=_noop_smtp)

    rem = await _one_reminder(note_id)
    assert rem.status == "skipped"
    assert await _outbox_count_for_note(note_id) == 0


@pytest.mark.asyncio
async def test_restore_returns_future_only(client: AsyncClient, clock: FrozenClock):
    """T7b: due-while-trashed → skipped; still-future pending survives restore and fires."""
    await _setup_user(client)
    starts = clock.now() + timedelta(hours=2)
    created = await client.post(
        "/api/notes",
        json={
            "title": "restore",
            "body": "",
            "starts_at": starts.isoformat().replace("+00:00", "Z"),
            "reminder_offsets": [90, 10],  # fire at +30m and +110m
            "tag_ids": [],
        },
    )
    note_id = uuid.UUID(created.json()["id"])
    assert (await client.delete(f"/api/notes/{note_id}")).status_code == 200

    clock.set(clock.now() + timedelta(minutes=31))
    await tick(clock.now(), smtp_send=_noop_smtp)

    by_offset = await _reminders_by_offset(note_id)
    assert by_offset[90] == ["skipped"]
    assert by_offset[10] == ["pending"]

    restored = await client.post(f"/api/notes/{note_id}/restore")
    assert restored.status_code == 200

    clock.set(starts - timedelta(minutes=10) + timedelta(seconds=1))
    await tick(clock.now(), smtp_send=_noop_smtp)

    by_offset = await _reminders_by_offset(note_id)
    assert by_offset[90] == ["skipped"]
    assert by_offset[10] == ["sent"]
    assert await _outbox_count_for_note(note_id) == 1


@pytest.mark.asyncio
async def test_trash_purge_30d(client: AsyncClient, clock: FrozenClock):
    """T8: 29d23h kept; older than 30d purged (spec: deleted_at < now - 30d)."""
    await _setup_user(client)
    now = clock.now()

    async def make_trashed(title: str, deleted_at: datetime) -> uuid.UUID:
        created = await client.post(
            "/api/notes",
            json={
                "title": title,
                "body": "",
                "starts_at": (now + timedelta(days=1)).isoformat().replace("+00:00", "Z"),
                "reminder_offsets": [],
                "tag_ids": [],
            },
        )
        note_id = uuid.UUID(created.json()["id"])
        assert (await client.delete(f"/api/notes/{note_id}")).status_code == 200
        async with db_module.SessionLocal() as session:
            async with session.begin():
                await session.execute(
                    update(Note).where(Note.id == note_id).values(deleted_at=deleted_at)
                )
        return note_id

    # Exactly 30d0h is NOT < cutoff; use 30d0h+1s as the purged side of the boundary.
    keep_id = await make_trashed("keep", now - timedelta(days=29, hours=23))
    drop_id = await make_trashed("drop", now - timedelta(days=30, seconds=1))

    async with db_module.SessionLocal() as session:
        async with session.begin():
            n = await purge_trash(session, now, retention_days=30)
            assert n == 1

    async with db_module.SessionLocal() as session:
        assert await session.get(Note, keep_id) is not None
        assert await session.get(Note, drop_id) is None


@pytest.mark.asyncio
async def test_restart_keeps_pending(client: AsyncClient, clock: FrozenClock):
    """T18: pending lives in DB — new tick after 'restart' still fires."""
    await _setup_user(client)
    starts = clock.now() + timedelta(hours=1)
    created = await client.post(
        "/api/notes",
        json={
            "title": "restart",
            "body": "",
            "starts_at": starts.isoformat().replace("+00:00", "Z"),
            "reminder_offsets": [10],
            "tag_ids": [],
        },
    )
    note_id = uuid.UUID(created.json()["id"])
    rem = await _one_reminder(note_id)
    assert rem.status == "pending"
    reminder_id = rem.id

    worker_mod._last_hourly_at = None
    clock.set(clock.now() + timedelta(minutes=50, seconds=1))
    await tick(clock.now(), smtp_send=_noop_smtp)

    async with db_module.SessionLocal() as session:
        rem2 = await session.get(Reminder, reminder_id)
        assert rem2 is not None
        assert rem2.status == "sent"


@pytest.mark.asyncio
async def test_downtime_future_sent_late(client: AsyncClient, clock: FrozenClock):
    """T19a: fire_at passed, occurrence still ahead → sent (late)."""
    await _setup_user(client)
    starts = clock.now() + timedelta(hours=1)
    created = await client.post(
        "/api/notes",
        json={
            "title": "late",
            "body": "",
            "starts_at": starts.isoformat().replace("+00:00", "Z"),
            "reminder_offsets": [30],
            "tag_ids": [],
        },
    )
    note_id = uuid.UUID(created.json()["id"])
    clock.set(clock.now() + timedelta(minutes=45))
    await tick(clock.now(), smtp_send=_noop_smtp)

    rem = await _one_reminder(note_id)
    assert rem.status == "sent"
    assert await _outbox_count_for_note(note_id) == 1


@pytest.mark.asyncio
async def test_downtime_past_marked_missed(client: AsyncClient, clock: FrozenClock):
    """T19b: occurrence already past → missed, no email."""
    await _setup_user(client)
    starts = clock.now() + timedelta(minutes=20)
    created = await client.post(
        "/api/notes",
        json={
            "title": "missed",
            "body": "",
            "starts_at": starts.isoformat().replace("+00:00", "Z"),
            "reminder_offsets": [10],
            "tag_ids": [],
        },
    )
    note_id = uuid.UUID(created.json()["id"])
    clock.set(starts + timedelta(minutes=1))
    await tick(clock.now(), smtp_send=_noop_smtp)

    rem = await _one_reminder(note_id)
    assert rem.status == "missed"
    assert await _outbox_count_for_note(note_id) == 0
    assert await _notif_count_for_note(note_id) == 0


@pytest.mark.asyncio
async def test_timezone_change_keeps_fire_at(client: AsyncClient, clock: FrozenClock):
    """T15: PATCH timezone does not move reminder fire_at (UTC truth)."""
    await _setup_user(client)
    starts = clock.now() + timedelta(hours=2)
    created = await client.post(
        "/api/notes",
        json={
            "title": "tz",
            "body": "",
            "starts_at": starts.isoformat().replace("+00:00", "Z"),
            "reminder_offsets": [60],
            "tag_ids": [],
        },
    )
    note_id = uuid.UUID(created.json()["id"])
    before = await _one_reminder(note_id)
    fire_before = before.fire_at
    starts_before = created.json()["starts_at"]

    patched = await client.patch("/api/me", json={"timezone": "America/New_York"})
    assert patched.status_code == 200
    assert patched.json()["timezone"] == "America/New_York"

    note = await client.get(f"/api/notes/{note_id}")
    assert note.json()["starts_at"] == starts_before
    after = await _one_reminder(note_id)
    assert after.fire_at == fire_before
    assert after.status == "pending"
