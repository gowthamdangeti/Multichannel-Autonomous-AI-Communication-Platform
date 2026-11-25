"""repair campaign target context keys

Revision ID: c0nv0z3nt015
Revises: c0nv0z3nt014
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c0nv0z3nt015"
down_revision: Union[str, None] = "c0nv0z3nt014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        sa.text(
            "UPDATE campaign_call_targets "
            "SET context_variables = COALESCE(("
            "  SELECT jsonb_object_agg(replace(key, chr(65279), ''), value) "
            "  FROM jsonb_each(context_variables::jsonb)"
            "), '{}'::jsonb)::json"
        )
    )


def downgrade() -> None:
    pass
