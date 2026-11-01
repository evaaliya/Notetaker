"""Personal note tags + show_in_calendar (M16).

Revision ID: 009
Revises: 008
Create Date: 2026-11-02
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "009"
down_revision: Union[str, None] = "008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "notes",
        sa.Column(
            "show_in_calendar",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )

    op.create_table(
        "note_user_tags",
        sa.Column("note_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tag_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(["note_id"], ["notes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tag_id"], ["tags.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("note_id", "user_id", "tag_id"),
        sa.UniqueConstraint("note_id", "user_id", "tag_id", name="uq_note_user_tags_note_user_tag"),
    )
    op.create_index("ix_note_user_tags_user_id", "note_user_tags", ["user_id"])
    op.create_index("ix_note_user_tags_tag_id", "note_user_tags", ["tag_id"])

    # Preserve owner assignments: note_tags → note_user_tags with notes.user_id.
    op.execute(
        """
        INSERT INTO note_user_tags (note_id, user_id, tag_id)
        SELECT nt.note_id, n.user_id, nt.tag_id
        FROM note_tags AS nt
        JOIN notes AS n ON n.id = nt.note_id
        ON CONFLICT DO NOTHING
        """
    )
    op.drop_table("note_tags")


def downgrade() -> None:
    op.create_table(
        "note_tags",
        sa.Column("note_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tag_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(["note_id"], ["notes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tag_id"], ["tags.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("note_id", "tag_id"),
    )
    # Restore only owner rows (members' personal tags are lost on downgrade).
    op.execute(
        """
        INSERT INTO note_tags (note_id, tag_id)
        SELECT nut.note_id, nut.tag_id
        FROM note_user_tags AS nut
        JOIN notes AS n ON n.id = nut.note_id AND n.user_id = nut.user_id
        ON CONFLICT DO NOTHING
        """
    )
    op.drop_index("ix_note_user_tags_tag_id", table_name="note_user_tags")
    op.drop_index("ix_note_user_tags_user_id", table_name="note_user_tags")
    op.drop_table("note_user_tags")
    op.drop_column("notes", "show_in_calendar")
