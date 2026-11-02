"""Caption track pick order + caption_lang → source_lang (exact lang plan)."""

from __future__ import annotations

from datetime import datetime, timezone

from app.services.ai.base import DraftNote, ExtractResult
from app.services.ai.bilingual import ensure_en_pair, stub_translate
from app.services.ai.lang import normalize_caption_lang, resolve_source_lang
from app.services.ai.stub import StubProvider
from app.services.youtube_captions import (
    CAPTION_TRACK_ALGO_VERSION,
    _audio_lang_from_captions_renderer,
    _audio_lang_from_track_id,
    _order_tracks,
    _track_score,
    caption_cache_key,
)


def _track(lang: str, *, asr: bool = False) -> dict:
    return {
        "languageCode": lang,
        "kind": "asr" if asr else "",
        "baseUrl": f"https://example.test/{lang}",
    }


def test_normalize_caption_lang():
    assert normalize_caption_lang("en/asr") == "en"
    assert normalize_caption_lang("en-US") == "en"
    assert normalize_caption_lang("ru/manual") == "ru"
    assert normalize_caption_lang("ru") == "ru"
    assert normalize_caption_lang("?") == "other"
    assert normalize_caption_lang("") == "other"
    assert normalize_caption_lang("de/asr") == "other"


def test_resolve_source_lang_prefers_caption_track_over_cyrillic_text():
    # Track says English even if body looks Russian (wrong heuristic case).
    cyrillic_looking = "Настройка skills и основной workflow для агентов. " * 5
    assert resolve_source_lang(caption_lang="en/asr", transcript=cyrillic_looking) == "en"
    assert resolve_source_lang(caption_lang="ru/manual", transcript="Hello world agents") == "ru"


def test_resolve_source_lang_falls_back_to_letters_when_unknown():
    assert (
        resolve_source_lang(
            caption_lang="?",
            transcript="Eddie published agent skills as open source documentation.",
        )
        == "en"
    )


def test_track_order_audio_en_prefers_english_over_russian_manual():
    tracks = [
        _track("ru", asr=False),
        _track("en", asr=True),
        _track("en", asr=False),
        _track("ru", asr=True),
    ]
    ordered = _order_tracks(tracks, preferred_audio="en")
    codes = [(t["languageCode"], t.get("kind") or "manual") for t in ordered]
    assert codes[0] == ("en", "manual")
    assert codes[1] == ("en", "asr")
    assert codes[2][0] == "ru"
    assert codes[3][0] == "ru"


def test_track_order_without_audio_pref_en_before_ru():
    tracks = [_track("ru", asr=False), _track("en", asr=True)]
    ordered = _order_tracks(tracks, preferred_audio=None)
    assert ordered[0]["languageCode"] == "en"


def test_track_order_audio_ru_prefers_russian_over_english_asr():
    """Lyusik-class videos: both en/asr + ru/asr, default audio ru.4."""
    tracks = [_track("en", asr=True), _track("ru", asr=True)]
    ordered = _order_tracks(tracks, preferred_audio="ru")
    assert ordered[0]["languageCode"] == "ru"
    assert ordered[1]["languageCode"] == "en"


def test_audio_lang_from_captions_renderer_default_index():
    assert _audio_lang_from_track_id("ru.4") == "ru"
    assert _audio_lang_from_track_id("en-US.10") == "en-us"
    renderer = {
        "defaultAudioTrackIndex": 1,
        "audioTracks": [
            {"audioTrackId": "en-US.10", "captionTrackIndices": [0, 1]},
            {"audioTrackId": "ru.4", "captionTrackIndices": [1, 0]},
        ],
    }
    assert _audio_lang_from_captions_renderer(renderer) == "ru"
    # Index 0 → English dubbed track id.
    renderer["defaultAudioTrackIndex"] = 0
    assert _audio_lang_from_captions_renderer(renderer) == "en-us"


def test_track_score_lang_outranks_manual():
    # Russian manual must not beat English ASR when preferred audio is en.
    en_asr = _track_score(_track("en", asr=True), preferred_audio="en")
    ru_manual = _track_score(_track("ru", asr=False), preferred_audio="en")
    assert en_asr > ru_manual


def test_caption_cache_key_includes_algo_version():
    key = caption_cache_key("dQw4w9WgXcQ")
    assert key.startswith(f"{CAPTION_TRACK_ALGO_VERSION}:")
    assert key.endswith("dQw4w9WgXcQ")
    # Old bare / v2 video_id keys must not collide.
    assert key != "dQw4w9WgXcQ"
    assert not key.startswith("v2:")


def test_ensure_en_pair_honors_caption_lang_en_despite_cyrillic_transcript():
    summary = DraftNote(
        title="Agent skills",
        body="## Main idea\nReusable packs.",
        kind="summary",
    )
    result = ExtractResult(summary=summary, drafts=[], source_lang="ru", summary_ru=None)
    fixed = ensure_en_pair(
        result,
        transcript="Настройка skills. Автор показывает репозиторий. " * 8,
        translate=stub_translate,
        caption_lang="en/asr",
    )
    assert fixed.source_lang == "en"
    assert fixed.summary_ru is not None


def test_ensure_en_pair_honors_caption_lang_ru():
    summary = DraftNote(
        title="Конспект",
        body="## Главная мысль\nТекст.",
        kind="summary",
    )
    result = ExtractResult(summary=summary, drafts=[], source_lang="en", summary_ru=None)
    fixed = ensure_en_pair(
        result,
        transcript="Hello world this is entirely English filler content for letters.",
        translate=stub_translate,
        caption_lang="ru/manual",
    )
    assert fixed.source_lang == "ru"
    assert fixed.summary_ru is None


def test_stub_extract_with_caption_lang_en():
    now = datetime(2026, 11, 3, 12, 0, 0, tzinfo=timezone.utc)
    # Cyrillic-heavy text would fool letter heuristic → ru; caption track wins.
    text = "Настройка skills и основной рабочий процесс агента. " * 6
    r = StubProvider().extract(
        text, now=now, timezone="UTC", caption_lang="en/asr"
    )
    assert r.source_lang == "en"
