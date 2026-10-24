"""Expand notes into calendar/upcoming occurrences with overrides applied."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Note, OccurrenceOverride
from app.schemas.calendar import OccurrenceOut
from app.schemas.notes import NoteOut
from app.services.notes import note_to_out
from app.services.recurrence import iter_occurrence_starts


def parse_override_starts(value: str) -> datetime:
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        raise ValueError("override starts_at must be timezone-aware")
    return dt.astimezone(timezone.utc)


def iso_z(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def effective_start(original: datetime, override: OccurrenceOverride | None) -> datetime:
    if override is not None and override.starts_at:
        return parse_override_starts(override.starts_at)
    return original.astimezone(timezone.utc)


def apply_override_to_note(base: NoteOut, override: OccurrenceOverride | None, *, effective: datetime) -> NoteOut:
    """Return a NoteOut view for one occurrence (title/body/starts may be overridden)."""
    data = base.model_dump()
    if override is not None:
        if override.title is not None:
            data["title"] = override.title
        if override.body is not None:
            data["body"] = override.body
    data["starts_at"] = effective
    return NoteOut.model_validate(data)


async def load_overrides(
    db: AsyncSession, note_ids: list[uuid.UUID]
) -> dict[tuple[uuid.UUID, datetime], OccurrenceOverride]:
    if not note_ids:
        return {}
    result = await db.execute(
        select(OccurrenceOverride).where(OccurrenceOverride.note_id.in_(note_ids))
    )
    out: dict[tuple[uuid.UUID, datetime], OccurrenceOverride] = {}
    for ov in result.scalars().all():
        key = (ov.note_id, ov.original_start.astimezone(timezone.utc))
        out[key] = ov
    return out


async def expand_note_in_range(
    db: AsyncSession,
    note: Note,
    *,
    range_from: datetime,
    range_to: datetime,
    overrides: dict[tuple[uuid.UUID, datetime], OccurrenceOverride] | None = None,
    base_out: NoteOut | None = None,
) -> list[OccurrenceOut]:
    """Occurrences of one note in ``[range_from, range_to)`` (effective start in range)."""
    base = base_out or await note_to_out(db, note)
    ov_map = overrides if overrides is not None else await load_overrides(db, [note.id])

    if note.rec_freq is None:
        start = note.starts_at.astimezone(timezone.utc)
        if not (range_from <= start < range_to):
            return []
        return [
            OccurrenceOut(
                occurrence_start=start,
                original_start=start,
                note=base,
            )
        ]

    assert note.rec_tz is not None
    # Generate a padded window so moved overrides still appear when effective is in range.
    pad = timedelta(days=2)
    originals = iter_occurrence_starts(
        series_starts_at=note.starts_at,
        freq=note.rec_freq,
        rec_until=note.rec_until,
        rec_tz=note.rec_tz,
        range_from=range_from - pad,
        range_to=range_to + pad,
    )
    items: list[OccurrenceOut] = []
    for original in originals:
        ov = ov_map.get((note.id, original.astimezone(timezone.utc)))
        if ov is not None and ov.is_deleted:
            continue
        eff = effective_start(original, ov)
        if not (range_from <= eff < range_to):
            continue
        items.append(
            OccurrenceOut(
                occurrence_start=eff,
                original_start=original.astimezone(timezone.utc),
                note=apply_override_to_note(base, ov, effective=eff),
            )
        )
    return items


def series_may_intersect(note: Note, range_from: datetime, range_to: datetime) -> bool:
    """Cheap prefilter: series span vs query window (approximate)."""
    if note.rec_freq is None:
        return True
    start = note.starts_at.astimezone(timezone.utc)
    if start >= range_to:
        return False
    if note.rec_until is None:
        return True
    # Inclusive until end-of-day in rec_tz → treat as date+1 UTC midnight upper bound
    tz = ZoneInfo(note.rec_tz or "UTC")
    until_end = datetime(
        note.rec_until.year, note.rec_until.month, note.rec_until.day, 23, 59, 59, tzinfo=tz
    ).astimezone(timezone.utc)
    return until_end >= range_from


def day_before_in_tz(instant: datetime, tz_name: str) -> date:
    """Calendar day before ``instant``'s local date in ``tz_name`` (for series split)."""
    local_day = instant.astimezone(ZoneInfo(tz_name)).date()
    return local_day - timedelta(days=1)
