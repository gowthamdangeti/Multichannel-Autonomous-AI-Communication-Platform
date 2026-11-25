"""whatsapp agent allowed_contacts

Adds an allowed_contacts column to whatsapp_agents. When non-empty, the agent
only auto-responds to those contact numbers (empty = everyone).

Revision ID: c0nv0z3nt009
Revises: c0nv0z3nt008
Create Date: 2026-07-20
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c0nv0z3nt009"
down_revision: Union[str, None] = "c0nv0z3nt008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "whatsapp_agents",
        sa.Column(
            "allowed_contacts",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[]'::json"),
        ),
    )


def downgrade() -> None:
    op.drop_column("whatsapp_agents", "allowed_contacts")
