"""add editable campaign call targets

Revision ID: c0nv0z3nt013
Revises: c0nv0z3nt012
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c0nv0z3nt013"
down_revision: Union[str, None] = "b3c4d5e6f7a8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "campaigns",
        sa.Column(
            "call_targets_initialized",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.create_table(
        "campaign_call_targets",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("campaign_id", sa.Integer(), nullable=False),
        sa.Column("phone_number", sa.String(length=64), nullable=False),
        sa.Column(
            "context_variables",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'{}'::json"),
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["campaign_id"], ["campaigns.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("campaign_id", "phone_number", name="uq_campaign_target_phone"),
    )
    op.create_index(
        "ix_campaign_call_targets_campaign_id",
        "campaign_call_targets",
        ["campaign_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_campaign_call_targets_campaign_id", table_name="campaign_call_targets")
    op.drop_table("campaign_call_targets")
    op.drop_column("campaigns", "call_targets_initialized")
