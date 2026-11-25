"""add report_status_updated_at to workflow_runs

Revision ID: 2998d9a4eea9
Revises: c0nv0z3nt020
Create Date: 2026-10-10 18:40:45.248903

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '2998d9a4eea9'
down_revision: Union[str, None] = 'c0nv0z3nt020'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Autogenerate also flagged pre-existing drift (api_keys key_hash index,
    # users.is_2fa_enabled nullability); deliberately scoped to the new column.
    op.add_column(
        'workflow_runs',
        sa.Column('report_status_updated_at', sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('workflow_runs', 'report_status_updated_at')
