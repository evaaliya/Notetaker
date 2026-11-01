"""Shared sync extract runner used by HTTP and background jobs."""

from __future__ import annotations

from datetime import timezone

from app.config import get_settings
from app.errors import AppError
from app.models import User
from app.schemas.extract import DraftOut, ExtractOut
from app.services.ai import DraftNote, get_provider
from app.clock import Clock


def draft_out(d: DraftNote) -> DraftOut:
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


def run_text_extract(
    text: str,
    *,
    user: User,
    clock: Clock,
    timezone_name: str | None,
    transcript: str | None = None,
) -> ExtractOut:
    tz = timezone_name or user.timezone or "UTC"
    provider_name = (get_settings().ai_provider or "stub").strip().lower()
    try:
        provider = get_provider()
        result = provider.extract(text, now=clock.now(), timezone=tz)
    except AppError:
        raise
    except ValueError as exc:
        raise AppError("config_error", str(exc), status_code=503) from exc
    except Exception as exc:  # noqa: BLE001
        raise AppError("extract_failed", str(exc), status_code=502) from exc

    lang = (result.source_lang or "").strip().lower() or None
    if lang not in ("en", "ru", "other"):
        lang = None
    summary_ru = result.summary_ru
    if summary_ru is not None and not summary_ru.title.strip() and not summary_ru.body.strip():
        summary_ru = None
    return ExtractOut(
        summary=draft_out(result.summary) if result.summary else None,
        drafts=[draft_out(d) for d in result.drafts],
        provider=provider_name,
        transcript=transcript,
        source_lang=lang,  # type: ignore[arg-type]
        summary_ru=draft_out(summary_ru) if summary_ru else None,
    )
