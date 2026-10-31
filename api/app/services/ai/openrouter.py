"""OpenRouter chat completions → structured drafts (M11)."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone as dt_timezone
from zoneinfo import ZoneInfo

import httpx

from app.errors import AppError
from app.services.ai.base import DraftNote, ExtractResult

_SYSTEM = """You extract meeting notes as JSON only (no markdown).
Schema:
{
  "summary": {"title": str, "body": str, "starts_at": ISO-8601|null, "reminder_offsets": [int], "tag_names": [str]} | null,
  "drafts": [{"title": str, "body": str, "starts_at": ISO-8601|null, "reminder_offsets": [int], "tag_names": [str], "kind": "task"|"decision"}]
}
Use the user's timezone for relative phrases. starts_at must be timezone-aware ISO-8601.
If nothing useful, return {"summary": null, "drafts": []}.
"""


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
            "response_format": {"type": "json_object"},
        }
        try:
            with httpx.Client(timeout=60.0) as client:
                res = client.post(
                    "https://openrouter.ai/api/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self._api_key}",
                        "Content-Type": "application/json",
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

    summary = _draft_from_obj(obj.get("summary"), default_tz=default_tz, kind="summary")
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
