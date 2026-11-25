"""add report_s3_key to workflow_runs (merge all heads)

Revision ID: a1b2c3d4e5f7
Revises: c0nv0z3nt004, f2e1d0c9b8a7
Create Date: 2025-08-06 17:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f7"
down_revision: Union[str, Sequence[str], None] = (
    "c0nv0z3nt004",
    "f2e1d0c9b8a7",
)
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "workflow_runs",
        sa.Column("report_s3_key", sa.String(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("workflow_runs", "report_s3_key")
