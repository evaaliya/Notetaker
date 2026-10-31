"""note_members + notes.updated_by + nullable notification.reminder_id (M10).

Revision ID: 005
Revises: 004
Create Date: 2026-10-31
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "005"
down_revision: Union[str, None] = "004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "note_members",
        sa.Column("note_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("role", sa.Text(), nullable=False, server_default=sa.text("'editor'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("role = 'editor'", name="ck_note_members_role"),
        sa.ForeignKeyConstraint(["note_id"], ["notes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("note_id", "user_id"),
        sa.UniqueConstraint("note_id", "user_id", name="uq_note_members_note_user"),
    )
    op.create_index("ix_note_members_user_id", "note_members", ["user_id"])

    op.add_column(
        "notes",
        sa.Column("updated_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_notes_updated_by_user_id",
        "notes",
        "users",
        ["updated_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.alter_column(
        "notifications",
        "reminder_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=True,
    )
    op.drop_constraint("notifications_reminder_id_key", "notifications", type_="unique")
    op.create_index(
        "uq_notifications_reminder_id",
        "notifications",
        ["reminder_id"],
        unique=True,
        postgresql_where=sa.text("reminder_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_notifications_reminder_id", table_name="notifications")
    op.create_unique_constraint(
        "notifications_reminder_id_key", "notifications", ["reminder_id"]
    )
    op.alter_column(
        "notifications",
        "reminder_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=False,
    )

    op.drop_constraint("fk_notes_updated_by_user_id", "notes", type_="foreignkey")
    op.drop_column("notes", "updated_by_user_id")

    op.drop_index("ix_note_members_user_id", table_name="note_members")
    op.drop_table("note_members")
