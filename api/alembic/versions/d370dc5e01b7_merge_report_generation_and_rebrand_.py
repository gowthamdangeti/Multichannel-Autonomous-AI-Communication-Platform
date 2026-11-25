"""merge_report_generation_and_rebrand_heads

Revision ID: d370dc5e01b7
Revises: a1b2c3d4e5f8, c0nv0z3nt011
Create Date: 2026-08-02 16:45:20.162475

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd370dc5e01b7'
down_revision: Union[str, None] = ('a1b2c3d4e5f8', 'c0nv0z3nt011')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
