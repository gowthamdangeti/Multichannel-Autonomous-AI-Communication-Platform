"""provider_language_catalog: live language lists fetched from provider APIs

Revision ID: c0nv0z3nt030
Revises: c0nv0z3nt019

Numbered 030 on purpose: branch fix/v3-api-keys already uses c0nv0z3nt021-023.
Whichever branch merges into convozent-v3 second must point its first new
migration's down_revision at the other branch's head (or add an alembic merge
revision), so the chain stays linear.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c0nv0z3nt030"
down_revision: Union[str, None] = "c0nv0z3nt023"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    if "provider_language_catalog" in set(sa.inspect(conn).get_table_names()):
        return

    op.create_table(
        "provider_language_catalog",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("capability", sa.String(length=16), nullable=False),
        sa.Column("model", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("codes", sa.JSON(), nullable=False),
        sa.Column("voice_counts", sa.JSON(), nullable=True),
        sa.Column("pending_codes", sa.JSON(), nullable=True),
        sa.Column("pending_reason", sa.String(length=256), nullable=True),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint(
            "provider", "capability", "model", name="uq_provider_language_catalog_key"
        ),
    )
    op.create_index(
        "ix_provider_language_catalog_id", "provider_language_catalog", ["id"]
    )
    op.create_index(
        "ix_provider_language_catalog_provider",
        "provider_language_catalog",
        ["provider", "capability"],
    )


def downgrade() -> None:
    op.drop_index("ix_provider_language_catalog_provider", table_name="provider_language_catalog")
    op.drop_index("ix_provider_language_catalog_id", table_name="provider_language_catalog")
    op.drop_table("provider_language_catalog")
