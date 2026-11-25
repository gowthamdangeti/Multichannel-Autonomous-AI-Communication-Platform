"""whatsapp agent character

Adds a ``character`` column to whatsapp_agents recording which persona preset
(or "custom") the agent was created from.

Revision ID: c0nv0z3nt008
Revises: c0nv0z3nt007
Create Date: 2026-07-20
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c0nv0z3nt008"
down_revision: Union[str, None] = "c0nv0z3nt007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "whatsapp_agents",
        sa.Column("character", sa.String(64), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("whatsapp_agents", "character")
