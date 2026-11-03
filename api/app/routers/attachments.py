"""Note attachments: upload, list, download, delete (M9)."""

from __future__ import annotations

import uuid
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from fastapi.responses import FileResponse, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.clock import Clock
from app.config import Settings, get_settings
from app.db import get_session
from app.errors import AppError
from app.models import Attachment, User
from app.schemas.attachments import AttachmentOut
from app.services.access import get_note_access, notify_note_audience
from app.services.attachments import (
    ALLOWED_CONTENT_TYPES,
    absolute_path,
    count_attachments,
    sanitize_filename,
    sniff_content_type,
    unlink_storage,
    uploads_root,
)

router = APIRouter(tags=["attachments"])


def _clock(request: Request) -> Clock:
    return request.app.state.clock


def _attachment_out(row: Attachment) -> AttachmentOut:
    return AttachmentOut(
        id=row.id,
        note_id=row.note_id,
        filename=row.filename,
        content_type=row.content_type,
        size=row.size,
        created_at=row.created_at,
    )


@router.get("/notes/{note_id}/attachments", response_model=list[AttachmentOut])
async def list_attachments(
    note_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
) -> list[AttachmentOut]:
    await get_note_access(db, user.id, note_id, allow_deleted=True)
    result = await db.execute(
        select(Attachment)
        .where(Attachment.note_id == note_id)
        .order_by(Attachment.created_at.asc(), Attachment.id.asc())
    )
    return [_attachment_out(a) for a in result.scalars().all()]


@router.post("/notes/{note_id}/attachments", response_model=AttachmentOut, status_code=201)
async def upload_attachment(
    note_id: uuid.UUID,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
    file: UploadFile = File(...),
    client_id: str | None = Form(None),
) -> AttachmentOut:
    access = await get_note_access(db, user.id, note_id, allow_deleted=False)
    note = access.note

    parsed_client_id: uuid.UUID | None = None
    if client_id:
        try:
            parsed_client_id = uuid.UUID(client_id)
        except ValueError as exc:
            raise AppError("validation_error", "client_id must be a UUID") from exc
        existing = (
            await db.execute(
                select(Attachment).where(
                    Attachment.note_id == note_id,
                    Attachment.client_id == parsed_client_id,
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            return _attachment_out(existing)

    n = await count_attachments(db, note_id)
    if n >= settings.upload_max_per_note:
        raise AppError(
            "limit_exceeded",
            f"Не больше {settings.upload_max_per_note} файлов на заметку",
            status_code=400,
        )

    data = await file.read(settings.upload_max_bytes + 1)
    if len(data) > settings.upload_max_bytes:
        raise AppError(
            "payload_too_large",
            f"Файл больше {settings.upload_max_bytes // (1024 * 1024)} МБ",
            status_code=413,
        )
    if not data:
        raise AppError("validation_error", "Пустой файл", status_code=400)

    content_type = sniff_content_type(data)
    if content_type is None or content_type not in ALLOWED_CONTENT_TYPES:
        raise AppError(
            "unsupported_media_type",
            "Тип файла не поддерживается. Разрешены: png, jpg, webp, gif, pdf, txt, docx",
            status_code=415,
        )

    filename = sanitize_filename(file.filename, content_type)
    att_id = uuid.uuid4()
    storage_key = str(att_id)
    path = absolute_path(settings, storage_key)
    uploads_root(settings)
    path.write_bytes(data)

    now = _clock(request).now()
    row = Attachment(
        id=att_id,
        note_id=note_id,
        filename=filename,
        content_type=content_type,
        size=len(data),
        storage_key=storage_key,
        created_at=now,
        client_id=parsed_client_id,
    )
    db.add(row)
    try:
        await notify_note_audience(
            db,
            note,
            "attachment.added",
            ids=[att_id],
            extra={"note_id": str(note_id)},
        )
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        if parsed_client_id is not None:
            raced = (
                await db.execute(
                    select(Attachment).where(
                        Attachment.note_id == note_id,
                        Attachment.client_id == parsed_client_id,
                    )
                )
            ).scalar_one_or_none()
            if raced is not None:
                unlink_storage(settings, storage_key)
                return _attachment_out(raced)
        raise AppError("conflict", "attachment conflict", status_code=409) from exc
    await db.refresh(row)
    return _attachment_out(row)


@router.get("/notes/{note_id}/attachments/{attachment_id}")
async def download_attachment(
    note_id: uuid.UUID,
    attachment_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> Response:
    await get_note_access(db, user.id, note_id, allow_deleted=True)
    row = await db.get(Attachment, attachment_id)
    if row is None or row.note_id != note_id:
        raise AppError("not_found", "Файл не найден", status_code=404)

    path = absolute_path(settings, row.storage_key)
    if not path.is_file():
        raise AppError("not_found", "Файл не найден", status_code=404)

    # RFC 5987 filename* for non-ASCII; ASCII fallback stripped.
    ascii_name = row.filename.encode("ascii", "ignore").decode() or "file"
    disposition = (
        f"attachment; filename=\"{ascii_name}\"; "
        f"filename*=UTF-8''{quote(row.filename)}"
    )
    return FileResponse(
        path,
        media_type=row.content_type,
        filename=row.filename,
        headers={
            "Content-Disposition": disposition,
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.delete("/notes/{note_id}/attachments/{attachment_id}", status_code=204)
async def delete_attachment(
    note_id: uuid.UUID,
    attachment_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> Response:
    access = await get_note_access(db, user.id, note_id, allow_deleted=False)
    row = await db.get(Attachment, attachment_id)
    if row is None or row.note_id != note_id:
        raise AppError("not_found", "Файл не найден", status_code=404)

    storage_key = row.storage_key
    await db.delete(row)
    await notify_note_audience(
        db,
        access.note,
        "attachment.deleted",
        ids=[attachment_id],
        extra={"note_id": str(note_id)},
    )
    await db.commit()
    unlink_storage(settings, storage_key)
    return Response(status_code=204)
