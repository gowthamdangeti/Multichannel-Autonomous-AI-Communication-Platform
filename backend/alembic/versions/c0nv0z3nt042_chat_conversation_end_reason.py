"""add end_reason and ended_at to chat_conversations

end_reason: how the visitor's session ended, reported by the widget
("completed" on Exit, "disconnected" when the tab is closed or refreshed).
ended_at: when that end was recorded.

Revision ID: c0nv0z3nt042
Revises: c0nv0z3nt041
Create Date: 2026-11-17
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "c0nv0z3nt042"
down_revision: Union[str, None] = "c0nv0z3nt041"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _existing() -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns("chat_conversations")}


def upgrade() -> None:
    existing = _existing()
    if "end_reason" not in existing:
        op.add_column("chat_conversations", sa.Column("end_reason", sa.String(16), nullable=True))
    if "ended_at" not in existing:
        op.add_column(
            "chat_conversations", sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True)
        )


def downgrade() -> None:
    existing = _existing()
    for name in ("ended_at", "end_reason"):
        if name in existing:
            op.drop_column("chat_conversations", name)
