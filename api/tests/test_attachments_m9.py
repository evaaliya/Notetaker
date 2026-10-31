"""M9: note attachments — upload, limits, ownership, purge files."""

from __future__ import annotations

import io
import uuid
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from httpx import AsyncClient
from sqlalchemy import update

from app import db as db_module
from app.clock import FrozenClock
from app.config import get_settings
from app.models import Attachment, Note
from app.services.attachments import absolute_path, unlink_storage
from app.services.worker_jobs import purge_trash

# Minimal 1x1 PNG
_PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00"
    b"\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
)


async def _register(client: AsyncClient, login: str | None = None) -> str:
    login = login or f"a_{uuid.uuid4().hex[:10]}"
    resp = await client.post("/api/auth/register", json={"login": login, "password": "x"})
    assert resp.status_code == 200
    return login


async def _create_note(client: AsyncClient, title: str = "with file") -> dict:
    resp = await client.post(
        "/api/notes",
        json={
            "title": title,
            "body": "",
            "starts_at": "2026-10-31T12:00:00Z",
            "tag_ids": [],
            "reminder_offsets": [],
        },
    )
    assert resp.status_code == 201
    return resp.json()


def _docx_bytes() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("[Content_Types].xml", "<Types></Types>")
        zf.writestr("word/document.xml", "<w:document></w:document>")
    return buf.getvalue()


@pytest.mark.asyncio
async def test_attachment_upload_ok(client: AsyncClient, uploads_dir: Path):
    await _register(client)
    note = await _create_note(client)
    note_id = note["id"]

    resp = await client.post(
        f"/api/notes/{note_id}/attachments",
        files={"file": ("photo.png", _PNG, "application/octet-stream")},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["filename"] == "photo.png"
    assert body["content_type"] == "image/png"
    assert body["size"] == len(_PNG)
    assert body["note_id"] == note_id

    listed = await client.get(f"/api/notes/{note_id}/attachments")
    assert listed.status_code == 200
    assert len(listed.json()) == 1

    got = await client.get(f"/api/notes/{note_id}")
    assert got.json()["has_attachments"] is True

    dl = await client.get(f"/api/notes/{note_id}/attachments/{body['id']}")
    assert dl.status_code == 200
    assert dl.content == _PNG
    assert dl.headers.get("x-content-type-options") == "nosniff"
    assert "attachment" in (dl.headers.get("content-disposition") or "").lower()

    disk = absolute_path(get_settings(), body["id"])
    assert disk.is_file()
    assert disk.read_bytes() == _PNG


@pytest.mark.asyncio
async def test_attachment_too_large_413(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    await _register(client)
    note = await _create_note(client)
    settings = get_settings()
    monkeypatch.setattr(settings, "upload_max_bytes", 64)

    # Valid PNG magic but oversized for the patched limit.
    big = _PNG + b"x" * 100
    resp = await client.post(
        f"/api/notes/{note['id']}/attachments",
        files={"file": ("big.png", big, "image/png")},
    )
    assert resp.status_code == 413
    assert "МБ" in resp.json()["error"]["message"] or "больше" in resp.json()["error"]["message"]


@pytest.mark.asyncio
async def test_attachment_bad_type_415(client: AsyncClient):
    await _register(client)
    note = await _create_note(client)
    resp = await client.post(
        f"/api/notes/{note['id']}/attachments",
        files={"file": ("evil.exe", b"MZ\x90\x00not-an-image", "application/octet-stream")},
    )
    assert resp.status_code == 415


@pytest.mark.asyncio
async def test_attachment_foreign_404(client: AsyncClient):
    await _register(client, "owner_m9")
    note = await _create_note(client, "secret")
    up = await client.post(
        f"/api/notes/{note['id']}/attachments",
        files={"file": ("a.png", _PNG, "image/png")},
    )
    assert up.status_code == 201
    att_id = up.json()["id"]
    note_id = note["id"]

    await client.post("/api/auth/logout")
    await _register(client, "intruder_m9")

    listed = await client.get(f"/api/notes/{note_id}/attachments")
    assert listed.status_code == 404

    dl = await client.get(f"/api/notes/{note_id}/attachments/{att_id}")
    assert dl.status_code == 404

    deleted = await client.delete(f"/api/notes/{note_id}/attachments/{att_id}")
    assert deleted.status_code == 404


@pytest.mark.asyncio
async def test_trash_purge_deletes_attachment_files(
    client: AsyncClient, clock: FrozenClock, uploads_dir: Path
):
    await _register(client)
    now = clock.now()
    note = await _create_note(client, "purge-me")
    note_id = uuid.UUID(note["id"])
    up = await client.post(
        f"/api/notes/{note_id}/attachments",
        files={"file": ("gone.png", _PNG, "image/png")},
    )
    assert up.status_code == 201
    att = up.json()
    path = absolute_path(get_settings(), att["id"])
    assert path.is_file()

    assert (await client.delete(f"/api/notes/{note_id}")).status_code == 200
    # Soft-delete keeps file and row
    assert path.is_file()
    listed = await client.get(f"/api/notes/{note_id}/attachments")
    assert listed.status_code == 200
    assert len(listed.json()) == 1

    async with db_module.SessionLocal() as session:
        async with session.begin():
            await session.execute(
                update(Note)
                .where(Note.id == note_id)
                .values(deleted_at=now - timedelta(days=30, seconds=1))
            )

    async with db_module.SessionLocal() as session:
        async with session.begin():
            n, keys = await purge_trash(session, now, retention_days=30)
            assert n == 1
            assert att["id"] in keys

    for key in keys:
        unlink_storage(get_settings(), key)

    assert not path.exists()
    async with db_module.SessionLocal() as session:
        assert await session.get(Note, note_id) is None
        assert await session.get(Attachment, uuid.UUID(att["id"])) is None


@pytest.mark.asyncio
async def test_attachment_txt_and_docx_ok(client: AsyncClient):
    await _register(client)
    note = await _create_note(client)
    txt = await client.post(
        f"/api/notes/{note['id']}/attachments",
        files={"file": ("notes.txt", "привет\n".encode("utf-8"), "text/plain")},
    )
    assert txt.status_code == 201
    assert txt.json()["content_type"] == "text/plain"

    docx = await client.post(
        f"/api/notes/{note['id']}/attachments",
        files={"file": ("doc.docx", _docx_bytes(), "application/octet-stream")},
    )
    assert docx.status_code == 201
    assert "wordprocessingml" in docx.json()["content_type"]
