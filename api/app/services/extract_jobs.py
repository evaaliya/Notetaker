"""DB-backed YouTube extract jobs + caption cache (M14 / D-083)."""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.clock import Clock
from app.config import Settings, get_settings
from app.errors import AppError
from app.models import ExtractJob, User, YoutubeCaptionCache
from app.schemas.extract import DraftOut, ExtractOut
from app.services.extract_errors import failure_for
from app.services.extract_run import run_text_extract
from app.services.youtube_captions import extract_youtube_id, fetch_youtube_captions

logger = logging.getLogger("extract_jobs")

_INFLIGHT = ("pending", "running")

FetchCaptionsFn = Callable[..., tuple[str, str]]
RunExtractFn = Callable[..., ExtractOut]


def _utc(now: datetime) -> datetime:
    if now.tzinfo is None:
        return now.replace(tzinfo=timezone.utc)
    return now.astimezone(timezone.utc)


def _draft_to_dict(d: DraftOut | None) -> dict | None:
    if d is None:
        return None
    starts = d.starts_at
    starts_s = None
    if starts is not None:
        starts_s = starts.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    return {
        "title": d.title,
        "body": d.body,
        "starts_at": starts_s,
        "reminder_offsets": list(d.reminder_offsets or []),
        "tag_names": list(d.tag_names or []),
        "kind": d.kind,
    }


def extract_out_to_dict(out: ExtractOut) -> dict[str, Any]:
    return {
        "summary": _draft_to_dict(out.summary),
        "drafts": [_draft_to_dict(d) for d in out.drafts],
        "provider": out.provider,
        "transcript": out.transcript,
        "source_lang": out.source_lang,
        "summary_ru": _draft_to_dict(out.summary_ru),
    }


async def get_cached_captions(
    session: AsyncSession, video_id: str, *, now: datetime, ttl_hours: int
) -> tuple[str, str] | None:
    from app.services.youtube_captions import caption_cache_key

    key = caption_cache_key(video_id)
    row = await session.get(YoutubeCaptionCache, key)
    if row is None:
        return None
    if _utc(now) - _utc(row.fetched_at) > timedelta(hours=ttl_hours):
        return None
    return row.body, row.lang


async def put_cached_captions(
    session: AsyncSession, video_id: str, text: str, lang: str, *, now: datetime
) -> None:
    from app.services.youtube_captions import caption_cache_key

    key = caption_cache_key(video_id)
    row = await session.get(YoutubeCaptionCache, key)
    if row is None:
        session.add(
            YoutubeCaptionCache(
                video_id=key,
                body=text,
                lang=lang,
                fetched_at=_utc(now),
                chars=len(text),
            )
        )
    else:
        row.body = text
        row.lang = lang
        row.fetched_at = _utc(now)
        row.chars = len(text)


async def find_inflight_job(
    session: AsyncSession, *, user_id: uuid.UUID, video_id: str
) -> ExtractJob | None:
    q = await session.execute(
        select(ExtractJob)
        .where(
            ExtractJob.user_id == user_id,
            ExtractJob.video_id == video_id,
            ExtractJob.status.in_(_INFLIGHT),
            ExtractJob.cancel_requested.is_(False),
        )
        .order_by(ExtractJob.created_at.desc())
        .limit(1)
    )
    return q.scalar_one_or_none()


async def create_youtube_job(
    session: AsyncSession,
    *,
    user: User,
    url: str,
    timezone_name: str | None,
    now: datetime,
) -> ExtractJob:
    from sqlalchemy.exc import IntegrityError

    video_id = extract_youtube_id(url)
    existing = await find_inflight_job(session, user_id=user.id, video_id=video_id)
    if existing is not None:
        return existing
    now_u = _utc(now)
    job = ExtractJob(
        id=uuid.uuid4(),
        user_id=user.id,
        kind="youtube",
        video_id=video_id,
        url=url,
        timezone=timezone_name,
        status="pending",
        step="queued",
        cancel_requested=False,
        created_at=now_u,
        updated_at=now_u,
    )
    try:
        async with session.begin_nested():
            session.add(job)
            await session.flush()
    except IntegrityError:
        # Concurrent create — return winner of partial unique index.
        again = await find_inflight_job(session, user_id=user.id, video_id=video_id)
        if again is None:
            raise
        return again
    return job


