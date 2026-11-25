"""add last_error to chat_conversations

Records why the assistant could not reply (model or configuration error) so a
conversation can show an error status. Cleared by the next successful reply.

Revision ID: c0nv0z3nt040
Revises: c0nv0z3nt039
Create Date: 2026-11-17
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "c0nv0z3nt040"
down_revision: Union[str, None] = "c0nv0z3nt039"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    cols = {c["name"] for c in sa.inspect(conn).get_columns("chat_conversations")}
    if "last_error" not in cols:
        op.add_column("chat_conversations", sa.Column("last_error", sa.JSON(), nullable=True))


def downgrade() -> None:
    conn = op.get_bind()
    cols = {c["name"] for c in sa.inspect(conn).get_columns("chat_conversations")}
    if "last_error" in cols:
        op.drop_column("chat_conversations", "last_error")
