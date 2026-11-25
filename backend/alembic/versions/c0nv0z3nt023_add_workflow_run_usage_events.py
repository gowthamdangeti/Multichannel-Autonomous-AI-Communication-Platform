"""add canonical workflow run usage events

Revision ID: c0nv0z3nt023
Revises: c0nv0z3nt022
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c0nv0z3nt023"
down_revision: Union[str, None] = "c0nv0z3nt022"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "workflow_run_usage_events",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("workflow_run_id", sa.Integer(), nullable=False),
        sa.Column("case", sa.String(length=64), nullable=False),
        sa.Column("service_type", sa.String(length=8), nullable=False),
        sa.Column("status", sa.String(length=16), server_default="recorded", nullable=False),
        sa.Column("operation_id", sa.String(length=255), nullable=False),
        sa.Column("attempt", sa.Integer(), server_default="1", nullable=False),
        sa.Column("provider", sa.String(length=128), nullable=True),
        sa.Column("model", sa.String(length=256), nullable=True),
        sa.Column("node_id", sa.String(length=128), nullable=True),
        sa.Column("input_tokens", sa.Integer(), server_default="0", nullable=False),
        sa.Column("output_tokens", sa.Integer(), server_default="0", nullable=False),
        sa.Column("total_tokens", sa.Integer(), server_default="0", nullable=False),
        sa.Column("cache_read_tokens", sa.Integer(), server_default="0", nullable=False),
        sa.Column("cache_write_tokens", sa.Integer(), server_default="0", nullable=False),
        sa.Column("input_units", sa.Numeric(18, 6), server_default="0", nullable=False),
        sa.Column("output_units", sa.Numeric(18, 6), server_default="0", nullable=False),
        sa.Column("estimated_cost_usd", sa.Numeric(18, 8), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["workflow_run_id"], ["workflow_runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "workflow_run_id",
            "operation_id",
            "attempt",
            name="uq_usage_event_run_operation_attempt",
        ),
        sa.CheckConstraint(
            '"case" IN (\'conversation\', \'conversation_title\', \'conversation_completeness\', \'agenda_outcomes\', \'qa_results\', \'report_generation\')',
            name="ck_usage_event_case",
        ),
        sa.CheckConstraint(
            "service_type IN ('llm', 'stt', 'tts', 'sts')",
            name="ck_usage_event_service_type",
        ),
        sa.CheckConstraint(
            "status IN ('recorded', 'unavailable', 'failed')",
            name="ck_usage_event_status",
        ),
    )
    op.create_index("ix_workflow_run_usage_events_workflow_run_id", "workflow_run_usage_events", ["workflow_run_id"])
    op.create_index("ix_usage_event_run_case", "workflow_run_usage_events", ["workflow_run_id", "case"])


def downgrade() -> None:
    op.drop_index("ix_usage_event_run_case", table_name="workflow_run_usage_events")
    op.drop_index("ix_workflow_run_usage_events_workflow_run_id", table_name="workflow_run_usage_events")
    op.drop_table("workflow_run_usage_events")
