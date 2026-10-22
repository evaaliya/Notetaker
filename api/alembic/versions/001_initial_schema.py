"""initial schema

Revision ID: 001
Revises:
Create Date: 2026-10-23

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS citext")
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("login", postgresql.CITEXT(), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("email", sa.Text(), nullable=True),
        sa.Column("timezone", sa.Text(), server_default=sa.text("'UTC'"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("login"),
    )

    op.create_table(
        "sessions",
        sa.Column("token_hash", sa.Text(), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        "tags",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("name_lower", sa.Text(), nullable=False),
        sa.Column("color", sa.Text(), nullable=False),
        sa.UniqueConstraint("user_id", "name_lower", name="uq_tags_user_name_lower"),
    )

    op.create_table(
        "notes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.Text(), server_default=sa.text("''"), nullable=False),
        sa.Column("body", sa.Text(), server_default=sa.text("''"), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.Text(), server_default=sa.text("'active'"), nullable=False),
        sa.Column(
            "reminder_offsets",
            postgresql.ARRAY(sa.Integer()),
            server_default=sa.text("'{}'"),
            nullable=False,
        ),
        sa.Column("version", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("rec_freq", sa.Text(), nullable=True),
        sa.Column("rec_until", sa.Date(), nullable=True),
        sa.Column("rec_tz", sa.Text(), nullable=True),
        sa.CheckConstraint("status IN ('active', 'inactive')", name="ck_notes_status"),
        sa.CheckConstraint(
            "rec_freq IS NULL OR rec_freq IN ('daily', 'weekly', 'monthly')",
            name="ck_notes_rec_freq",
        ),
    )
    op.create_index(
        "ix_notes_user_starts_at",
        "notes",
        ["user_id", "starts_at", "id"],
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "ix_notes_user_updated_at",
        "notes",
        ["user_id", "updated_at", "id"],
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "ix_notes_deleted_at",
        "notes",
        ["deleted_at"],
        postgresql_where=sa.text("deleted_at IS NOT NULL"),
    )
    op.execute(
        "CREATE INDEX ix_notes_trgm_search ON notes "
        "USING gin ((lower(title || ' ' || body)) gin_trgm_ops)"
    )

    op.create_table(
        "note_tags",
        sa.Column("note_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("notes.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("tag_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
    )

    op.create_table(
        "occurrence_overrides",
        sa.Column("note_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("notes.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("original_start", sa.DateTime(timezone=True), primary_key=True),
        sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("title", sa.Text(), nullable=True),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("starts_at", sa.Text(), nullable=True),
    )

    op.create_table(
        "reminders",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("note_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("notes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("occurrence_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("offset_min", sa.Integer(), nullable=False),
        sa.Column("fire_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.Text(), server_default=sa.text("'pending'"), nullable=False),
        sa.CheckConstraint(
            "status IN ('pending', 'sent', 'skipped', 'missed')",
            name="ck_reminders_status",
        ),
        sa.UniqueConstraint("note_id", "occurrence_start", "offset_min", name="uq_reminders_note_occ_offset"),
    )
    op.create_index(
        "ix_reminders_pending_fire_at",
        "reminders",
        ["fire_at"],
        postgresql_where=sa.text("status = 'pending'"),
    )

    op.create_table(
        "notifications",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "reminder_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("reminders.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("seen_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "email_outbox",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "reminder_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("reminders.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("to_addr", sa.Text(), nullable=False),
        sa.Column("subject", sa.Text(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), server_default=sa.text("'pending'"), nullable=False),
        sa.Column("attempts", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("message_id", sa.Text(), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status IN ('pending', 'sent', 'failed')", name="ck_email_outbox_status"),
    )

    op.create_table(
        "worker_heartbeat",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("worker_heartbeat")
    op.drop_table("email_outbox")
    op.drop_table("notifications")
    op.drop_index("ix_reminders_pending_fire_at", table_name="reminders")
    op.drop_table("reminders")
    op.drop_table("occurrence_overrides")
    op.drop_table("note_tags")
    op.execute("DROP INDEX IF EXISTS ix_notes_trgm_search")
    op.drop_index("ix_notes_deleted_at", table_name="notes")
    op.drop_index("ix_notes_user_updated_at", table_name="notes")
    op.drop_index("ix_notes_user_starts_at", table_name="notes")
    op.drop_table("notes")
    op.drop_table("tags")
    op.drop_table("sessions")
    op.drop_table("users")
