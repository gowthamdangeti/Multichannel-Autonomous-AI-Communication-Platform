"""add conversation_title to chat_conversations

A short display title per chat conversation, generated once the visitor's
session ends (the chat counterpart of workflow_runs.conversation_title).

Revision ID: c0nv0z3nt043
Revises: c0nv0z3nt042
Create Date: 2026-11-17
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "c0nv0z3nt043"
down_revision: Union[str, None] = "c0nv0z3nt042"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _existing() -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns("chat_conversations")}


def upgrade() -> None:
    if "conversation_title" not in _existing():
        op.add_column(
            "chat_conversations", sa.Column("conversation_title", sa.String(120), nullable=True)
        )


def downgrade() -> None:
    if "conversation_title" in _existing():
        op.drop_column("chat_conversations", "conversation_title")
