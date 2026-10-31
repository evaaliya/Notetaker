"""Attachment validation, disk storage, and note ownership helpers (M9)."""

from __future__ import annotations

import io
import re
import uuid
import zipfile
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.errors import AppError
from app.models import Attachment, Note

# Display names only — content type is decided by sniffing.
_SAFE_NAME = re.compile(r"[^\w.\- ()\[\]]+", re.UNICODE)
_MAX_FILENAME_LEN = 200

ALLOWED_CONTENT_TYPES = frozenset(
    {
        "image/png",
        "image/jpeg",
        "image/webp",
        "image/gif",
        "application/pdf",
        "text/plain",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }
)

_EXT_FOR_TYPE = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "application/pdf": ".pdf",
    "text/plain": ".txt",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
}


def uploads_root(settings: Settings) -> Path:
    root = Path(settings.uploads_dir)
    root.mkdir(parents=True, exist_ok=True)
    return root


def absolute_path(settings: Settings, storage_key: str) -> Path:
    if not storage_key or "/" in storage_key or "\\" in storage_key or ".." in storage_key:
        raise AppError("validation_error", "Некорректный путь файла", status_code=400)
    root = uploads_root(settings).resolve()
    path = (root / storage_key).resolve()
    try:
        path.relative_to(root)
    except ValueError as exc:
        raise AppError("validation_error", "Некорректный путь файла", status_code=400) from exc
    return path


def sanitize_filename(raw: str | None, content_type: str) -> str:
    name = (raw or "file").replace("\\", "/").split("/")[-1].strip()
    name = _SAFE_NAME.sub("_", name).strip("._ ") or "file"
    if len(name) > _MAX_FILENAME_LEN:
        stem, dot, ext = name.rpartition(".")
        if dot and len(ext) <= 10:
            keep = _MAX_FILENAME_LEN - len(ext) - 1
            name = f"{stem[:keep]}.{ext}"
        else:
            name = name[:_MAX_FILENAME_LEN]
    expected = _EXT_FOR_TYPE.get(content_type)
    if expected and not name.lower().endswith(expected):
        # Strip a wrong trailing extension, then append the sniffed one.
        lower = name.lower()
        for ext in (".png", ".jpg", ".jpeg", ".webp", ".gif", ".pdf", ".txt", ".docx"):
            if lower.endswith(ext):
                name = name[: -len(ext)]
                break
        name = (name.rstrip(".") or "file") + expected
    return name


def sniff_content_type(data: bytes) -> str | None:
    if len(data) >= 8 and data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if len(data) >= 3 and data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if len(data) >= 6 and data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if len(data) >= 5 and data[:5] == b"%PDF-":
        return "application/pdf"
    if _looks_like_docx(data):
        return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    if _looks_like_text(data):
        return "text/plain"
    return None


def _looks_like_docx(data: bytes) -> bool:
    if len(data) < 4 or data[:2] != b"PK":
        return False
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            names = set(zf.namelist())
            return "[Content_Types].xml" in names and any(
                n.startswith("word/") for n in names
            )
    except zipfile.BadZipFile:
        return False


def _looks_like_text(data: bytes) -> bool:
    if not data:
        return True
    if b"\x00" in data[:8192]:
        return False
    try:
        data.decode("utf-8")
        return True
    except UnicodeDecodeError:
        try:
            data.decode("latin-1")
            return True
        except UnicodeDecodeError:
            return False


def unlink_storage(settings: Settings, storage_key: str) -> None:
    path = absolute_path(settings, storage_key)
    path.unlink(missing_ok=True)


async def get_owned_note(
    db: AsyncSession, user_id: uuid.UUID, note_id: uuid.UUID, *, allow_trashed: bool = True
) -> Note | None:
    note = await db.get(Note, note_id)
    if note is None or note.user_id != user_id:
        return None
    if not allow_trashed and note.deleted_at is not None:
        return None
    return note


async def count_attachments(db: AsyncSession, note_id: uuid.UUID) -> int:
    result = await db.scalar(
        select(func.count()).select_from(Attachment).where(Attachment.note_id == note_id)
    )
    return int(result or 0)


async def note_ids_with_attachments(
    db: AsyncSession, note_ids: list[uuid.UUID]
) -> set[uuid.UUID]:
    if not note_ids:
        return set()
    result = await db.execute(
        select(Attachment.note_id).where(Attachment.note_id.in_(note_ids)).distinct()
    )
    return set(result.scalars().all())
