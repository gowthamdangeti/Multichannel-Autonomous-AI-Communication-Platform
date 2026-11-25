"""provider_model_catalog: models a provider reported through its own API

Revision ID: c0nv0z3nt035
Revises: c0nv0z3nt034

No row means the model list in code is used. A model the provider stops
listing is marked deprecated, never deleted, so saved agents keep working.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c0nv0z3nt035"
down_revision: str | None = "c0nv0z3nt034"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "provider_model_catalog",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("provider", sa.String(32), nullable=False),
        sa.Column("capability", sa.String(16), nullable=False),
        sa.Column("model_id", sa.String(256), nullable=False),
        sa.Column("display_name", sa.String(256), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="active"),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint(
            "provider", "capability", "model_id", name="uq_provider_model_catalog_key"
        ),
        sa.CheckConstraint(
            "capability IN ('llm', 'tts', 'stt', 'realtime')", name="ck_provider_model_capability"
        ),
        sa.CheckConstraint("status IN ('active', 'deprecated')", name="ck_provider_model_status"),
    )
    op.create_index(
        "ix_provider_model_catalog_provider", "provider_model_catalog", ["provider", "capability"]
    )


def downgrade() -> None:
    op.drop_index("ix_provider_model_catalog_provider", table_name="provider_model_catalog")
    op.drop_table("provider_model_catalog")