async def request_cancel(session: AsyncSession, *, job: ExtractJob, now: datetime) -> ExtractJob:
    now_u = _utc(now)
    job.cancel_requested = True
    job.updated_at = now_u
    if job.status == "pending":
        job.status = "cancelled"
        job.finished_at = now_u
        f = failure_for("cancelled")
        job.error_code = f.code
        job.error_message = f.message
        job.error_hint = f.hint
        job.result = None
    await session.flush()
    return job


async def claim_pending_jobs(
    session: AsyncSession, *, now: datetime, limit: int = 5
) -> list[ExtractJob]:
    now_u = _utc(now)
    result = await session.execute(
        select(ExtractJob)
        .where(ExtractJob.status == "pending", ExtractJob.cancel_requested.is_(False))
        .order_by(ExtractJob.created_at)
        .limit(limit)
        .with_for_update(skip_locked=True)
    )
    jobs = list(result.scalars().all())
    for job in jobs:
        job.status = "running"
        job.started_at = now_u
        job.updated_at = now_u
        job.attempts = int(job.attempts or 0) + 1
    await session.flush()
    return jobs


async def fail_stale_running(
    session: AsyncSession, *, now: datetime, deadline_sec: float
) -> int:
    now_u = _utc(now)
    cutoff = now_u - timedelta(seconds=deadline_sec)
    result = await session.execute(
        select(ExtractJob)
        .where(
            ExtractJob.status == "running",
            ExtractJob.started_at.is_not(None),
            ExtractJob.started_at < cutoff,
        )
        .with_for_update(skip_locked=True)
    )
    rows = list(result.scalars().all())
    for job in rows:
        f = failure_for("cancelled" if job.cancel_requested else "timeout")
        job.status = "cancelled" if job.cancel_requested else "error"
        job.error_code = f.code
        job.error_message = f.message
        job.error_hint = f.hint
        job.result = None
        job.finished_at = now_u
        job.updated_at = now_u
    await session.flush()
    return len(rows)


async def fail_stale_pending(
    session: AsyncSession,
    *,
    now: datetime,
    pending_ttl_sec: float,
    worker_alive: bool,
) -> int:
    """Fail pending jobs when the worker is down longer than TTL (M21)."""
    if worker_alive:
        return 0
    now_u = _utc(now)
    cutoff = now_u - timedelta(seconds=pending_ttl_sec)
    result = await session.execute(
        select(ExtractJob)
        .where(
            ExtractJob.status == "pending",
            ExtractJob.cancel_requested.is_(False),
            ExtractJob.created_at < cutoff,
        )
        .with_for_update(skip_locked=True)
    )
    rows = list(result.scalars().all())
    f = failure_for("worker_unavailable")
    for job in rows:
        job.status = "error"
        job.error_code = f.code
        job.error_message = f.message
        job.error_hint = f.hint
        job.result = None
        job.finished_at = now_u
        job.updated_at = now_u
    await session.flush()
    return len(rows)


def apply_job_ttl(
    job: ExtractJob,
    *,
    now: datetime,
    worker_alive: bool,
    pending_ttl_sec: float,
    running_deadline_sec: float,
) -> bool:
    """Mutate a single job to terminal if TTL exceeded. Returns True if changed."""
    if job.status not in _INFLIGHT:
        return False
    now_u = _utc(now)
    if job.status == "pending" and not worker_alive:
        created = _utc(job.created_at)
        if now_u - created >= timedelta(seconds=pending_ttl_sec):
            f = failure_for("worker_unavailable")
            job.status = "error"
            job.error_code = f.code
            job.error_message = f.message
            job.error_hint = f.hint
            job.result = None
            job.finished_at = now_u
            job.updated_at = now_u
            return True
    if job.status == "running" and job.started_at is not None:
        started = _utc(job.started_at)
        if now_u - started >= timedelta(seconds=running_deadline_sec):
            f = failure_for("cancelled" if job.cancel_requested else "timeout")
            job.status = "cancelled" if job.cancel_requested else "error"
            job.error_code = f.code
            job.error_message = f.message
            job.error_hint = f.hint
            job.result = None
            job.finished_at = now_u
            job.updated_at = now_u
            return True
    return False


