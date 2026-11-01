"""OpenRouter chat completions → structured drafts (M11).

Aligned with current OpenRouter docs:
- POST /api/v1/chat/completions
- response_format json_schema (strict) + response-healing plugin
- HTTP-Referer / X-OpenRouter-Title for app attribution
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone as dt_timezone
from zoneinfo import ZoneInfo

import httpx

from app.errors import AppError
from app.services.ai.base import DraftNote, ExtractResult
from app.services.ai.bilingual import ensure_en_pair
from app.services.ai.lang import detect_lang

_SYSTEM = """You turn a transcript (meeting, lecture, talk, or educational video) into structured notes as JSON only.

source_lang: set to "en", "ru", or "other" for the dominant language of the transcript.

summary is the main note in the SOURCE language (keep English if the talk is English — do not translate summary itself).
summary.body MUST be multi-line Markdown-lite with real newlines — never one dense paragraph.

If source_lang is "ru", use headings:
## Главная мысль
## Заметки
## Выводы

If source_lang is "en" (or other non-Russian), use headings:
## Main idea
## Notes
## Takeaways

Content rules for summary:
- Main idea / Главная мысль: 1–3 sentences — the thesis the speaker wants the audience to take away.
- Notes / Заметки: short bullets (facts, numbers, claims, examples); one idea per bullet; skip filler.
- Takeaways / Выводы: optional.
- Prefer clarity over completeness; compress aggressively.

summary_ru: same shape as summary.
- If source_lang is "en": fill with a careful Russian translation of summary (use Russian headings Главная мысль / Заметки / Выводы). Keep names, numbers, and key terms accurate; do not invent facts.
- If source_lang is "ru" or "other": set summary_ru.title and summary_ru.body to empty strings.

drafts[] — rare extras, not a second copy of the note:
- Lectures / talks / educational videos: drafts MUST be []. Put recommendations into summary Takeaways/Выводы. Never invent separate task notes from the speaker's advice.
- Meetings / calls only: kind=task for concrete assigned actions; kind=decision for explicit decisions. Do not duplicate the summary into drafts.
- Draft bodies stay in the source language (no separate RU copies for tasks).

