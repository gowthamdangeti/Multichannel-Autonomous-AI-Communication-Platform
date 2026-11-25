"""add initial_context and qa_results to chat_conversations

initial_context: the runtime configuration (model preset, providers, language)
recorded when the visitor session starts. qa_results: the latest saved
conversation-completeness evaluation.

Revision ID: c0nv0z3nt041
Revises: c0nv0z3nt040
Create Date: 2026-11-17
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "c0nv0z3nt041"
down_revision: Union[str, None] = "c0nv0z3nt040"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_COLUMNS = ("initial_context", "qa_results")


def upgrade() -> None:
    existing = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("chat_conversations")}
    for name in _COLUMNS:
        if name not in existing:
            op.add_column("chat_conversations", sa.Column(name, sa.JSON(), nullable=True))


def downgrade() -> None:
    existing = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("chat_conversations")}
    for name in _COLUMNS:
        if name in existing:
            op.drop_column("chat_conversations", name)
