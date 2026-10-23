from datetime import date, datetime, timezone
from typing import Literal
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, Field, field_serializer, field_validator


def _iso_z(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


class RecurrenceIn(BaseModel):
    freq: Literal["daily", "weekly", "monthly"]
    until: date | None = None
    tz: str

    @field_validator("tz")
    @classmethod
    def validate_tz(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError as exc:
            raise ValueError(f"Unknown IANA timezone: {value}") from exc
        return value


class NoteCreate(BaseModel):
    title: str = ""
    body: str = ""
    starts_at: datetime
    tag_ids: list[UUID] = Field(default_factory=list)
    reminder_offsets: list[int] = Field(default_factory=list)
    status: Literal["active", "inactive"] = "active"
    recurrence: RecurrenceIn | None = None

    @field_validator("starts_at")
    @classmethod
    def require_tz(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("starts_at must be timezone-aware (UTC)")
        return value.astimezone(timezone.utc)

    @field_validator("reminder_offsets")
    @classmethod
    def validate_offsets(cls, value: list[int]) -> list[int]:
        if any(o < 0 for o in value):
            raise ValueError("reminder_offsets must be non-negative")
        return value


class NotePatch(BaseModel):
    version: int
    title: str | None = None
    body: str | None = None
    starts_at: datetime | None = None
    tag_ids: list[UUID] | None = None
    reminder_offsets: list[int] | None = None
    recurrence: RecurrenceIn | None = None

    @field_validator("starts_at")
    @classmethod
    def require_tz(cls, value: datetime | None) -> datetime | None:
        if value is None:
            return value
        if value.tzinfo is None:
            raise ValueError("starts_at must be timezone-aware (UTC)")
        return value.astimezone(timezone.utc)

    @field_validator("reminder_offsets")
    @classmethod
    def validate_offsets(cls, value: list[int] | None) -> list[int] | None:
        if value is None:
            return value
        if any(o < 0 for o in value):
            raise ValueError("reminder_offsets must be non-negative")
        return value


class NoteListOut(BaseModel):
    items: list["NoteOut"]
    next_cursor: str | None


class NoteOut(BaseModel):
    id: UUID
    title: str
    body: str
    starts_at: datetime
    status: str
    reminder_offsets: list[int]
    version: int
    deleted_at: datetime | None
    created_at: datetime
    updated_at: datetime
    tag_ids: list[UUID]
    rec_freq: str | None
    rec_until: date | None
    rec_tz: str | None

    model_config = {"from_attributes": True}

    @field_serializer("starts_at", "created_at", "updated_at")
    def serialize_dt(self, value: datetime) -> str:
        return _iso_z(value)

    @field_serializer("deleted_at")
    def serialize_deleted(self, value: datetime | None) -> str | None:
        return None if value is None else _iso_z(value)
