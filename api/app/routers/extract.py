"""M11: extract drafts from text / transcript files (does not persist notes)."""

from __future__ import annotations

from datetime import timezone
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, UploadFile
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_clock, get_current_user
from app.clock import Clock
from app.config import get_settings
from app.db import get_session
from app.errors import AppError
from app.models import User
from app.schemas.extract import DraftOut, ExtractIn, ExtractOut
from app.services.ai import DraftNote, get_provider
from app.services.transcripts import parse_transcript

router = APIRouter(prefix="/extract", tags=["extract"])


def _draft_out(d: DraftNote) -> DraftOut:
    starts = d.starts_at
    if starts is not None and starts.tzinfo is not None:
        starts = starts.astimezone(timezone.utc)
    kind = d.kind if d.kind in ("summary", "task", "decision") else "task"
    return DraftOut(
        title=d.title,
        body=d.body,
        starts_at=starts,
        reminder_offsets=list(d.reminder_offsets or []),
        tag_names=list(d.tag_names or []),
        kind=kind,  # type: ignore[arg-type]
    )


def _run_extract(text: str, *, user: User, clock: Clock, timezone_name: str | None) -> ExtractOut:
    tz = timezone_name or user.timezone or "UTC"
    provider_name = (get_settings().ai_provider or "stub").strip().lower()
    try:
        provider = get_provider()
        result = provider.extract(text, now=clock.now(), timezone=tz)
    except AppError:
        raise
    except ValueError as exc:
        raise AppError("config_error", str(exc), status_code=503) from exc
    except Exception as exc:  # noqa: BLE001 — surface provider failures cleanly
        raise AppError("extract_failed", str(exc), status_code=502) from exc

    return ExtractOut(
        summary=_draft_out(result.summary) if result.summary else None,
        drafts=[_draft_out(d) for d in result.drafts],
        provider=provider_name,
    )


@router.post("", response_model=ExtractOut)
async def extract_text(
    body: ExtractIn,
    user: Annotated[User, Depends(get_current_user)],
    clock: Annotated[Clock, Depends(get_clock)],
    _db: Annotated[AsyncSession, Depends(get_session)],
) -> ExtractOut:
    return _run_extract(body.text, user=user, clock=clock, timezone_name=body.timezone)


@router.post("/transcript", response_model=ExtractOut)
async def extract_transcript(
    user: Annotated[User, Depends(get_current_user)],
    clock: Annotated[Clock, Depends(get_clock)],
    _db: Annotated[AsyncSession, Depends(get_session)],
    file: UploadFile | None = File(None),
    text: str | None = Form(None),
    timezone_name: str | None = Form(None, alias="timezone"),
) -> ExtractOut:
    raw_text = (text or "").strip()
    filename = file.filename if file is not None else None
    if file is not None:
        data = await file.read()
        if len(data) > 2 * 1024 * 1024:
            raise AppError("payload_too_large", "Транскрипт больше 2 МБ", status_code=413)
        raw_text = parse_transcript(filename, data)
    if not raw_text:
        raise AppError("validation_error", "Нужен файл или непустой text")

    if timezone_name:
        try:
            ExtractIn(text="x", timezone=timezone_name)
        except ValidationError as exc:
            raise AppError("validation_error", "Неизвестный IANA timezone") from exc

    return _run_extract(raw_text, user=user, clock=clock, timezone_name=timezone_name)
