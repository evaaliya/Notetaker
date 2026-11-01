"""M12: YouTube captions — unit parse + API with mocked fetch (no real YouTube)."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest
from httpx import AsyncClient

from app.clock import FrozenClock
from app.errors import AppError
from app.main import app
from app.services.youtube_captions import captions_xml_to_text, extract_youtube_id


FIXTURES = Path(__file__).parent / "fixtures" / "youtube"
NOW = datetime(2026, 10, 31, 12, 0, 0, tzinfo=timezone.utc)
TZ = "Asia/Bishkek"
EN_CAPTIONS = (
    "A lifelong Democrat explains why she voted. "
    "Friends reacted with surprise. "
    "Party identity shifted over decades."
)
RU_CAPTIONS = (
    "Участники: Аня и Боря. "
    "Задача: подготовить конспект завтра в 15:00. "
    "Решили: публикуем в пятницу."
)


def _load(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


# --- unit: URL / id ---


def test_youtube_extract_id_watch_url():
    assert extract_youtube_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ") == "dQw4w9WgXcQ"


def test_youtube_extract_id_youtu_be_with_params():
    assert (
        extract_youtube_id("https://youtu.be/ME2C-X6fDrc?si=abc&t=12") == "ME2C-X6fDrc"
    )


def test_youtube_extract_id_shorts_and_embed():
    assert extract_youtube_id("https://www.youtube.com/shorts/abcdefghijk") == "abcdefghijk"
    assert extract_youtube_id("https://www.youtube.com/embed/dQw4w9WgXcQ") == "dQw4w9WgXcQ"


def test_youtube_extract_id_bare_and_mobile():
    assert extract_youtube_id("dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert extract_youtube_id("https://m.youtube.com/watch?v=dQw4w9WgXcQ") == "dQw4w9WgXcQ"


def test_youtube_extract_id_invalid():
    with pytest.raises(AppError) as exc:
        extract_youtube_id("https://example.com/watch?v=abc")
    assert exc.value.code == "validation_error"
    assert "YouTube" in exc.value.message

    with pytest.raises(AppError) as exc2:
        extract_youtube_id("https://www.youtube.com/watch?v=")
    assert exc2.value.code == "validation_error"


# --- unit: captions body ---


def test_youtube_captions_manual_en_xml():
    text = captions_xml_to_text(_load("manual_en.xml"))
    assert "lifelong Democrat" in text
    assert "party identity" in text.lower() or "Party identity" in text


def test_youtube_captions_asr_ru_xml():
    text = captions_xml_to_text(_load("asr_ru.xml"))
    assert "Автоматические субтитры" in text
    assert "пятницу" in text


def test_youtube_captions_empty_xml():
    assert captions_xml_to_text(_load("empty.xml")) == ""
    assert captions_xml_to_text("") == ""
    assert captions_xml_to_text("   ") == ""


def test_youtube_captions_corrupt_and_json3():
    # Non-XML/JSON still yields stripped text (no crash).
    broken = captions_xml_to_text(_load("corrupt.txt"))
    assert "broken captions" in broken
    json3 = captions_xml_to_text(_load("json3_en.json"))
    assert "Hello from JSON3" in json3
    assert "Second line" in json3


# --- API (real Postgres, mocked YouTube fetch) ---


async def _register(client: AsyncClient, login: str) -> None:
    app.state.clock = FrozenClock(NOW)
    reg = await client.post(
        "/api/auth/register", json={"login": login, "password": "secret", "timezone": TZ}
    )
    assert reg.status_code in (200, 201), reg.text


@pytest.mark.asyncio
async def test_youtube_api_create_note_from_captions(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
):
    login = f"yt_ok_{datetime.now(timezone.utc).timestamp():.0f}"
    await _register(client, login)

    async def fake_captions(session, url, *, clock):
        assert "youtu" in url
        return RU_CAPTIONS, "ru/manual"

    monkeypatch.setattr("app.routers.extract._captions_with_cache", fake_captions)
    res = await client.post(
        "/api/extract/youtube",
        json={"url": "https://youtu.be/dQw4w9WgXcQ", "timezone": TZ},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["transcript"]
    assert body["summary"] is not None
    assert body.get("summary_ru") in (None, {}) or not (
        (body.get("summary_ru") or {}).get("title") or ""
    ).strip()
    # RU source → no bilingual twin (or empty).
    summary_ru = body.get("summary_ru")
    assert summary_ru is None or not (
        (summary_ru.get("title") or "").strip() or (summary_ru.get("body") or "").strip()
    )
    assert body["source_lang"] == "ru"

    draft = body["summary"]
    create = await client.post(
        "/api/notes",
        json={
            "title": draft["title"],
            "body": draft["body"],
            "starts_at": draft["starts_at"] or NOW.isoformat().replace("+00:00", "Z"),
            "reminder_offsets": [],
            "source": "video",
            "source_url": "https://youtu.be/dQw4w9WgXcQ",
            "source_ts": None,
            "ai_generated": True,
        },
    )
    assert create.status_code == 201, create.text
    note = create.json()
    assert note["source"] == "video"
    assert note["ai_generated"] is True
    assert note["source_url"] == "https://youtu.be/dQw4w9WgXcQ"


@pytest.mark.asyncio
async def test_youtube_api_en_offers_summary_ru(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
):
    login = f"yt_en_{datetime.now(timezone.utc).timestamp():.0f}"
    await _register(client, login)

    async def fake_en(session, url, *, clock):
        return EN_CAPTIONS, "en/asr"

    monkeypatch.setattr("app.routers.extract._captions_with_cache", fake_en)
    res = await client.post(
        "/api/extract/youtube",
        json={"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "timezone": TZ},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["source_lang"] == "en"
    assert body["summary"] is not None
    assert body["summary_ru"] is not None
    assert body["summary"]["title"]
    assert body["summary_ru"]["title"]
    assert body["summary"]["title"] != body["summary_ru"]["title"] or "[RU]" in body[
        "summary_ru"
    ]["title"]
    assert "## Main idea" in body["summary"]["body"] or "Main idea" in body["summary"]["body"]
    assert "Главная мысль" in body["summary_ru"]["body"]


@pytest.mark.asyncio
async def test_youtube_api_error_no_captions(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
):
    login = f"yt_nc_{datetime.now(timezone.utc).timestamp():.0f}"
    await _register(client, login)

    async def boom(session, url, *, clock):
        raise AppError(
            "no_captions",
            "У ролика нет субтитров (ни ручных, ни авто). Разбор по тексту дорожки невозможен.",
            status_code=404,
        )

    monkeypatch.setattr("app.routers.extract._captions_with_cache", boom)
    res = await client.post(
        "/api/extract/youtube",
        json={"url": "https://youtu.be/dQw4w9WgXcQ", "timezone": TZ},
    )
    assert res.status_code == 404, res.text
    err = res.json()["error"]
    assert err["code"] == "no_captions"
    assert "субтитров" in err["message"].lower()


@pytest.mark.asyncio
async def test_youtube_api_error_video_unavailable(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
):
    login = f"yt_un_{datetime.now(timezone.utc).timestamp():.0f}"
    await _register(client, login)

    async def boom(session, url, *, clock):
        raise AppError(
            "video_unavailable",
            "YouTube: ролик недоступен (ERROR). Проверьте id (регистр важен: I ≠ l) и регион.",
            status_code=404,
        )

    monkeypatch.setattr("app.routers.extract._captions_with_cache", boom)
    res = await client.post(
        "/api/extract/youtube",
        json={"url": "https://youtu.be/dQw4w9WgXcQ", "timezone": TZ},
    )
    assert res.status_code == 404, res.text
    err = res.json()["error"]
    assert err["code"] == "video_unavailable"
    assert "недоступен" in err["message"].lower()


@pytest.mark.asyncio
async def test_youtube_api_error_network(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
):
    login = f"yt_net_{datetime.now(timezone.utc).timestamp():.0f}"
    await _register(client, login)

    async def boom(session, url, *, clock):
        raise AppError(
            "upstream_error",
            "YouTube недоступен: Connection refused",
            status_code=502,
        )

    monkeypatch.setattr("app.routers.extract._captions_with_cache", boom)
    res = await client.post(
        "/api/extract/youtube",
        json={"url": "https://youtu.be/dQw4w9WgXcQ", "timezone": TZ},
    )
    assert res.status_code == 502, res.text
    err = res.json()["error"]
    assert err["code"] == "upstream_error"
    assert "YouTube недоступен" in err["message"]


@pytest.mark.asyncio
async def test_youtube_api_foreign_user_cannot_see_note(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
):
    owner = f"yt_own_{datetime.now(timezone.utc).timestamp():.0f}"
    other = f"yt_oth_{datetime.now(timezone.utc).timestamp():.0f}"
    await _register(client, owner)

    async def fake_ru(session, url, *, clock):
        return RU_CAPTIONS, "ru/manual"

    monkeypatch.setattr("app.routers.extract._captions_with_cache", fake_ru)
    res = await client.post(
        "/api/extract/youtube",
        json={"url": "https://youtu.be/dQw4w9WgXcQ", "timezone": TZ},
    )
    assert res.status_code == 200, res.text
    draft = res.json()["summary"]
    create = await client.post(
        "/api/notes",
        json={
            "title": draft["title"],
            "body": draft["body"],
            "starts_at": draft["starts_at"] or NOW.isoformat().replace("+00:00", "Z"),
            "reminder_offsets": [],
            "source": "video",
            "source_url": "https://youtu.be/dQw4w9WgXcQ",
            "ai_generated": True,
        },
    )
    assert create.status_code == 201, create.text
    note_id = create.json()["id"]

    await client.post("/api/auth/logout")
    await _register(client, other)
    get = await client.get(f"/api/notes/{note_id}")
    assert get.status_code == 404, get.text
