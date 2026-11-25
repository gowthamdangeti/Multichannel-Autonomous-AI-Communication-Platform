"""private-policy explicit grants: workflows.private_allowed_user_ids

Revision ID: c0nv0z3nt045
Revises: c0nv0z3nt044
Create Date: 2026-11-11 12:00:00.000000

Adds the explicit-grant list for PRIVATE agents. A private agent is reachable by
its creator and by every user id stored here. Existing rows are backfilled to an
empty array, so no private agent silently gains or loses access.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "c0nv0z3nt045"
down_revision: Union[str, None] = "c0nv0z3nt044"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if "workflows" not in set(inspector.get_table_names()):
        return

    columns = {c["name"] for c in inspector.get_columns("workflows")}
    if "private_allowed_user_ids" not in columns:
        op.add_column(
            "workflows",
            sa.Column(
                "private_allowed_user_ids",
                JSONB,
                nullable=False,
                server_default=sa.text("'[]'::jsonb"),
            ),
        )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if "workflows" not in set(inspector.get_table_names()):
        return

    columns = {c["name"] for c in inspector.get_columns("workflows")}
    if "private_allowed_user_ids" in columns:
        op.drop_column("workflows", "private_allowed_user_ids")