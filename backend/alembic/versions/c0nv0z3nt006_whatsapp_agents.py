"""whatsapp agents

Adds whatsapp_agents (conversational text agents that reuse the org's shared AI
model configuration) and an assigned_agent_id FK on whatsapp_numbers so a number
can be bound to an agent for inbound/outbound conversations.

Revision ID: c0nv0z3nt006
Revises: c0nv0z3nt005
Create Date: 2026-07-19
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c0nv0z3nt006"
down_revision: Union[str, None] = "c0nv0z3nt005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "whatsapp_agents",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column(
            "organization_id",
            sa.Integer(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(64), nullable=False),
        sa.Column("description", sa.String(512), nullable=True),
        sa.Column(
            "system_prompt", sa.Text(), nullable=False, server_default=sa.text("''")
        ),
        sa.Column("greeting", sa.Text(), nullable=True),
        sa.Column(
            "model_config_ref",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'{}'::json"),
        ),
        sa.Column(
            "is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint(
            "organization_id", "name", name="uq_whatsapp_agents_org_name"
        ),
    )
    op.create_index(
        "ix_whatsapp_agents_org", "whatsapp_agents", ["organization_id"]
    )
    op.add_column(
        "whatsapp_numbers",
        sa.Column(
            "assigned_agent_id",
            sa.Integer(),
            sa.ForeignKey("whatsapp_agents.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("whatsapp_numbers", "assigned_agent_id")
    op.drop_index("ix_whatsapp_agents_org", table_name="whatsapp_agents")
    op.drop_table("whatsapp_agents")
