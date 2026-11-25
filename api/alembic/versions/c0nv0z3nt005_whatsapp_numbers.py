"""whatsapp numbers

Adds whatsapp_numbers: one row per WhatsApp number an organization connects
through the OpenWA gateway (one OpenWA session each). Tracks the connection
lifecycle status and the gateway session identifiers.

Revision ID: c0nv0z3nt005
Revises: c0nv0z3nt004
Create Date: 2026-07-19
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c0nv0z3nt005"
down_revision: Union[str, None] = "c0nv0z3nt004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "whatsapp_numbers",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column(
            "organization_id",
            sa.Integer(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(64), nullable=False),
        sa.Column("phone_number", sa.String(32), nullable=True),
        sa.Column("openwa_session_name", sa.String(64), nullable=False),
        sa.Column("openwa_session_id", sa.String(128), nullable=True),
        sa.Column(
            "status",
            sa.String(24),
            nullable=False,
            server_default=sa.text("'created'"),
        ),
        sa.Column(
            "extra_metadata",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'{}'::json"),
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=True
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=True
        ),
        sa.UniqueConstraint(
            "organization_id", "name", name="uq_whatsapp_numbers_org_name"
        ),
        sa.UniqueConstraint(
            "openwa_session_name", name="uq_whatsapp_numbers_session_name"
        ),
    )
    op.create_index(
        "ix_whatsapp_numbers_org", "whatsapp_numbers", ["organization_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_whatsapp_numbers_org", table_name="whatsapp_numbers")
    op.drop_table("whatsapp_numbers")
