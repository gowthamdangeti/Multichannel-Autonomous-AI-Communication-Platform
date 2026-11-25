"""chat agents + chat conversations

Standalone embeddable chat agents (persona/system prompt + shared model config)
surfaced as a website chat widget, plus per-visitor chat conversations.

Revision ID: c0nv0z3nt010
Revises: c0nv0z3nt009
Create Date: 2026-07-21
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c0nv0z3nt010"
down_revision: Union[str, None] = "c0nv0z3nt009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "chat_agents",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "organization_id",
            sa.Integer(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("description", sa.String(length=512), nullable=True),
        sa.Column("character", sa.String(length=64), nullable=True),
        sa.Column(
            "system_prompt",
            sa.Text(),
            nullable=False,
            server_default=sa.text("''"),
        ),
        sa.Column("greeting", sa.Text(), nullable=True),
        sa.Column(
            "model_config_ref",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'{}'::json"),
        ),
        sa.Column("public_key", sa.String(length=64), nullable=False),
        sa.Column("allowed_domains", sa.JSON(), nullable=True),
        sa.Column(
            "appearance",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'{}'::json"),
        ),
        sa.Column(
            "is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("organization_id", "name", name="uq_chat_agents_org_name"),
    )
    op.create_index("ix_chat_agents_org", "chat_agents", ["organization_id"])
    op.create_index(
        "ix_chat_agents_public_key", "chat_agents", ["public_key"], unique=True
    )

    op.create_table(
        "chat_conversations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "organization_id",
            sa.Integer(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "chat_agent_id",
            sa.Integer(),
            sa.ForeignKey("chat_agents.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("session_token", sa.String(length=128), nullable=False),
        sa.Column(
            "messages",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[]'::json"),
        ),
        sa.Column("origin", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_chat_conversations_token",
        "chat_conversations",
        ["session_token"],
        unique=True,
    )
    op.create_index(
        "ix_chat_conversations_agent", "chat_conversations", ["chat_agent_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_chat_conversations_agent", table_name="chat_conversations")
    op.drop_index("ix_chat_conversations_token", table_name="chat_conversations")
    op.drop_table("chat_conversations")
    op.drop_index("ix_chat_agents_public_key", table_name="chat_agents")
    op.drop_index("ix_chat_agents_org", table_name="chat_agents")
    op.drop_table("chat_agents")
