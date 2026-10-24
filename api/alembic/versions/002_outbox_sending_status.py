"""email_outbox status: add 'sending' for claim-before-SMTP.

Revision ID: 002
Revises: 001
Create Date: 2026-10-24
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("ck_email_outbox_status", "email_outbox", type_="check")
    op.create_check_constraint(
        "ck_email_outbox_status",
        "email_outbox",
        "status IN ('pending', 'sending', 'sent', 'failed')",
    )


def downgrade() -> None:
    op.execute("UPDATE email_outbox SET status = 'pending' WHERE status = 'sending'")
    op.drop_constraint("ck_email_outbox_status", "email_outbox", type_="check")
    op.create_check_constraint(
        "ck_email_outbox_status",
        "email_outbox",
        "status IN ('pending', 'sent', 'failed')",
    )
