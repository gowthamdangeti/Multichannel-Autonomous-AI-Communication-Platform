"""add conversation_title to workflow_runs

Revision ID: c0nv0z3nt020
Revises: 2998d9a4eea9
Create Date: 2026-10-13 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'c0nv0z3nt020b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

down_revision: Union[str, None] = '2998d9a4eea9'


def upgrade() -> None:
    op.add_column(
        'workflow_runs',
        sa.Column('conversation_title', sa.String(length=120), nullable=True),
    )
    op.create_index(
        'idx_workflow_runs_conversation_title',
        'workflow_runs',
        ['workflow_id', 'conversation_title'],
    )


def downgrade() -> None:
    op.drop_index('idx_workflow_runs_conversation_title', table_name='workflow_runs')
    op.drop_column('workflow_runs', 'conversation_title')
