"""Tag naming: name_lower is derived in exactly one place (see D-012)."""

from app.models import Tag


def set_tag_name(tag: Tag, name: str) -> None:
    """Set display name and keep name_lower in sync for unique(user_id, name_lower)."""
    cleaned = name.strip()
    if not cleaned:
        raise ValueError("tag name must not be empty")
    tag.name = cleaned
    tag.name_lower = cleaned.casefold()
