"""M11: stub extract phrases, API, vtt/srt parsers."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from httpx import AsyncClient

from app.clock import FrozenClock
from app.main import app
from app.services.ai.stub import StubProvider
from app.services.transcripts import parse_srt, parse_vtt


NOW = datetime(2026, 10, 31, 12, 0, 0, tzinfo=timezone.utc)  # Saturday
TZ = "Asia/Bishkek"


def _stub(text: str):
    return StubProvider().extract(text, now=NOW, timezone=TZ)


def test_stub_phrase_tomorrow_1500():
    r = _stub("Встреча завтра в 15:00 обсудим релиз")
    assert r.drafts, "ожидали черновик по «завтра в 15:00»"
    starts = r.drafts[0].starts_at
    assert starts is not None
    local = starts.astimezone(ZoneInfo(TZ))
    assert local.date().isoformat() == "2026-11-01"
    assert local.hour == 15 and local.minute == 0


def test_stub_phrase_friday():
    r = _stub("Созвон в пятницу по бюджету")
    assert r.drafts
    starts = r.drafts[0].starts_at
    assert starts is not None
    local = starts.astimezone(ZoneInfo(TZ))
    # next Friday after Sat 31 Oct → 6 Nov
    assert local.weekday() == 4
    assert local.date().isoformat() == "2026-11-06"


def test_stub_phrase_in_two_hours():
    r = _stub("Напомни через 2 часа проверить отчёт")
    assert r.drafts
    starts = r.drafts[0].starts_at
    assert starts is not None
    expected = NOW.astimezone(ZoneInfo(TZ)) + timedelta(hours=2)
    assert starts == expected


def test_stub_phrase_task():
    r = _stub("Задача: подготовить презентацию к понедельнику")
    assert any(d.kind == "task" and "презентац" in d.body.lower() for d in r.drafts)
    assert any("задача" in d.tag_names for d in r.drafts)


def test_stub_phrase_decision():
    r = _stub("Решили: запускаем фичу в пятницу")
    assert any(d.kind == "decision" for d in r.drafts)
    assert r.summary is not None
    assert "Решени" in r.summary.body or "запускаем" in r.summary.body.lower()
    assert "## Главная мысль" in r.summary.body
    assert "## Заметки" in r.summary.body
    assert "\n" in r.summary.body
    assert r.source_lang == "ru"
    assert r.summary_ru is None


def test_stub_english_offers_summary_ru():
    r = _stub(
        "A lifelong Democrat explains why she voted Trump. Friends reacted with surprise."
    )
    assert r.source_lang == "en"
    assert r.summary is not None
    assert "## Main idea" in r.summary.body
    assert r.summary_ru is not None
    assert "## Главная мысль" in r.summary_ru.body


def test_ensure_en_pair_recovers_when_model_forgot_ru():
    from app.services.ai.base import DraftNote, ExtractResult
    from app.services.ai.bilingual import ensure_en_pair, stub_translate

    summary = DraftNote(
        title="Grant on academia",
        body="## Main idea\nIndustry hire paths differ.\n\n## Notes\n- PhD is optional",
        kind="summary",
    )
    result = ExtractResult(summary=summary, drafts=[], source_lang="other", summary_ru=None)
    fixed = ensure_en_pair(
        result,
        transcript="Grant is a recruiter. Academia versus industry careers after a PhD.",
        translate=stub_translate,
    )
    assert fixed.source_lang == "en"
    assert fixed.summary_ru is not None
    assert "[RU]" in fixed.summary_ru.title or "Главная" in fixed.summary_ru.body


def test_ensure_en_pair_when_summary_was_russian():
    from app.services.ai.base import DraftNote, ExtractResult
    from app.services.ai.bilingual import ensure_en_pair, stub_translate

    summary = DraftNote(
        title="Интервью с Грантом",
        body="## Главная мысль\nПереход из академии в индустрию.\n\n## Заметки\n- PhD не обязателен",
        kind="summary",
    )
    result = ExtractResult(summary=summary, drafts=[], source_lang="ru", summary_ru=None)
    fixed = ensure_en_pair(
        result,
        transcript="Grant is a recruiter with thirty years. Academia versus industry after a PhD.",
        translate=stub_translate,
    )
    assert fixed.source_lang == "en"
    assert fixed.summary is not None
    assert fixed.summary_ru is not None
    assert "## Main idea" in fixed.summary.body or "Main idea" in fixed.summary.body


def test_parse_vtt():
    raw = """WEBVTT

