"""extract_jobs + youtube_caption_cache (M14).

Revision ID: 007
Revises: 006
Create Date: 2026-11-01
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "007"
down_revision: Union[str, None] = "006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "youtube_caption_cache",
        sa.Column("video_id", sa.Text(), primary_key=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("lang", sa.Text(), nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("chars", sa.Integer(), nullable=False, server_default=sa.text("0")),
    )

    op.create_table(
        "extract_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False, server_default=sa.text("'youtube'")),
        sa.Column("video_id", sa.Text(), nullable=True),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("timezone", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'pending'")),
        sa.Column("step", sa.Text(), nullable=False, server_default=sa.text("'queued'")),
        sa.Column("cancel_requested", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("error_code", sa.Text(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("error_hint", sa.Text(), nullable=True),
        sa.Column("result", postgresql.JSONB(), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "kind IN ('youtube')",
            name="ck_extract_jobs_kind",
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'running', 'done', 'error', 'cancelled')",
            name="ck_extract_jobs_status",
        ),
        sa.CheckConstraint(
            "step IN ('queued', 'captions', 'extract', 'done')",
            name="ck_extract_jobs_step",
        ),
    )
    op.create_index("ix_extract_jobs_user_created", "extract_jobs", ["user_id", "created_at"])
    op.create_index(
        "ix_extract_jobs_pending",
        "extract_jobs",
        ["status", "created_at"],
        postgresql_where=sa.text("status = 'pending'"),
    )
    # One in-flight youtube job per user+video (idempotent re-click).
    op.create_index(
        "uq_extract_jobs_inflight_video",
        "extract_jobs",
        ["user_id", "video_id"],
        unique=True,
        postgresql_where=sa.text(
            "status IN ('pending', 'running') AND video_id IS NOT NULL AND cancel_requested = false"
        ),
    )


def downgrade() -> None:
    op.drop_index("uq_extract_jobs_inflight_video", table_name="extract_jobs")
    op.drop_index("ix_extract_jobs_pending", table_name="extract_jobs")
    op.drop_index("ix_extract_jobs_user_created", table_name="extract_jobs")
    op.drop_table("extract_jobs")
    op.drop_table("youtube_caption_cache")
