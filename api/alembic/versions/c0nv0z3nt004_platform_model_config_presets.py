"""platform model configuration presets

Adds platform_model_configurations: admin-curated named model configuration
presets (e.g. "English Sarvam India"). Org users select one by display name
when creating an agent; the per-agent choice is stored in
workflow_configurations["platform_model_configuration_id"].

Revision ID: c0nv0z3nt004
Revises: c0nv0z3nt003
Create Date: 2026-06-22
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c0nv0z3nt004"
down_revision: Union[str, None] = "c0nv0z3nt003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "platform_model_configurations",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("description", sa.String(512), nullable=True),
        sa.Column("config", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "is_default",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "sort_order", sa.Integer(), nullable=False, server_default=sa.text("0")
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_platform_model_configurations_is_active",
        "platform_model_configurations",
        ["is_active"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_platform_model_configurations_is_active",
        table_name="platform_model_configurations",
    )
    op.drop_table("platform_model_configurations")
