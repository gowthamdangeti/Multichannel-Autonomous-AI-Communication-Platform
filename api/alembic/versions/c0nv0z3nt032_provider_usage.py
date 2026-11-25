"""provider usage: real billed usage and cost on workflow_run_usage_events

Revision ID: c0nv0z3nt032
Revises: c0nv0z3nt031

Stores what a provider reported for a request, separately from our own
estimates. Cost keeps ten decimal places so provider values are never rounded.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "c0nv0z3nt032"
down_revision: str | None = "c0nv0z3nt031"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "workflow_run_usage_events",
        sa.Column("usage_source", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "workflow_run_usage_events",
        sa.Column("provider_cost_usd", sa.Numeric(20, 10), nullable=True),
    )
    op.add_column(
        "workflow_run_usage_events",
        sa.Column("usage_detail", postgresql.JSONB(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("workflow_run_usage_events", "usage_detail")
    op.drop_column("workflow_run_usage_events", "provider_cost_usd")
    op.drop_column("workflow_run_usage_events", "usage_source")
