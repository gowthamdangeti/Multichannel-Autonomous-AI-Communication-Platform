"""add model_pricing_rules table with seed data

Revision ID: c0nv0z3nt022
Revises: c0nv0z3nt021
Create Date: 2026-10-28 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "c0nv0z3nt022"
down_revision: Union[str, None] = "c0nv0z3nt021"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "model_pricing_rules",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("service_type", sa.String(8), nullable=False, comment="llm | tts | stt"),
        sa.Column("label", sa.String(128), nullable=False),
        sa.Column("pattern", sa.String(256), nullable=False),
        sa.Column("input_rate", sa.Numeric(12, 6), nullable=False, server_default="0"),
        sa.Column("output_rate", sa.Numeric(12, 6), nullable=False, server_default="0"),
        sa.Column("unit_rate", sa.Numeric(12, 6), nullable=False, server_default="0"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.CheckConstraint("service_type IN ('llm', 'tts', 'stt')", name="ck_pricing_service_type"),
    )
    op.create_index("ix_model_pricing_rules_service_type", "model_pricing_rules", ["service_type"])
    op.create_index("ix_model_pricing_rules_sort_order", "model_pricing_rules", ["sort_order"])

    # Seed default pricing rules so the system works out of the box.
    # Sorted: specific patterns first (lower sort_order = higher priority).
    op.execute("""
        INSERT INTO model_pricing_rules (service_type, label, pattern, input_rate, output_rate, unit_rate, sort_order) VALUES
        -- OpenAI LLM (specific before general)
        ('llm', 'GPT-4o Mini',             'gpt-4o-mini',       0.150000, 0.600000, 0, 100),
        ('llm', 'GPT-4o',                  'gpt-4o',            2.500000, 10.000000, 0, 110),
        ('llm', 'GPT-4 Turbo',             'gpt-4-turbo',       10.000000, 30.000000, 0, 120),
        ('llm', 'GPT-4 family',            'gpt-4',             30.000000, 60.000000, 0, 130),
        ('llm', 'GPT-3.5 family',          'gpt-3\\.?5',       0.500000, 1.500000, 0, 140),
        ('llm', 'O1 Mini',                 '\\bo1-mini',        3.000000, 12.000000, 0, 150),
        ('llm', 'O1',                      '\\bo1\\b',          15.000000, 60.000000, 0, 160),
        ('llm', 'O3 Mini',                 '\\bo3-mini',        1.100000, 4.400000, 0, 170),
        ('llm', 'O3',                      '\\bo3\\b',          10.000000, 40.000000, 0, 180),
        ('llm', 'O4 Mini',                 '\\bo4-mini',        1.100000, 4.400000, 0, 190),
        -- Anthropic LLM
        ('llm', 'Claude Haiku family',     'claude.*haiku',     0.800000, 4.000000, 0, 200),
        ('llm', 'Claude Opus family',      'claude.*opus',      15.000000, 75.000000, 0, 210),
        ('llm', 'Claude Sonnet family',    'claude.*sonnet',    3.000000, 15.000000, 0, 220),
        -- Google LLM (flash-8b before flash, pro last)
        ('llm', 'Gemini Flash 8B family',  'gemini.*flash-8b',  0.037500, 0.150000, 0, 300),
        ('llm', 'Gemini Flash family',     'gemini.*flash',     0.150000, 0.600000, 0, 310),
        ('llm', 'Gemini Pro family',       'gemini.*pro',       1.250000, 10.000000, 0, 320),
        -- Meta / Groq
        ('llm', 'LLaMA 70B+ family',      'llama.*70b',        0.590000, 0.790000, 0, 400),
        ('llm', 'LLaMA 8B family',        'llama.*8b',         0.050000, 0.080000, 0, 410),
        ('llm', 'LLaMA (other)',           'llama',             0.200000, 0.400000, 0, 420),
        -- DeepSeek
        ('llm', 'DeepSeek R1',            'deepseek.*r1',      0.550000, 2.190000, 0, 500),
        ('llm', 'DeepSeek (other)',        'deepseek',          0.140000, 0.280000, 0, 510),
        -- Sarvam
        ('llm', 'Sarvam family',          'sarvam',            0.100000, 0.300000, 0, 600),
        -- Mistral
        ('llm', 'Mistral Large',          'mistral.*large',    2.000000, 6.000000, 0, 700),
        ('llm', 'Mistral (other)',        'mistral',           0.250000, 0.250000, 0, 710),

        -- TTS providers (unit_rate = per 1M chars)
        ('tts', 'ElevenLabs',             'elevenlabs|eleven',  0, 0, 15.000000, 100),
        ('tts', 'Cartesia',               'cartesia',           0, 0, 38.000000, 110),
        ('tts', 'OpenAI TTS',             'openai',             0, 0, 15.000000, 120),
        ('tts', 'Deepgram TTS',           'deepgram',           0, 0, 15.000000, 130),
        ('tts', 'Sarvam TTS',             'sarvam',             0, 0, 12.000000, 140),
        ('tts', 'NeuTTS (local)',         'neutts',             0, 0, 0.000000,  150),

        -- STT providers (unit_rate = per minute)
        ('stt', 'Deepgram STT',           'deepgram',           0, 0, 0.004300, 100),
        ('stt', 'Soniox STT',             'soniox',             0, 0, 0.003300, 110),
        ('stt', 'Whisper STT',            'whisper',            0, 0, 0.006000, 120),
        ('stt', 'Sarvam STT',             'sarvam',             0, 0, 0.005000, 130);
    """)


def downgrade() -> None:
    op.drop_table("model_pricing_rules")
