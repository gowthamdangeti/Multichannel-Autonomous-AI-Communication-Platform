"""whatsapp conversations

Adds whatsapp_conversations: the rolling chat transcript per (number, contact)
that drives the agent's replies.

Revision ID: c0nv0z3nt007
Revises: c0nv0z3nt006
Create Date: 2026-07-19
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c0nv0z3nt007"
down_revision: Union[str, None] = "c0nv0z3nt006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "whatsapp_conversations",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column(
            "organization_id",
            sa.Integer(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "number_id",
            sa.Integer(),
            sa.ForeignKey("whatsapp_numbers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("contact", sa.String(64), nullable=False),
        sa.Column(
            "messages", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint(
            "number_id", "contact", name="uq_whatsapp_conversations_number_contact"
        ),
    )
    op.create_index(
        "ix_whatsapp_conversations_number", "whatsapp_conversations", ["number_id"]
    )


def downgrade() -> None:
    op.drop_index(
        "ix_whatsapp_conversations_number", table_name="whatsapp_conversations"
    )
    op.drop_table("whatsapp_conversations")
