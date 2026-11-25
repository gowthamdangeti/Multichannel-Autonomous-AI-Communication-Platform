"""merge billing hardening and enterprise leads heads

Revision ID: c0nv0z3nt021
Revises: c0nv0z3nt018, c0nv0z3nt019
Create Date: 2026-10-23 00:00:00.000000

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "c0nv0z3nt021"
down_revision: Union[str, Sequence[str], None] = "c0nv0z3nt019"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
