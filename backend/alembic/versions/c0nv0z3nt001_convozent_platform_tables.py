"""convozent platform tables

Adds three tables for the Convozent super-admin layer:
  - voice_catalog      : admin-curated TTS voices users can pick from
  - org_platform_config: per-org model/provider/key assignment by super-admin
  - org_subscriptions  : billing plan per org (schema now, billing logic later)

is_superuser already exists on the users table; no change needed there.

Revision ID: c0nv0z3nt001
Revises: 91cc6ba3e1c7
Create Date: 2026-06-19 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c0nv0z3nt001"
down_revision: Union[str, None] = "91cc6ba3e1c7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # voice_catalog
    # Admin-managed list of TTS voices available on the platform.
    # Users pick from voices that have been enabled for their org.
    # preview_audio_url: path in MinIO (or full URL) for a sample clip.
    # ------------------------------------------------------------------
    op.create_table(
        "voice_catalog",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("name", sa.String(64), nullable=False),
        sa.Column("provider", sa.String(32), nullable=False),
        sa.Column("voice_id", sa.String(128), nullable=False),
        sa.Column("language", sa.String(16), nullable=False, server_default="en"),
        sa.Column("gender", sa.String(16), nullable=True),
        sa.Column("accent", sa.String(64), nullable=True),
        sa.Column("preview_audio_url", sa.String(512), nullable=True),
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint("provider", "voice_id", name="uq_voice_catalog_provider_voice"),
    )
    op.create_index("ix_voice_catalog_provider", "voice_catalog", ["provider"])
    op.create_index("ix_voice_catalog_language", "voice_catalog", ["language"])
    op.create_index("ix_voice_catalog_is_active", "voice_catalog", ["is_active"])

    # ------------------------------------------------------------------
    # org_platform_config
    # Super-admin assigns which STT / LLM / TTS provider + encrypted key
    # each org uses. Users in that org inherit this config and cannot see
    # or change the underlying provider/key — only pick from allowed voices.
    #
    # llm_config / stt_config / tts_config: JSON blobs shaped like:
    #   { "provider": "google", "model": "gemini-3.1-flash-lite",
    #     "api_key": "<value>" }
    #
    # allowed_voice_ids: list of voice_catalog.id values the org's users
    #   may pick from.
    # channels_enabled: which product channels the org has access to.
    # ------------------------------------------------------------------
    op.create_table(
        "org_platform_config",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column(
            "organization_id",
            sa.Integer(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("llm_config", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("stt_config", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("tts_config", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column(
            "allowed_voice_ids",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[]'"),
            comment="List of voice_catalog.id values the org may use",
        ),
        sa.Column(
            "channels_enabled",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[\"voice\", \"widget\", \"chat\"]'"),
            comment="Enabled channels: voice, widget, chat, whatsapp, email",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_org_platform_config_org_id", "org_platform_config", ["organization_id"]
    )

    # ------------------------------------------------------------------
    # org_subscriptions
    # Billing plan per org. Schema only for now; billing logic added later.
    # status: trialing | active | past_due | cancelled
    # ------------------------------------------------------------------
    op.create_table(
        "org_subscriptions",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column(
            "organization_id",
            sa.Integer(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("plan_name", sa.String(64), nullable=False, server_default="starter"),
        sa.Column(
            "status",
            sa.String(32),
            nullable=False,
            server_default="trialing",
            comment="trialing | active | past_due | cancelled",
        ),
        sa.Column(
            "included_minutes",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("100"),
        ),
        sa.Column(
            "included_messages",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("1000"),
        ),
        sa.Column(
            "price_per_extra_minute",
            sa.Numeric(10, 4),
            nullable=False,
            server_default=sa.text("0.05"),
        ),
        sa.Column(
            "price_per_extra_message",
            sa.Numeric(10, 4),
            nullable=False,
            server_default=sa.text("0.001"),
        ),
        sa.Column("current_period_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("current_period_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_org_subscriptions_org_id", "org_subscriptions", ["organization_id"]
    )
    op.create_index("ix_org_subscriptions_status", "org_subscriptions", ["status"])


def downgrade() -> None:
    op.drop_index("ix_org_subscriptions_status", table_name="org_subscriptions")
    op.drop_index("ix_org_subscriptions_org_id", table_name="org_subscriptions")
    op.drop_table("org_subscriptions")

    op.drop_index("ix_org_platform_config_org_id", table_name="org_platform_config")
    op.drop_table("org_platform_config")

    op.drop_index("ix_voice_catalog_is_active", table_name="voice_catalog")
    op.drop_index("ix_voice_catalog_language", table_name="voice_catalog")
    op.drop_index("ix_voice_catalog_provider", table_name="voice_catalog")
    op.drop_table("voice_catalog")
