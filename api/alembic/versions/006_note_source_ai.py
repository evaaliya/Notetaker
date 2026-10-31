"""notes.source / source_url / source_ts / ai_generated (M11).

Revision ID: 006
Revises: 005
Create Date: 2026-10-31
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "006"
down_revision: Union[str, None] = "005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "notes",
        sa.Column("source", sa.Text(), nullable=False, server_default=sa.text("'manual'")),
    )
    op.add_column("notes", sa.Column("source_url", sa.Text(), nullable=True))
    op.add_column("notes", sa.Column("source_ts", sa.Float(), nullable=True))
    op.add_column(
        "notes",
        sa.Column("ai_generated", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_check_constraint(
        "ck_notes_source",
        "notes",
        "source IN ('manual', 'call', 'video')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_notes_source", "notes", type_="check")
    op.drop_column("notes", "ai_generated")
    op.drop_column("notes", "source_ts")
    op.drop_column("notes", "source_url")
    op.drop_column("notes", "source")
