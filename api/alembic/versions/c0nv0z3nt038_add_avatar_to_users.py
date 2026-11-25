"""add avatar_key column to users

Revision ID: c0nv0z3nt038
Revises: c0nv0z3nt037
Create Date: 2026-11-12
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "c0nv0z3nt038"
down_revision: Union[str, None] = "c0nv0z3nt037"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    insp = sa.inspect(conn)
    cols = {c["name"] for c in insp.get_columns("users")}
    if "avatar_key" not in cols:
        op.add_column("users", sa.Column("avatar_key", sa.String(), nullable=True))


def downgrade() -> None:
    conn = op.get_bind()
    insp = sa.inspect(conn)
    cols = {c["name"] for c in insp.get_columns("users")}
    if "avatar_key" in cols:
        op.drop_column("users", "avatar_key")