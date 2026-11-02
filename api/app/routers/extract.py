"""M11/M14: extract drafts from text / transcript / YouTube captions."""

from __future__ import annotations

import uuid
from datetime import timezone
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, File, Form, UploadFile
from pydantic import BaseModel, ValidationError, field_serializer
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_clock, get_current_user
from app.clock import Clock
from app.config import get_settings
from app.db import get_session
from app.errors import AppError
from app.models import ExtractJob, User
from app.schemas.extract import ExtractIn, ExtractOut, YoutubeExtractIn
from app.services.extract_jobs import (
    create_youtube_job,
    get_cached_captions,
    put_cached_captions,
    request_cancel,
)
from app.services.extract_run import run_text_extract
from app.services.transcripts import parse_transcript
from app.services.youtube_captions import extract_youtube_id, fetch_youtube_captions

router = APIRouter(prefix="/extract", tags=["extract"])


def _iso_z(value) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


class ExtractJobOut(BaseModel):
    id: uuid.UUID
    status: Literal["pending", "running", "done", "error", "cancelled"]
    step: Literal["queued", "captions", "extract", "done"]
    video_id: str | None = None
    error_code: str | None = None
    error_message: str | None = None
    error_hint: str | None = None
    result: ExtractOut | None = None
    created_at: Any
    updated_at: Any
    finished_at: Any | None = None

    @field_serializer("created_at", "updated_at", "finished_at")
    def ser_dt(self, value):
        if value is None:
            return None
        return _iso_z(value)


class ExtractJobCreated(BaseModel):
    id: uuid.UUID
    status: str
    step: str
    video_id: str | None = None
    reused: bool = False


def _job_to_out(job: ExtractJob) -> ExtractJobOut:
    result = None
    if job.status == "done" and isinstance(job.result, dict):
        result = ExtractOut.model_validate(job.result)
    return ExtractJobOut(
        id=job.id,
        status=job.status,  # type: ignore[arg-type]
        step=job.step,  # type: ignore[arg-type]
        video_id=job.video_id,
        error_code=job.error_code,
        error_message=job.error_message,
        error_hint=job.error_hint,
        result=result,
        created_at=job.created_at,
        updated_at=job.updated_at,
        finished_at=job.finished_at,
    )


async def _captions_with_cache(
    session: AsyncSession, url: str, *, clock: Clock
) -> tuple[str, str]:
    settings = get_settings()
    video_id = extract_youtube_id(url)
    now = clock.now()
    cached = await get_cached_captions(
        session, video_id, now=now, ttl_hours=settings.youtube_caption_cache_ttl_hours
    )
    if cached:
        return cached
    text, lang = fetch_youtube_captions(
        url,
        timeout=settings.youtube_captions_timeout_sec,
        retries=settings.extract_transient_retries,
        retry_pause_sec=settings.extract_retry_pause_sec,
    )
    await put_cached_captions(session, video_id, text, lang, now=now)
    return text, lang


@router.post("", response_model=ExtractOut)
async def extract_text(
    body: ExtractIn,
    user: Annotated[User, Depends(get_current_user)],
    clock: Annotated[Clock, Depends(get_clock)],
    _db: Annotated[AsyncSession, Depends(get_session)],
) -> ExtractOut:
    return run_text_extract(body.text, user=user, clock=clock, timezone_name=body.timezone)


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

    return run_text_extract(raw_text, user=user, clock=clock, timezone_name=timezone_name)


@router.post("/youtube", response_model=ExtractOut)
async def extract_youtube(
    body: YoutubeExtractIn,
    user: Annotated[User, Depends(get_current_user)],
    clock: Annotated[Clock, Depends(get_clock)],
    db: Annotated[AsyncSession, Depends(get_session)],
) -> ExtractOut:
    """Sync path (compat). Prefers caption cache; same timeouts as jobs."""
    text, caption_lang = await _captions_with_cache(db, body.url, clock=clock)
    await db.commit()
    return run_text_extract(
        text,
        user=user,
        clock=clock,
        timezone_name=body.timezone,
        transcript=text,
        caption_lang=caption_lang,
    )


@router.post("/youtube/jobs", response_model=ExtractJobCreated)
async def start_youtube_job(
    body: YoutubeExtractIn,
    user: Annotated[User, Depends(get_current_user)],
    clock: Annotated[Clock, Depends(get_clock)],
    db: Annotated[AsyncSession, Depends(get_session)],
) -> ExtractJobCreated:
    """Start (or reuse in-flight) background YouTube extract job."""
    before = None
    video_id = extract_youtube_id(body.url)
    from app.services.extract_jobs import find_inflight_job

    before = await find_inflight_job(db, user_id=user.id, video_id=video_id)
    job = await create_youtube_job(
        db, user=user, url=body.url, timezone_name=body.timezone, now=clock.now()
    )
    reused = before is not None and before.id == job.id
    await db.commit()
    return ExtractJobCreated(
        id=job.id,
        status=job.status,
        step=job.step,
        video_id=job.video_id,
        reused=reused,
    )


@router.get("/jobs/{job_id}", response_model=ExtractJobOut)
async def get_extract_job(
    job_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_session)],
) -> ExtractJobOut:
    job = await db.get(ExtractJob, job_id)
    if job is None or job.user_id != user.id:
        raise AppError("not_found", "Задача не найдена", status_code=404)
    return _job_to_out(job)


@router.post("/jobs/{job_id}/cancel", response_model=ExtractJobOut)
async def cancel_extract_job(
    job_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    clock: Annotated[Clock, Depends(get_clock)],
    db: Annotated[AsyncSession, Depends(get_session)],
) -> ExtractJobOut:
    job = await db.get(ExtractJob, job_id)
    if job is None or job.user_id != user.id:
        raise AppError("not_found", "Задача не найдена", status_code=404)
    if job.status in ("done", "error", "cancelled"):
        return _job_to_out(job)
    await request_cancel(db, job=job, now=clock.now())
    await db.commit()
    await db.refresh(job)
    return _job_to_out(job)