def _mark_error(
    job: ExtractJob, exc: BaseException, *, now: datetime, step: str | None = None
) -> None:
    now_u = _utc(now)
    if isinstance(exc, AppError):
        code = exc.code if exc.code != "extract_failed" else "upstream_error"
        if code == "config_error":
            code = "missing_ai_key"
        job.status = "cancelled" if code == "cancelled" else "error"
        job.error_code = code
        job.error_message = exc.message
        job.error_hint = str((exc.extra or {}).get("hint") or failure_for(code).hint)
    elif isinstance(exc, (asyncio.TimeoutError, TimeoutError)):
        f = failure_for("timeout")
        job.status = "error"
        job.error_code = f.code
        job.error_message = f.message
        job.error_hint = f.hint
    else:
        name = type(exc).__name__
        msg = str(exc)
        # Captions stage: treat connect/DNS as YouTube unreachable (M21).
        captions_step = (step or job.step or "") == "captions"
        networkish = (
            "Connect" in name
            or "Network" in name
            or "NameResolution" in name
            or "timeout" in msg.lower()
            or "Timeout" in name
        )
        if captions_step and networkish and "Timeout" not in name and "timeout" not in msg.lower():
            f = failure_for("youtube_unreachable")
        elif "Timeout" in name or "timeout" in msg.lower():
            f = failure_for("timeout", detail=name)
        elif networkish:
            f = failure_for(
                "youtube_unreachable" if captions_step else "network", detail=name
            )
        else:
            f = failure_for("upstream_error", detail=name)
        job.status = "error"
        job.error_code = f.code
        job.error_message = f.message
        job.error_hint = f.hint
    job.result = None
    job.finished_at = now_u
    job.updated_at = now_u


class _FixedClock:
    def __init__(self, now: datetime) -> None:
        self._now = now

    def now(self) -> datetime:
        return self._now


