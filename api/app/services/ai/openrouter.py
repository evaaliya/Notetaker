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

_SYSTEM = """You turn a transcript (meeting, lecture, talk, or educational video) into structured notes as JSON only.

Language: write title/body/tag_names in the same language as the source text (Russian source → Russian notes).

summary is the main note the user will keep. summary.body MUST be multi-line Markdown-lite — never a single dense paragraph. Use real newline characters between sections:

## Главная мысль
1–3 sentences: the core thesis the speaker/author wants the audience to take away (not a list of topics, the message itself).

## Заметки
- short bullets: key facts, numbers, claims, examples, definitions
- one idea per bullet; group related points; skip filler, ads, greetings

## Выводы
- optional: takeaways, caveats, or what to remember

Formatting rules for every body field:
- Headings with ##, bullets with "- ", blank line between sections.
- Prefer clarity over completeness; compress aggressively.
- Do not wrap the whole note in one run-on sentence.

drafts[] — rare extras, not a second copy of the note:
- Lectures / talks / educational videos: drafts MUST be []. Put recommendations into summary "## Выводы". Never invent separate task notes from the speaker's advice.
- Meetings / calls only: kind=task for concrete assigned actions; kind=decision for explicit "we decided…". Do not duplicate the summary into drafts.

Timezone: interpret relative phrases (завтра, в пятницу, через N часов) in the user's timezone.
starts_at must be timezone-aware ISO-8601, or null if unknown.
If nothing useful, set summary.title and summary.body to empty strings and drafts=[].
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

_EXTRACT_SCHEMA: dict = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        # Always an object: empty title means «no summary» (strict mode dislikes anyOf/null).
        "summary": {
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
        },
        "drafts": {"type": "array", "items": _DRAFT_OBJECT},
    },
    "required": ["summary", "drafts"],
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
        payload = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": _SYSTEM},
                {
                    "role": "user",
                    "content": (
                        f"now_utc={now.astimezone(dt_timezone.utc).isoformat()}\n"
                        f"timezone={timezone}\n"
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
        try:
            with httpx.Client(timeout=60.0) as client:
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

        return _parse_payload(content, default_tz=timezone)


def _parse_payload(content: str, *, default_tz: str) -> ExtractResult:
    raw = content.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    try:
        obj = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise AppError("upstream_error", "OpenRouter вернул не-JSON", status_code=502) from exc

    summary_raw = obj.get("summary")
    summary = _draft_from_obj(summary_raw, default_tz=default_tz, kind="summary")
    if summary is not None and not summary.title.strip() and not summary.body.strip():
        summary = None
    drafts: list[DraftNote] = []
    for item in obj.get("drafts") or []:
        d = _draft_from_obj(item, default_tz=default_tz, kind=str(item.get("kind") or "task"))
        if d is not None:
            drafts.append(d)
    return ExtractResult(summary=summary, drafts=drafts)


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
