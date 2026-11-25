"""add WhatsApp agent media settings (image, document, audio)

Revision ID: c0nv0z3nt020
Revises: 61d27fb3f967
Create Date: 2026-10-15 10:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'c0nv0z3nt020'
down_revision: Union[str, None] = '61d27fb3f967'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# ── default JSON values ──────────────────────────────────────────────────────
# Use PostgreSQL json_build_object for robust string escaping.

IMAGE_DEFAULT_SQL = (
    "json_build_object("
    "'enabled', true, "
    "'max_files', 20, "
    "'max_file_size_mb', 100, "
    "'allowed_extensions', json_build_array('.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.heic')"
    ")"
)

DOCUMENT_DEFAULT_SQL = (
    "json_build_object("
    "'enabled', true, "
    "'max_files', 20, "
    "'max_file_size_mb', 100, "
    "'allowed_extensions', json_build_array('.pdf', '.doc', '.docx', '.txt', '.csv', '.xlsx', '.pptx')"
    ")"
)

AUDIO_DEFAULT_SQL = (
    "json_build_object("
    "'enabled', true, "
    "'max_files', 20, "
    "'max_file_size_mb', 100, "
    "'allowed_extensions', json_build_array('.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac')"
    ")"
)


def upgrade() -> None:
    op.add_column(
        "whatsapp_agents",
        sa.Column(
            "image_settings",
            sa.JSON(),
            nullable=False,
            server_default=sa.text(IMAGE_DEFAULT_SQL),
        ),
    )
    op.add_column(
        "whatsapp_agents",
        sa.Column(
            "document_settings",
            sa.JSON(),
            nullable=False,
            server_default=sa.text(DOCUMENT_DEFAULT_SQL),
        ),
    )
    op.add_column(
        "whatsapp_agents",
        sa.Column(
            "audio_settings",
            sa.JSON(),
            nullable=False,
            server_default=sa.text(AUDIO_DEFAULT_SQL),
        ),
    )


def downgrade() -> None:
    op.drop_column("whatsapp_agents", "audio_settings")
    op.drop_column("whatsapp_agents", "document_settings")
    op.drop_column("whatsapp_agents", "image_settings")