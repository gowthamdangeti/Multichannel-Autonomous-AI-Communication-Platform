"""add scheduled call retry strategy

Revision ID: f7c2a91d4b60
Revises: e4b8a12c90f1
Create Date: 2026-08-17
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "f7c2a91d4b60"
down_revision: Union[str, None] = "e4b8a12c90f1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "scheduled_workflow_calls",
        sa.Column(
            "retry_strategy",
            sa.String(length=16),
            server_default="exponential",
            nullable=False,
        ),
    )
    op.add_column(
        "scheduled_workflow_calls",
        sa.Column(
            "retry_interval_seconds",
            sa.Integer(),
            server_default="60",
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("scheduled_workflow_calls", "retry_interval_seconds")
    op.drop_column("scheduled_workflow_calls", "retry_strategy")
