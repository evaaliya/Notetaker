import re
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

_COLOR_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")


class TagCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    color: str

    @field_validator("color")
    @classmethod
    def validate_color(cls, value: str) -> str:
        if not _COLOR_RE.match(value):
            raise ValueError("color must be #RRGGBB")
        return value.upper()


class TagPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    color: str | None = None

    @field_validator("color")
    @classmethod
    def validate_color(cls, value: str | None) -> str | None:
        if value is None:
            return value
        if not _COLOR_RE.match(value):
            raise ValueError("color must be #RRGGBB")
        return value.upper()


class TagOut(BaseModel):
    id: UUID
    name: str
    color: str

    model_config = {"from_attributes": True}
