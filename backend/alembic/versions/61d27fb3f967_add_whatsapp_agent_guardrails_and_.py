"""add WhatsApp agent guardrails and associations

Revision ID: 61d27fb3f967
Revises: c0nv0z3nt016
Create Date: 2026-09-28 17:15:10.451183

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = '61d27fb3f967'
down_revision: Union[str, None] = 'c0nv0z3nt016'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "whatsapp_agents",
        sa.Column("guardrails", sa.Text(), nullable=True),
    )
    op.create_table(
        "whatsapp_agent_tools",
        sa.Column("agent_id", sa.Integer(), nullable=False),
        sa.Column("tool_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["agent_id"], ["whatsapp_agents.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["tool_id"], ["tools.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("agent_id", "tool_id"),
    )
    op.create_table(
        "whatsapp_agent_documents",
        sa.Column("agent_id", sa.Integer(), nullable=False),
        sa.Column("document_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["agent_id"], ["whatsapp_agents.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["document_id"],
            ["knowledge_base_documents.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("agent_id", "document_id"),
    )


def downgrade() -> None:
    op.drop_table("whatsapp_agent_documents")
    op.drop_table("whatsapp_agent_tools")
    op.drop_column("whatsapp_agents", "guardrails")
