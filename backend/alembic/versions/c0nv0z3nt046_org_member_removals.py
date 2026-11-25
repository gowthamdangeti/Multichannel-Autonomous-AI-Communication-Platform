"""explicit organization member removals

Revision ID: c0nv0z3nt046
Revises: c0nv0z3nt045
Create Date: 2026-11-16 12:00:00.000000

Adds ``organization_member_removals``: one row per (organization, user) that an
administrator explicitly removed. ``sync_organization_members`` backfills a
membership for every user still linked to the organization, so without this
marker a removed member reappears on the next member list call.

No existing data is touched: the table starts empty, meaning "nothing has been
explicitly removed yet", which preserves the current synchronization behaviour
for every organization.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c0nv0z3nt046"
down_revision: Union[str, None] = "c0nv0z3nt045"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = set(inspector.get_table_names())
    if "organization_member_removals" in tables:
        return

    op.create_table(
        "organization_member_removals",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "organization_id",
            sa.Integer(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "removed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint(
            "organization_id", "user_id", name="uq_org_member_removals_org_user"
        ),
    )
    op.create_index(
        "ix_organization_member_removals_id", "organization_member_removals", ["id"]
    )
    op.create_index(
        "ix_organization_member_removals_organization_id",
        "organization_member_removals",
        ["organization_id"],
    )
    op.create_index(
        "ix_organization_member_removals_user_id",
        "organization_member_removals",
        ["user_id"],
    )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if "organization_member_removals" not in set(inspector.get_table_names()):
        return
    op.drop_table("organization_member_removals")