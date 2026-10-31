from datetime import datetime, timezone
from uuid import UUID

from pydantic import BaseModel, field_serializer


def _iso_z(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


class AttachmentOut(BaseModel):
    id: UUID
    note_id: UUID
    filename: str
    content_type: str
    size: int
    created_at: datetime

    model_config = {"from_attributes": True}

    @field_serializer("created_at")
    def serialize_dt(self, value: datetime) -> str:
        return _iso_z(value)
