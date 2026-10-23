"""name_lower is filled only via set_tag_name (D-010 / D-012)."""

import uuid

from app.models import Tag
from app.services.tags import set_tag_name


def test_set_tag_name_fills_name_lower():
    tag = Tag(id=uuid.uuid4(), user_id=uuid.uuid4(), color="#AABBCC")
    set_tag_name(tag, "  Work ")
    assert tag.name == "Work"
    assert tag.name_lower == "work"

    set_tag_name(tag, "WORK")
    assert tag.name == "WORK"
    assert tag.name_lower == "work"
