"""Ensure English transcripts always expose EN + RU summary for UI choice (D-073 / caption-lang)."""

from __future__ import annotations

from collections.abc import Callable

from app.services.ai.base import DraftNote, ExtractResult
from app.services.ai.lang import is_mostly_cyrillic, resolve_source_lang

TranslateFn = Callable[[DraftNote, str], DraftNote]  # (note, target_lang) -> note


def _has_text(note: DraftNote | None) -> bool:
    return bool(note and (note.title.strip() or note.body.strip()))


def ensure_en_pair(
    result: ExtractResult,
    *,
    transcript: str,
    translate: TranslateFn | None = None,
    caption_lang: str | None = None,
) -> ExtractResult:
    """Force bilingual pair when the **caption track** language is English.

    ``caption_lang`` is YouTube track languageCode (e.g. ``en/asr``). Letter heuristics
    apply only when that code is unknown — never override a known track language.
    ``defaultAudioLanguage`` must not be passed here (preference only at track pick).
    """
    detected = resolve_source_lang(caption_lang=caption_lang, transcript=transcript)
    summary = result.summary
    summary_ru = result.summary_ru
    drafts = list(result.drafts)
    do_translate = translate or stub_translate

    if detected == "ru":
        return ExtractResult(
            summary=summary,
            drafts=drafts,
            source_lang="ru",
            summary_ru=None,
        )

    if detected != "en":
        return ExtractResult(
            summary=summary,
            drafts=drafts,
            source_lang=result.source_lang or detected,
            summary_ru=None,
        )

    if not _has_text(summary):
        return ExtractResult(
            summary=None,
            drafts=drafts,
            source_lang="en",
            summary_ru=None,
        )

    assert summary is not None
    summary_text = f"{summary.title}\n{summary.body}"

    if is_mostly_cyrillic(summary_text):
        # Model wrote Russian into summary — keep as RU, recover English.
        if not _has_text(summary_ru):
            summary_ru = summary
        assert summary_ru is not None
        try:
            summary = do_translate(summary_ru, "en")
        except Exception:  # noqa: BLE001
            summary = stub_translate(summary_ru, "en")
    elif not _has_text(summary_ru):
        try:
            summary_ru = do_translate(summary, "ru")
        except Exception:  # noqa: BLE001
            summary_ru = _fallback_ru(summary)

    if not _has_text(summary_ru):
        summary_ru = None

    return ExtractResult(
        summary=summary,
        drafts=drafts,
        source_lang="en",
        summary_ru=summary_ru,
    )


def _fallback_ru(summary: DraftNote) -> DraftNote:
    return DraftNote(
        title=f"[RU] {summary.title}",
        body=(
            "## Главная мысль\n"
            "(перевод недоступен — показан оригинал)\n\n"
            f"{summary.body}"
        ),
        starts_at=summary.starts_at,
        reminder_offsets=list(summary.reminder_offsets),
        tag_names=list(summary.tag_names),
        kind="summary",
    )


def stub_translate(note: DraftNote, target: str) -> DraftNote:
    """Deterministic stand-in for tests / stub provider."""
    if target == "ru":
        return DraftNote(
            title=f"[RU] {note.title}",
            body=(
                "## Главная мысль\n"
                "(stub) Русская версия конспекта для выбора языка.\n\n"
                "## Заметки\n"
                f"- Оригинал: {note.title}"
            ),
            starts_at=note.starts_at,
            reminder_offsets=list(note.reminder_offsets),
            tag_names=list(note.tag_names),
            kind="summary",
        )
    title = note.title
    if title.startswith("[RU] "):
        title = title[5:]
    body = note.body
    body = body.replace("## Главная мысль", "## Main idea")
    body = body.replace("## Заметки", "## Notes")
    body = body.replace("## Выводы", "## Takeaways")
    if "## Main idea" not in body:
        body = f"## Main idea\n{body}"
    return DraftNote(
        title=title or "Notes",
        body=body,
        starts_at=note.starts_at,
        reminder_offsets=list(note.reminder_offsets),
        tag_names=list(note.tag_names),
        kind="summary",
    )
