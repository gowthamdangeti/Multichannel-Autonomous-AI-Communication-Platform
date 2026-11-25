"""add scheduled workflow calls

Revision ID: e4b8a12c90f1
Revises: d370dc5e01b7
Create Date: 2026-08-14
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "e4b8a12c90f1"
down_revision: Union[str, None] = "d370dc5e01b7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "scheduled_workflow_calls",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.Column("target_workflow_id", sa.Integer(), nullable=False),
        sa.Column("trigger_path", sa.String(length=36), nullable=False),
        sa.Column("phone_number", sa.String(length=64), nullable=False),
        sa.Column(
            "initial_context",
            sa.JSON(),
            server_default=sa.text("'{}'::json"),
            nullable=False,
        ),
        sa.Column("telephony_configuration_id", sa.Integer(), nullable=True),
        sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(length=32), server_default="pending", nullable=False),
        sa.Column("idempotency_key", sa.String(length=128), nullable=False),
        sa.Column("attempt_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("max_attempts", sa.Integer(), server_default="3", nullable=False),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("dispatched_workflow_run_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("dispatched_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["organization_id"], ["organizations.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["target_workflow_id"], ["workflows.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["telephony_configuration_id"],
            ["telephony_configurations.id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["dispatched_workflow_run_id"],
            ["workflow_runs.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "organization_id",
            "idempotency_key",
            name="uq_scheduled_workflow_calls_org_idempotency",
        ),
    )
    op.create_index(
        "ix_scheduled_workflow_calls_due",
        "scheduled_workflow_calls",
        ["status", "next_attempt_at"],
    )
    op.create_index(
        "ix_scheduled_workflow_calls_workflow",
        "scheduled_workflow_calls",
        ["target_workflow_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_scheduled_workflow_calls_workflow",
        table_name="scheduled_workflow_calls",
    )
    op.drop_index(
        "ix_scheduled_workflow_calls_due",
        table_name="scheduled_workflow_calls",
    )
    op.drop_table("scheduled_workflow_calls")