async def process_extract_job(
    session_factory: async_sessionmaker[AsyncSession],
    job_id: uuid.UUID,
    *,
    now: datetime,
    user: User,
    settings: Settings | None = None,
    run_extract_fn: RunExtractFn | None = None,
    fetch_captions_fn: FetchCaptionsFn | None = None,
    clock: Clock | None = None,
) -> None:
    settings = settings or get_settings()
    fetch_fn = fetch_captions_fn or fetch_youtube_captions
    clock_obj: Clock = clock or _FixedClock(now)

    def default_extract(text: str, **kwargs: Any) -> ExtractOut:
        return run_text_extract(text, **kwargs)

    extract_fn = run_extract_fn or default_extract

    async with session_factory() as session:
        job = await session.get(ExtractJob, job_id)
        if job is None or job.status != "running":
            return
        if job.cancel_requested:
            _mark_error(job, AppError("cancelled", "Разбор отменён", status_code=499), now=now)
            await session.commit()
            return
        url = job.url
        video_id = job.video_id or extract_youtube_id(url)
        tz_name = job.timezone
        job.step = "captions"
        job.updated_at = _utc(now)
        await session.commit()

    try:
        async with session_factory() as session:
            cached = await get_cached_captions(
                session,
                video_id,
                now=now,
                ttl_hours=settings.youtube_caption_cache_ttl_hours,
            )
        if cached:
            text, lang = cached
            logger.info(
                "job %s cache hit video=%s caption_lang=%s chars=%s",
                job_id,
                video_id,
                lang,
                len(text),
            )
        else:
            captions_budget = (
                settings.youtube_captions_timeout_sec
                + settings.extract_retry_pause_sec * max(0, settings.extract_transient_retries)
                + 0.5
            )
            text, lang = await asyncio.wait_for(
                asyncio.to_thread(
                    lambda: fetch_fn(
                        url,
                        timeout=settings.youtube_captions_timeout_sec,
                        retries=settings.extract_transient_retries,
                        retry_pause_sec=settings.extract_retry_pause_sec,
                    )
                ),
                timeout=captions_budget,
            )
            async with session_factory() as session:
                await put_cached_captions(session, video_id, text, lang, now=now)
                await session.commit()
            from app.services.ai.lang import normalize_caption_lang

            logger.info(
                "job %s step=captions_ready video=%s youtube_track_lang=%s "
                "source_lang_from_track=%s chars=%s sample=%r",
                job_id,
                video_id,
                lang,
                normalize_caption_lang(lang),
                len(text),
                (text or "").replace("\n", " ")[:120],
            )
    except Exception as exc:  # noqa: BLE001
        async with session_factory() as session:
            job = await session.get(ExtractJob, job_id)
            if job:
                _mark_error(job, exc, now=now, step="captions")
                await session.commit()
        return

    async with session_factory() as session:
        job = await session.get(ExtractJob, job_id)
        if job is None:
            return
        if job.cancel_requested:
            _mark_error(job, AppError("cancelled", "Разбор отменён", status_code=499), now=now)
            await session.commit()
            return
        job.step = "extract"
        job.updated_at = _utc(now)
        await session.commit()

    # Model stage: one wall budget (bilingual second call shares the same wait_for).
    model_budget = settings.openrouter_timeout_sec * 2 + 5
    try:
        out = await asyncio.wait_for(
            asyncio.to_thread(
                lambda: extract_fn(
                    text,
                    user=user,
                    clock=clock_obj,
                    timezone_name=tz_name,
                    transcript=text,
                    caption_lang=lang,
                )
            ),
            timeout=model_budget,
        )
    except Exception as exc:  # noqa: BLE001
        async with session_factory() as session:
            job = await session.get(ExtractJob, job_id)
            if job:
                _mark_error(job, exc, now=now, step="extract")
                await session.commit()
        return

    async with session_factory() as session:
        job = await session.get(ExtractJob, job_id)
        if job is None:
            return
        if job.cancel_requested:
            _mark_error(job, AppError("cancelled", "Разбор отменён", status_code=499), now=now)
            await session.commit()
            return
        job.status = "done"
        job.step = "done"
        job.result = extract_out_to_dict(out)
        job.error_code = None
        job.error_message = None
        job.error_hint = None
        job.finished_at = _utc(now)
        job.updated_at = _utc(now)
        await session.commit()
        logger.info("job %s done video=%s", job_id, video_id)


async def process_due_extract_jobs(
    session_factory: async_sessionmaker[AsyncSession],
    *,
    now: datetime,
    settings: Settings | None = None,
    run_extract_fn: RunExtractFn | None = None,
    fetch_captions_fn: FetchCaptionsFn | None = None,
    limit: int = 3,
) -> int:
    settings = settings or get_settings()
    async with session_factory() as session:
        async with session.begin():
            # Pending TTL is applied by the API (GET job) when the worker is down —
            # this process is the worker, so we only close stuck running jobs here.
            stale = await fail_stale_running(
                session, now=now, deadline_sec=settings.extract_job_deadline_sec
            )
            if stale:
                logger.info("stale extract jobs closed: %s", stale)
            jobs = await claim_pending_jobs(session, now=now, limit=limit)
            claimed = [(j.id, j.user_id) for j in jobs]

    for job_id, user_id in claimed:
        async with session_factory() as session:
            user = await session.get(User, user_id)
            if user is None:
                job = await session.get(ExtractJob, job_id)
                if job:
                    _mark_error(
                        job,
                        AppError("upstream_error", "Пользователь не найден", status_code=500),
                        now=now,
                    )
                    await session.commit()
                continue
            # Access attributes while session open
            user_ref = user

        await process_extract_job(
            session_factory,
            job_id,
            now=now,
            user=user_ref,
            settings=settings,
            run_extract_fn=run_extract_fn,
            fetch_captions_fn=fetch_captions_fn,
        )
    return len(claimed)
