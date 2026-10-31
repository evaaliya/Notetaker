from datetime import datetime, timezone
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, Field, field_serializer, field_validator


def _iso_z(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


class ExtractIn(BaseModel):
    text: str = Field(min_length=1)
    timezone: str | None = None

    @field_validator("timezone")
    @classmethod
    def validate_tz(cls, value: str | None) -> str | None:
        if value is None:
            return value
        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError as exc:
            raise ValueError(f"Unknown IANA timezone: {value}") from exc
        return value


class DraftOut(BaseModel):
    title: str
    body: str
    starts_at: datetime | None = None
    reminder_offsets: list[int] = Field(default_factory=list)
    tag_names: list[str] = Field(default_factory=list)
    kind: Literal["summary", "task", "decision"] = "task"

    @field_serializer("starts_at")
    def serialize_starts(self, value: datetime | None) -> str | None:
        return None if value is None else _iso_z(value)


class YoutubeExtractIn(BaseModel):
    url: str = Field(min_length=3)
    timezone: str | None = None

    @field_validator("timezone")
    @classmethod
    def validate_tz(cls, value: str | None) -> str | None:
        if value is None:
            return value
        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError as exc:
            raise ValueError(f"Unknown IANA timezone: {value}") from exc
        return value


class ExtractOut(BaseModel):
    summary: DraftOut | None
    drafts: list[DraftOut]
    provider: str
    transcript: str | None = None
