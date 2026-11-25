"""voice_previews: generated TTS preview audio per (provider, voice, model)

Revision ID: c0nv0z3nt031
Revises: c0nv0z3nt030

Platform rows (scope='global', organization_id NULL) are the curated previews
every organization can listen to; organization rows belong to the tenant whose
own provider key produced them.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c0nv0z3nt031"
down_revision: str | None = "c0nv0z3nt030"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    conn = op.get_bind()
    if "voice_previews" in set(sa.inspect(conn).get_table_names()):
        return

    op.create_table(
        "voice_previews",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "scope", sa.String(length=16), nullable=False, server_default="global"
        ),
        sa.Column("organization_id", sa.Integer(), nullable=True),
        sa.Column(
            "service_type", sa.String(length=8), nullable=False, server_default="tts"
        ),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("model", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("voice_id", sa.String(length=128), nullable=False),
        sa.Column("text_hash", sa.String(length=64), nullable=False),
        sa.Column(
            "sample_text", sa.String(length=500), nullable=False, server_default=""
        ),
        sa.Column("audio_key", sa.String(length=512), nullable=False),
        sa.Column(
            "content_type",
            sa.String(length=64),
            nullable=False,
            server_default="audio/mpeg",
        ),
        sa.Column(
            "byte_size", sa.Integer(), nullable=False, server_default=sa.text("0")
        ),
        sa.Column("render_ms", sa.Integer(), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["organization_id"], ["organizations.id"], ondelete="CASCADE"
        ),
        sa.UniqueConstraint(
            "scope",
            "organization_id",
            "provider",
            "voice_id",
            "model",
            "text_hash",
            name="uq_voice_previews_cache_key",
            postgresql_nulls_not_distinct=True,
        ),
        sa.CheckConstraint(
            "(scope = 'global' AND organization_id IS NULL) OR "
            "(scope = 'organization' AND organization_id IS NOT NULL)",
            name="ck_voice_previews_scope_organization",
        ),
    )
    op.create_index(
        "ix_voice_previews_provider_voice",
        "voice_previews",
        ["provider", "voice_id"],
    )
    op.create_index(
        "ix_voice_previews_scope_organization",
        "voice_previews",
        ["scope", "organization_id"],
    )
    op.create_index(
        "ix_voice_previews_organization_id", "voice_previews", ["organization_id"]
    )
    op.create_index("ix_voice_previews_id", "voice_previews", ["id"])


def downgrade() -> None:
    op.drop_index("ix_voice_previews_id", table_name="voice_previews")
    op.drop_index("ix_voice_previews_organization_id", table_name="voice_previews")
    op.drop_index("ix_voice_previews_scope_organization", table_name="voice_previews")
    op.drop_index("ix_voice_previews_provider_voice", table_name="voice_previews")
    op.drop_table("voice_previews")
