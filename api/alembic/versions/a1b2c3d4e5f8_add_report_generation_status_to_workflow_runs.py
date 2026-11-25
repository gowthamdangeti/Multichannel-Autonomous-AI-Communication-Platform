"""add report_generation_status to workflow_runs

Revision ID: a1b2c3d4e5f8
Revises: a1b2c3d4e5f7
Create Date: 2025-08-07 12:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f8"
down_revision: Union[str, Sequence[str], None] = "a1b2c3d4e5f7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "workflow_runs",
        sa.Column("report_generation_status", sa.String(16), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("workflow_runs", "report_generation_status")
