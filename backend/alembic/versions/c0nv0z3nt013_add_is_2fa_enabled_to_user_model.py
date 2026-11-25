"""add_is_2fa_enabled_to_user_model

Revision ID: c0nv0z3nt016
Revises: c0nv0z3nt015
Create Date: 2026-09-22 13:28:00.000000

"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'c0nv0z3nt016'
down_revision = 'c0nv0z3nt015'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    insp = sa.inspect(conn)
    cols = [c['name'] for c in insp.get_columns('users')]
    if 'is_2fa_enabled' not in cols:
        op.add_column(
            'users',
            sa.Column('is_2fa_enabled', sa.Boolean(), server_default='false', nullable=False)
        )


def downgrade():
    op.drop_column('users', 'is_2fa_enabled')
