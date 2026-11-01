"""notifications.note_id for open-from-inbox (M15).

Revision ID: 008
Revises: 007
Create Date: 2026-11-01
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "008"
down_revision: Union[str, None] = "007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "notifications",
        sa.Column(
            "note_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("notes.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_notifications_note_id", "notifications", ["note_id"])
    # Backfill from reminders for existing rows.
    op.execute(
        """
        UPDATE notifications AS n
        SET note_id = r.note_id
        FROM reminders AS r
        WHERE n.reminder_id = r.id AND n.note_id IS NULL
        """
    )


def downgrade() -> None:
    op.drop_index("ix_notifications_note_id", table_name="notifications")
    op.drop_column("notifications", "note_id")
