"""Prove source lang is resolved from captions BEFORE the model chat."""

from __future__ import annotations

import json
from datetime import datetime, timezone

from app.services.ai.base import DraftNote
from app.services.ai.lang import detect_lang, resolve_source_lang
from app.services.ai.openrouter import OpenRouterProvider


NOW = datetime(2026, 11, 3, 12, 0, 0, tzinfo=timezone.utc)

EN_CAPTIONS = (
    "Eddie Osmani published his agent skills as open source. "
    "Matt Pocock and others discuss how to structure agent workflows. "
    "The main idea is reusable skill packs for coding agents."
)

RU_CAPTIONS = (
    "Эдди Османи опубликовал навыки агентов в открытом доступе. "
    "Участники обсуждают, как структурировать работу агентов. "
    "Главная мысль — переиспользуемые наборы навыков."
)


def test_detect_lang_letter_ratio_on_captions_text():
    assert detect_lang(EN_CAPTIONS) == "en"
    assert detect_lang(RU_CAPTIONS) == "ru"


def test_openrouter_resolve_source_lang_before_model_chat(monkeypatch):
    """Call order: resolve_source_lang → _chat. caption_lang wins over letters."""
    events: list[tuple] = []

    def spy_resolve(*, caption_lang: str | None, transcript: str) -> str:
        real = resolve_source_lang(caption_lang=caption_lang, transcript=transcript)
        events.append(("resolve_source_lang", caption_lang, transcript, real))
        return real

    monkeypatch.setattr("app.services.ai.openrouter.resolve_source_lang", spy_resolve)

    provider = OpenRouterProvider(api_key="test-key", model="test-model")

    def fake_chat(payload: dict) -> str:
        user = payload["messages"][1]["content"]
        events.append(("model_chat", user))
        return json.dumps(
            {
                "source_lang": "en",
                "summary": {
                    "title": "Agent skills",
                    "body": "## Main idea\nReusable packs.\n\n## Notes\n- Open source",
                    "starts_at": None,
                    "reminder_offsets": [],
                    "tag_names": [],
                },
                "summary_ru": {
                    "title": "",
                    "body": "",
                    "starts_at": None,
                    "reminder_offsets": [],
                    "tag_names": [],
                },
                "drafts": [],
            }
        )

    monkeypatch.setattr(provider, "_chat", fake_chat)

    def fake_translate(note: DraftNote, target: str) -> DraftNote:
        events.append(("translate_after_model", target))
        return DraftNote(
            title=f"[RU] {note.title}",
            body="## Главная мысль\nперевод",
            starts_at=note.starts_at,
            reminder_offsets=list(note.reminder_offsets),
            tag_names=list(note.tag_names),
            kind="summary",
        )

    monkeypatch.setattr(provider, "translate_summary", fake_translate)

    # Cyrillic transcript + en track → still en before model.
    mixed = "Настройка skills. " * 10
    result = provider.extract(
        mixed, now=NOW, timezone="UTC", caption_lang="en/asr"
    )

    kinds = [e[0] for e in events]
    assert kinds[0] == "resolve_source_lang", f"first step must resolve lang, got {kinds}"
    assert "model_chat" in kinds
    assert kinds.index("resolve_source_lang") < kinds.index("model_chat")
    assert events[0][1] == "en/asr"
    assert events[0][3] == "en"
    assert "detected_source_lang=en" in events[kinds.index("model_chat")][1]
    assert result.source_lang == "en"
    assert result.summary is not None


def test_job_wiring_captions_text_equals_extract_input():
    fetched_text, track_lang = EN_CAPTIONS, "en/asr"
    assert resolve_source_lang(caption_lang=track_lang, transcript=fetched_text) == "en"
