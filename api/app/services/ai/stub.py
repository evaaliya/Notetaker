"""Deterministic extract without network or model weights (M11)."""

from __future__ import annotations

import re
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from app.services.ai.base import DraftNote, ExtractResult

_WEEKDAYS_RU = {
    "понедельник": 0,
    "вторник": 1,
    "среду": 2,
    "среды": 2,
    "среда": 2,
    "четверг": 3,
    "пятницу": 4,
    "пятницы": 4,
    "пятница": 4,
    "субботу": 5,
    "суббота": 5,
    "воскресенье": 6,
}

_TIME_HM = re.compile(
    r"(?:в\s+)?(\d{1,2})[:\.](\d{2})(?:\s*(?:часов|ч\.?))?",
    re.IGNORECASE,
)
_TOMORROW = re.compile(r"\bзавтра\b", re.IGNORECASE)
_IN_HOURS = re.compile(r"через\s+(\d+)\s*(час(?:а|ов)?|ч\.?)", re.IGNORECASE)
_IN_MINUTES = re.compile(r"через\s+(\d+)\s*(минут(?:у|ы)?|мин\.?)", re.IGNORECASE)
_WEEKDAY = re.compile(
    r"\bв\s+(" + "|".join(_WEEKDAYS_RU.keys()) + r")\b",
    re.IGNORECASE,
)
_TASK = re.compile(
    r"(?:^|\n)\s*(?:задача|todo|action)\s*[:\-–]\s*(.+)",
    re.IGNORECASE,
)
_NEED_TO = re.compile(
    r"(?:нужно|надо|необходимо)\s+([^.!?\n]{3,120})",
    re.IGNORECASE,
)
_DECISION = re.compile(
    r"(?:решили|решение)\s*[:\-–]?\s*([^.!?\n]{3,160})",
    re.IGNORECASE,
)
_PARTICIPANTS = re.compile(
    r"(?:участники|участник(?:и|ов)?)\s*[:\-–]\s*([^\n]+)",
    re.IGNORECASE,
)
_SPEAKER_LINE = re.compile(r"^\[?\d{1,2}:\d{2}(?::\d{2})?\]?\s*([^:\n]{1,40})\s*:", re.MULTILINE)


class StubProvider:
    """Rule-based RU phrases; same input → same drafts."""

    def extract(self, text: str, *, now: datetime, timezone: str) -> ExtractResult:
        raw = (text or "").strip()
        if not raw:
            return ExtractResult(summary=None, drafts=[])

        tz = ZoneInfo(timezone)
        local_now = now.astimezone(tz)

        starts = _infer_starts_at(raw, local_now)
        drafts: list[DraftNote] = []

        for m in _TASK.finditer(raw):
            phrase = m.group(1).strip().rstrip(".")
            drafts.append(
                DraftNote(
                    title=_short_title(phrase),
                    body=phrase,
                    starts_at=starts,
                    reminder_offsets=[10] if starts else [],
                    tag_names=["задача"],
                    kind="task",
                )
            )

        for m in _NEED_TO.finditer(raw):
            phrase = m.group(1).strip().rstrip(".")
            if any(phrase.lower() in d.body.lower() for d in drafts):
                continue
            drafts.append(
                DraftNote(
                    title=_short_title(phrase),
                    body=f"Нужно {phrase}",
                    starts_at=starts,
                    reminder_offsets=[10] if starts else [],
                    tag_names=["задача"],
                    kind="task",
                )
            )

        for m in _DECISION.finditer(raw):
            phrase = m.group(1).strip().rstrip(".")
            drafts.append(
                DraftNote(
                    title=f"Решение: {_short_title(phrase)}",
                    body=phrase,
                    starts_at=starts,
                    reminder_offsets=[],
                    tag_names=["решение"],
                    kind="decision",
                )
            )

        # Bare scheduling sentence without explicit task/decision markers.
        if not drafts and starts is not None:
            drafts.append(
                DraftNote(
                    title=_short_title(raw.split("\n")[0]),
                    body=raw[:500],
                    starts_at=starts,
                    reminder_offsets=[10],
                    tag_names=[],
                    kind="task",
                )
            )

        summary = _build_summary(raw, starts, drafts)
        return ExtractResult(summary=summary, drafts=drafts)


