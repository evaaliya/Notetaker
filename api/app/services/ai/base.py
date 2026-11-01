from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol

from app.config import get_settings


@dataclass
class DraftNote:
    title: str
    body: str
    starts_at: datetime | None = None
    reminder_offsets: list[int] = field(default_factory=list)
    tag_names: list[str] = field(default_factory=list)
    kind: str = "task"  # summary | task | decision


@dataclass
class ExtractResult:
    summary: DraftNote | None
    drafts: list[DraftNote]
    source_lang: str | None = None  # en | ru | other
    summary_ru: DraftNote | None = None  # Russian twin when source is English


class ExtractProvider(Protocol):
    def extract(self, text: str, *, now: datetime, timezone: str) -> ExtractResult: ...


def get_provider() -> ExtractProvider:
    settings = get_settings()
    name = (settings.ai_provider or "stub").strip().lower()
    if name == "stub":
        from app.services.ai.stub import StubProvider

        return StubProvider()
    if name == "openrouter":
        from app.services.ai.openrouter import OpenRouterProvider

        return OpenRouterProvider(
            api_key=settings.openrouter_api_key or "",
            model=settings.openrouter_model,
        )
    raise ValueError(f"Unknown AI_PROVIDER: {name}")
