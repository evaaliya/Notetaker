from datetime import datetime, timezone

from pydantic import BaseModel, field_serializer

from app.schemas.notes import NoteOut


def _iso_z(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


class OccurrenceOut(BaseModel):
    """One visible occurrence.

    ``occurrence_start`` — effective start (calendar position / fire base).
    ``original_start`` — series key for overrides (equals occurrence_start if not moved).
    """

    occurrence_start: datetime
    original_start: datetime
    note: NoteOut

    @field_serializer("occurrence_start", "original_start")
    def serialize_occ(self, value: datetime) -> str:
        return _iso_z(value)


class CalendarOut(BaseModel):
    items: list[OccurrenceOut]


class UpcomingOut(BaseModel):
    today: list[OccurrenceOut]
    week: list[OccurrenceOut]
    past: list[OccurrenceOut]