def _infer_starts_at(text: str, local_now: datetime) -> datetime | None:
    tz = local_now.tzinfo
    assert tz is not None

    m_h = _IN_HOURS.search(text)
    if m_h:
        hours = int(m_h.group(1))
        return (local_now + timedelta(hours=hours)).astimezone(tz)

    m_m = _IN_MINUTES.search(text)
    if m_m:
        mins = int(m_m.group(1))
        return (local_now + timedelta(minutes=mins)).astimezone(tz)

    hour, minute = 9, 0
    m_t = _TIME_HM.search(text)
    if m_t:
        hour = int(m_t.group(1))
        minute = int(m_t.group(2))
        if hour > 23 or minute > 59:
            hour, minute = 9, 0

    if _TOMORROW.search(text):
        day = (local_now + timedelta(days=1)).date()
        return datetime(day.year, day.month, day.day, hour, minute, tzinfo=tz)

    m_w = _WEEKDAY.search(text)
    if m_w:
        target = _WEEKDAYS_RU[m_w.group(1).lower()]
        days_ahead = (target - local_now.weekday()) % 7
        if days_ahead == 0:
            days_ahead = 7
        day = (local_now + timedelta(days=days_ahead)).date()
        return datetime(day.year, day.month, day.day, hour, minute, tzinfo=tz)

    if m_t:
        day = local_now.date()
        candidate = datetime(day.year, day.month, day.day, hour, minute, tzinfo=tz)
        if candidate <= local_now:
            candidate = candidate + timedelta(days=1)
        return candidate

    return None


def _build_summary(text: str, starts: datetime | None, drafts: list[DraftNote]) -> DraftNote:
    participants = _extract_participants(text)
    decisions = [d.body for d in drafts if d.kind == "decision"]
    tasks = [d.body for d in drafts if d.kind == "task"]
    # Structured stub layout (mirrors OpenRouter prompt): thesis + bullets, not a wall of text.
    thesis = _first_sentence(text) or "Краткий конспект по транскрипту."
    note_bullets: list[str] = []
    if participants:
        note_bullets.append(f"Участники: {', '.join(participants)}")
    if starts is not None:
        note_bullets.append(f"Время: {starts.isoformat()}")
    for d in decisions:
        note_bullets.append(d)
    if not note_bullets:
        for chunk in _snippet_bullets(text, limit=5):
            note_bullets.append(chunk)

    sections = [
        "## Главная мысль",
        thesis,
        "",
        "## Заметки",
        *[f"- {b}" for b in note_bullets],
    ]
    if tasks or decisions:
        sections.extend(["", "## Выводы"])
        for d in decisions:
            sections.append(f"- Решение: {d}")
        for t in tasks:
            sections.append(f"- Задача: {t}")

    title = "Конспект"
    first = text.strip().split("\n")[0].strip()
    if first and len(first) < 80 and not first.lower().startswith("webvtt"):
        title = f"Конспект: {_short_title(first)}"

    return DraftNote(
        title=title,
        body="\n".join(sections).strip(),
        starts_at=starts,
        reminder_offsets=[],
        tag_names=["звонок"] if participants or decisions else ["конспект"],
        kind="summary",
    )


def _first_sentence(text: str) -> str:
    cleaned = re.sub(r"\s+", " ", (text or "").strip())
    if not cleaned:
        return ""
    m = re.search(r"^(.+?[.!?…])(?:\s|$)", cleaned)
    if m and len(m.group(1)) <= 220:
        return m.group(1).strip()
    return cleaned[:180].rstrip() + ("…" if len(cleaned) > 180 else "")


def _snippet_bullets(text: str, *, limit: int = 5) -> list[str]:
    cleaned = re.sub(r"\s+", " ", (text or "").strip())
    if not cleaned:
        return []
    parts = re.split(r"(?<=[.!?…])\s+", cleaned)
    out: list[str] = []
    for p in parts:
        p = p.strip()
        if len(p) < 12:
            continue
        out.append(p[:160] + ("…" if len(p) > 160 else ""))
        if len(out) >= limit:
            break
    if not out and cleaned:
        out.append(cleaned[:200] + ("…" if len(cleaned) > 200 else ""))
    return out


def _extract_participants(text: str) -> list[str]:
    found: list[str] = []
    m = _PARTICIPANTS.search(text)
    if m:
        found.extend(p.strip() for p in re.split(r"[,;]", m.group(1)) if p.strip())
    for m in _SPEAKER_LINE.finditer(text):
        name = m.group(1).strip()
        if name and name not in found and len(name) < 40:
            found.append(name)
    return found[:12]


def _short_title(phrase: str, limit: int = 72) -> str:
    clean = re.sub(r"\s+", " ", phrase).strip()
    if len(clean) <= limit:
        return clean or "Черновик"
    return clean[: limit - 1].rstrip() + "…"
