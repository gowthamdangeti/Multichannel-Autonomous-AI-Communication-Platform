"""agent utilisation policy + organization reporting hierarchy

Revision ID: c0nv0z3nt044
Revises: c0nv0z3nt043
Create Date: 2026-11-09 21:49:00.000000

Two related additions:

1. ``workflows.utilization_type`` — the agent utilisation policy
   (``public`` | ``private`` | ``closed``). Existing rows are backfilled to
   ``public`` so no agent loses its current organization-wide visibility.

2. ``teams`` / ``organization_memberships`` — the organization-scoped
   reporting hierarchy (``parent_user_id`` self-reference). CLOSED utilisation
   walks it recursively, and it is created here because the models had no
   migration yet.

Every step is guarded so the revision is safe to run against a database that
already has part of this schema.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c0nv0z3nt044"
down_revision: Union[str, None] = "c0nv0z3nt043"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = set(inspector.get_table_names())

    # 1. Agent utilisation policy on workflows.
    if "workflows" in tables:
        columns = {c["name"] for c in inspector.get_columns("workflows")}
        if "utilization_type" not in columns:
            op.add_column(
                "workflows",
                sa.Column("utilization_type", sa.String(16), nullable=True),
            )
        op.execute(
            "UPDATE workflows SET utilization_type = 'public' "
            "WHERE utilization_type IS NULL"
        )
        op.alter_column(
            "workflows",
            "utilization_type",
            nullable=False,
            server_default="public",
        )
        indexes = {i["name"] for i in inspector.get_indexes("workflows")}
        if "ix_workflows_utilization_type" not in indexes:
            op.create_index(
                "ix_workflows_utilization_type", "workflows", ["utilization_type"]
            )

    # 2. Organization-scoped reporting hierarchy.
    if "teams" not in tables:
        op.create_table(
            "teams",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "organization_id",
                sa.Integer(),
                sa.ForeignKey("organizations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("name", sa.String(120), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
            sa.UniqueConstraint("organization_id", "name", name="uq_teams_org_name"),
        )
        op.create_index("ix_teams_id", "teams", ["id"])
        op.create_index("ix_teams_organization_id", "teams", ["organization_id"])

    if "organization_memberships" not in tables:
        op.create_table(
            "organization_memberships",
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
                "team_id",
                sa.Integer(),
                sa.ForeignKey("teams.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "parent_user_id",
                sa.Integer(),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("role", sa.String(32), server_default="member", nullable=False),
            sa.UniqueConstraint(
                "organization_id", "user_id", name="uq_org_memberships_org_user"
            ),
        )
        op.create_index(
            "ix_organization_memberships_id", "organization_memberships", ["id"]
        )
        op.create_index(
            "ix_organization_memberships_organization_id",
            "organization_memberships",
            ["organization_id"],
        )
        op.create_index(
            "ix_organization_memberships_user_id",
            "organization_memberships",
            ["user_id"],
        )
        op.create_index(
            "ix_organization_memberships_team_id",
            "organization_memberships",
            ["team_id"],
        )
        op.create_index(
            "ix_organization_memberships_parent_user_id",
            "organization_memberships",
            ["parent_user_id"],
        )
        # Backs the recursive descendant lookup for CLOSED utilisation.
        op.create_index(
            "ix_org_memberships_parent_org",
            "organization_memberships",
            ["organization_id", "parent_user_id"],
        )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = set(inspector.get_table_names())

    if "organization_memberships" in tables:
        op.drop_table("organization_memberships")
    if "teams" in tables:
        op.drop_table("teams")

    if "workflows" in tables:
        indexes = {i["name"] for i in inspector.get_indexes("workflows")}
        if "ix_workflows_utilization_type" in indexes:
            op.drop_index("ix_workflows_utilization_type", table_name="workflows")
        columns = {c["name"] for c in inspector.get_columns("workflows")}
        if "utilization_type" in columns:
            op.drop_column("workflows", "utilization_type")