00:00:01.000 --> 00:00:04.000
Alice: Привет всем

00:00:05.000 --> 00:00:08.000
Bob: Решили: берём вариант A
"""
    text = parse_vtt(raw)
    assert "Alice: Привет всем" in text
    assert "Bob: Решили: берём вариант A" in text
    assert "-->" not in text
    assert "WEBVTT" not in text


def test_parse_srt():
    raw = """1
00:00:01,000 --> 00:00:04,000
Участники: Аня, Боря

2
00:00:05,000 --> 00:00:09,000
Задача: отправить протокол
"""
    text = parse_srt(raw)
    assert "Участники: Аня, Боря" in text
    assert "Задача: отправить протокол" in text
    assert "-->" not in text


@pytest.mark.asyncio
async def test_extract_api(client: AsyncClient):
    app.state.clock = FrozenClock(NOW)
    login = f"m11_{datetime.now(timezone.utc).timestamp():.0f}"
    reg = await client.post(
        "/api/auth/register", json={"login": login, "password": "secret", "timezone": TZ}
    )
    assert reg.status_code in (200, 201), reg.text

    res = await client.post(
        "/api/extract",
        json={"text": "Задача: купить молоко завтра в 10:00", "timezone": TZ},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["provider"] == "stub"
    assert body["summary"] is not None
    assert any("молоко" in d["body"].lower() or "молоко" in d["title"].lower() for d in body["drafts"])
    assert any(d.get("starts_at") for d in body["drafts"])

    # Create confirmed draft with AI mark.
    draft = body["drafts"][0]
    create = await client.post(
        "/api/notes",
        json={
            "title": draft["title"],
            "body": draft["body"],
            "starts_at": draft["starts_at"] or NOW.isoformat().replace("+00:00", "Z"),
            "reminder_offsets": draft.get("reminder_offsets") or [],
            "source": "call",
            "ai_generated": True,
        },
    )
    assert create.status_code == 201, create.text
    note = create.json()
    assert note["source"] == "call"
    assert note["ai_generated"] is True


@pytest.mark.asyncio
async def test_extract_transcript_vtt_upload(client: AsyncClient):
    app.state.clock = FrozenClock(NOW)
    login = f"m11vtt_{datetime.now(timezone.utc).timestamp():.0f}"
    await client.post(
        "/api/auth/register", json={"login": login, "password": "secret", "timezone": TZ}
    )
    content = (
        "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n"
        "Задача: проверить биллинг завтра в 15:00\n"
    ).encode()
    res = await client.post(
        "/api/extract/transcript",
        files={"file": ("meeting.vtt", content, "text/vtt")},
        data={"timezone": TZ},
    )
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["drafts"] or data["summary"]


def test_youtube_captions_xml_to_text():
    from app.services.youtube_captions import captions_xml_to_text, extract_youtube_id

    assert extract_youtube_id("https://youtu.be/ME2C-X6fDrc") == "ME2C-X6fDrc"
    assert extract_youtube_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    xml = """<?xml version="1.0" encoding="utf-8"?>
<transcript>
  <text start="0" dur="1">Задача: купить молоко</text>
  <text start="1" dur="1">Решили: встреча завтра в 15:00</text>
</transcript>"""
    text = captions_xml_to_text(xml)
    assert "молоко" in text
    assert "15:00" in text


@pytest.mark.asyncio
async def test_extract_youtube_uses_captions(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    app.state.clock = FrozenClock(NOW)
    login = f"m11yt_{datetime.now(timezone.utc).timestamp():.0f}"
    await client.post(
        "/api/auth/register", json={"login": login, "password": "secret", "timezone": TZ}
    )

    def fake_fetch(url: str, **_kwargs):
        return (
            "Участники: Аня. Задача: подготовить конспект завтра в 15:00. Решили: публикуем.",
            "ru/manual",
        )

    monkeypatch.setattr(
        "app.routers.extract.fetch_youtube_captions",
        fake_fetch,
    )
    res = await client.post(
        "/api/extract/youtube",
        json={"url": "https://youtu.be/dQw4w9WgXcQ", "timezone": TZ},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["transcript"]
    assert body["drafts"] or body["summary"]