Timezone: interpret relative phrases in the user's timezone.
starts_at must be timezone-aware ISO-8601, or null if unknown.
If nothing useful, set summary.title and summary.body to empty strings, summary_ru empty, drafts=[], source_lang as detected.
"""

# JSON Schema for OpenRouter structured outputs (strict).
_DRAFT_OBJECT: dict = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "title": {"type": "string"},
        "body": {"type": "string"},
        "starts_at": {"type": ["string", "null"]},
        "reminder_offsets": {"type": "array", "items": {"type": "integer"}},
        "tag_names": {"type": "array", "items": {"type": "string"}},
        "kind": {"type": "string", "enum": ["summary", "task", "decision"]},
    },
    "required": ["title", "body", "starts_at", "reminder_offsets", "tag_names", "kind"],
}

_SUMMARY_OBJECT: dict = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "title": {"type": "string"},
        "body": {"type": "string"},
        "starts_at": {"type": ["string", "null"]},
        "reminder_offsets": {"type": "array", "items": {"type": "integer"}},
        "tag_names": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["title", "body", "starts_at", "reminder_offsets", "tag_names"],
}

_EXTRACT_SCHEMA: dict = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "source_lang": {"type": "string", "enum": ["en", "ru", "other"]},
        # Always an object: empty title means «no summary» (strict mode dislikes anyOf/null).
        "summary": _SUMMARY_OBJECT,
        "summary_ru": _SUMMARY_OBJECT,
        "drafts": {"type": "array", "items": _DRAFT_OBJECT},
    },
    "required": ["source_lang", "summary", "summary_ru", "drafts"],
}


class OpenRouterProvider:
    def __init__(self, *, api_key: str, model: str) -> None:
        self._api_key = api_key
        self._model = model

    def extract(self, text: str, *, now: datetime, timezone: str) -> ExtractResult:
        if not self._api_key:
            raise AppError(
                "config_error",
                "OPENROUTER_API_KEY не задан (AI_PROVIDER=openrouter)",
                status_code=503,
            )
        detected = detect_lang(text)
        lang_hint = ""
        if detected == "en":
            lang_hint = (
                "detected_source_lang=en. "
                "You MUST set source_lang=en. Write summary in English (Main idea / Notes / Takeaways). "
                "You MUST fill summary_ru with a full Russian translation (Главная мысль / Заметки / Выводы). "
                "Do not put Russian into summary.\n"
            )
        elif detected == "ru":
            lang_hint = (
                "detected_source_lang=ru. Set source_lang=ru. "
                "Write summary in Russian. Leave summary_ru title and body empty.\n"
            )
        payload = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": _SYSTEM},
                {
                    "role": "user",
                    "content": (
                        f"now_utc={now.astimezone(dt_timezone.utc).isoformat()}\n"
                        f"timezone={timezone}\n"
                        f"{lang_hint}"
                        f"text:\n{text}"
                    ),
                },
            ],
            "temperature": 0,
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "extract_notes",
                    "strict": True,
                    "schema": _EXTRACT_SCHEMA,
                },
            },
            # Heal imperfect JSON (important for free/:free endpoints).
            "plugins": [{"id": "response-healing"}],
            # Do not require_parameters: free pool often omits structured_outputs flags.
        }
        content = self._chat(payload)
        result = _parse_payload(content, default_tz=timezone)
        return ensure_en_pair(result, transcript=text, translate=self.translate_summary)

    def translate_summary(self, note: DraftNote, target: str) -> DraftNote:
        """Translate a summary note to en or ru (second call when the first omit a twin)."""
        if target not in ("en", "ru"):
            raise ValueError(f"unsupported target {target}")
        if target == "ru":
            instruction = (
                "Translate this note into Russian. Keep Markdown structure. "
                "Use headings ## Главная мысль, ## Заметки, ## Выводы. "
                "Return JSON with title and body only."
            )
        else:
            instruction = (
                "Translate this note into English. Keep Markdown structure. "
                "Use headings ## Main idea, ## Notes, ## Takeaways. "
                "Return JSON with title and body only."
            )
        schema = {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "title": {"type": "string"},
                "body": {"type": "string"},
            },
            "required": ["title", "body"],
        }
        payload = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": instruction},
                {
                    "role": "user",
                    "content": json.dumps(
                        {"title": note.title, "body": note.body},
                        ensure_ascii=False,
                    ),
                },
            ],
            "temperature": 0,
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "translate_summary",
                    "strict": True,
                    "schema": schema,
                },
            },
            "plugins": [{"id": "response-healing"}],
        }
        content = self._chat(payload)
        raw = content.strip()
        if raw.startswith("```"):
            raw = re.sub(r"^```(?:json)?\s*", "", raw)
            raw = re.sub(r"\s*```$", "", raw)
        try:
            obj = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise AppError("upstream_error", "OpenRouter translate вернул не-JSON", status_code=502) from exc
        title = str(obj.get("title") or "").strip() or note.title
        body = str(obj.get("body") or "").strip() or note.body
        return DraftNote(
            title=title,
            body=body,
            starts_at=note.starts_at,
            reminder_offsets=list(note.reminder_offsets),
            tag_names=list(note.tag_names),
            kind="summary",
        )

    def _chat(self, payload: dict) -> str:
        try:
            with httpx.Client(timeout=90.0) as client:
                res = client.post(
                    "https://openrouter.ai/api/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self._api_key}",
                        "Content-Type": "application/json",
                        "HTTP-Referer": "http://localhost:5173",
                        "X-OpenRouter-Title": "Notetaker",
                    },
                    json=payload,
                )
        except httpx.HTTPError as exc:
            raise AppError("upstream_error", f"OpenRouter недоступен: {exc}", status_code=502) from exc

        if res.status_code >= 400:
            raise AppError(
                "upstream_error",
                f"OpenRouter HTTP {res.status_code}: {res.text[:300]}",
                status_code=502,
            )

        data = res.json()
        try:
            content = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise AppError("upstream_error", "Неожиданный ответ OpenRouter", status_code=502) from exc

        if not isinstance(content, str) or not content.strip():
            raise AppError("upstream_error", "Пустой ответ OpenRouter", status_code=502)
        return content


def _parse_payload(content: str, *, default_tz: str) -> ExtractResult:
    raw = content.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    try:
        obj = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise AppError("upstream_error", "OpenRouter вернул не-JSON", status_code=502) from exc

    source_lang = str(obj.get("source_lang") or "other").strip().lower()
    if source_lang not in ("en", "ru", "other"):
        source_lang = "other"

    summary_raw = obj.get("summary")
    summary = _draft_from_obj(summary_raw, default_tz=default_tz, kind="summary")
    if summary is not None and not summary.title.strip() and not summary.body.strip():
        summary = None

    summary_ru = _draft_from_obj(obj.get("summary_ru"), default_tz=default_tz, kind="summary")
    if summary_ru is not None and not summary_ru.title.strip() and not summary_ru.body.strip():
        summary_ru = None
    # Keep summary_ru for ensure_en_pair (it drops the twin when transcript is not English).

    drafts: list[DraftNote] = []
    for item in obj.get("drafts") or []:
        d = _draft_from_obj(item, default_tz=default_tz, kind=str(item.get("kind") or "task"))
        if d is not None:
            drafts.append(d)
    return ExtractResult(
        summary=summary,
        drafts=drafts,
        source_lang=source_lang,
        summary_ru=summary_ru,
    )


def _draft_from_obj(obj: object, *, default_tz: str, kind: str) -> DraftNote | None:
    if not isinstance(obj, dict):
        return None
    title = str(obj.get("title") or "").strip() or "Черновик"
    body = str(obj.get("body") or "").strip()
    starts = _parse_dt(obj.get("starts_at"), default_tz=default_tz)
    offsets = obj.get("reminder_offsets") or []
    if not isinstance(offsets, list):
        offsets = []
    tags = obj.get("tag_names") or []
    if not isinstance(tags, list):
        tags = []
    return DraftNote(
        title=title,
        body=body,
        starts_at=starts,
        reminder_offsets=[int(x) for x in offsets if str(x).lstrip("-").isdigit()],
        tag_names=[str(t) for t in tags if str(t).strip()],
        kind=kind,
    )


def _parse_dt(value: object, *, default_tz: str) -> datetime | None:
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        return None
    s = value.strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=ZoneInfo(default_tz))
    return dt.astimezone(dt_timezone.utc)
