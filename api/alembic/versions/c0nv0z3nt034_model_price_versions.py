"""model_price_versions: dated provider prices per model and billing component

Revision ID: c0nv0z3nt034
Revises: c0nv0z3nt033

Rows are never edited in place. A new price closes the old row, so a later
price change can't rewrite what an earlier call cost.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c0nv0z3nt034"
down_revision: str | None = "c0nv0z3nt033"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "model_price_versions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("provider", sa.String(32), nullable=False),
        sa.Column("capability", sa.String(16), nullable=False),
        sa.Column("model_id", sa.String(256), nullable=False),
        sa.Column("component", sa.String(32), nullable=False),
        sa.Column("rate", sa.Numeric(20, 10), nullable=False),
        sa.Column("unit_quantity", sa.Integer(), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False, server_default="USD"),
        sa.Column("tier", sa.String(64), nullable=True),
        sa.Column("source", sa.String(16), nullable=False),
        sa.Column("source_url", sa.String(512), nullable=True),
        sa.Column("note", sa.String(256), nullable=True),
        sa.Column("review_status", sa.String(16), nullable=False, server_default="approved"),
        sa.Column("reviewed_by", sa.Integer(), nullable=True),
        sa.Column("effective_from", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("effective_to", sa.DateTime(timezone=True), nullable=True),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["reviewed_by"], ["users.id"], ondelete="SET NULL"),
        sa.CheckConstraint(
            "capability IN ('llm', 'tts', 'stt', 'realtime')", name="ck_price_capability"
        ),
        sa.CheckConstraint(
            "source IN ('admin', 'provider_api', 'official', 'feed')", name="ck_price_source"
        ),
        sa.CheckConstraint(
            "review_status IN ('approved', 'pending', 'rejected')", name="ck_price_review_status"
        ),
        sa.CheckConstraint("rate >= 0", name="ck_price_rate_not_negative"),
        sa.CheckConstraint("unit_quantity > 0", name="ck_price_unit_positive"),
    )
    op.create_index(
        "ix_model_price_lookup",
        "model_price_versions",
        ["provider", "capability", "model_id", "review_status"],
    )
    op.create_index(
        "uq_model_price_active",
        "model_price_versions",
        ["provider", "capability", "model_id", "component", "source"],
        unique=True,
        postgresql_where=sa.text("review_status = 'approved' AND effective_to IS NULL"),
    )
    op.create_index(
        "uq_model_price_pending",
        "model_price_versions",
        ["provider", "capability", "model_id", "component", "source"],
        unique=True,
        postgresql_where=sa.text("review_status = 'pending'"),
    )


def downgrade() -> None:
    op.drop_index("uq_model_price_pending", table_name="model_price_versions")
    op.drop_index("uq_model_price_active", table_name="model_price_versions")
    op.drop_index("ix_model_price_lookup", table_name="model_price_versions")
    op.drop_table("model_price_versions")
