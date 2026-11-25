"""platform model configuration

Wires the super-admin model/key/voice config into runtime resolution:
  - platform_configurations : singleton key/value store for the global default
                              model configuration (key = MODEL_CONFIGURATION_V2)
  - org_platform_config.model_configuration_v2 : typed per-org override blob
    (shaped like OrganizationAIModelConfigurationV2)

Revision ID: c0nv0z3nt003
Revises: c0nv0z3nt002
Create Date: 2026-06-22
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c0nv0z3nt003"
down_revision: Union[str, None] = "c0nv0z3nt002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "platform_configurations",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("key", sa.String(), nullable=False),
        sa.Column("value", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
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
        sa.UniqueConstraint("key", name="uq_platform_configurations_key"),
    )

    op.add_column(
        "org_platform_config",
        sa.Column("model_configuration_v2", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("org_platform_config", "model_configuration_v2")
    op.drop_table("platform_configurations")
