"""fix pricing rules: narrow the GPT-4 pattern and store Soniox rates

Revision ID: c0nv0z3nt033
Revises: c0nv0z3nt032

The pattern ``gpt-4`` also matched ``gpt-4.1``, the OpenAI default, and priced
it as legacy GPT-4. Soniox rates lived in the UI, where every user could read
them; they now live here. They are the effective rates from Soniox's published
token prices and averages. Rules an admin already edited are left alone.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "c0nv0z3nt033"
down_revision: str | None = "c0nv0z3nt032"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

NARROW_GPT4_PATTERN = "^gpt-4($|-[0-9])"


def upgrade() -> None:
    op.execute(
        f"UPDATE model_pricing_rules SET pattern = '{NARROW_GPT4_PATTERN}' "
        "WHERE service_type = 'llm' AND pattern = 'gpt-4'"
    )
    op.execute(
        "UPDATE model_pricing_rules SET unit_rate = 0.002 "
        "WHERE service_type = 'stt' AND pattern = 'soniox' AND unit_rate = 0.0033"
    )
    op.execute(
        "INSERT INTO model_pricing_rules "
        "(service_type, label, pattern, input_rate, output_rate, unit_rate, sort_order) "
        "SELECT 'tts', 'Soniox TTS', 'soniox', 0, 0, 14.1, 160 "
        "WHERE NOT EXISTS (SELECT 1 FROM model_pricing_rules "
        "WHERE service_type = 'tts' AND pattern = 'soniox')"
    )


def downgrade() -> None:
    op.execute(
        "DELETE FROM model_pricing_rules "
        "WHERE service_type = 'tts' AND label = 'Soniox TTS' AND unit_rate = 14.1"
    )
    op.execute(
        "UPDATE model_pricing_rules SET unit_rate = 0.0033 "
        "WHERE service_type = 'stt' AND pattern = 'soniox' AND unit_rate = 0.002"
    )
    op.execute(
        "UPDATE model_pricing_rules SET pattern = 'gpt-4' "
        f"WHERE service_type = 'llm' AND pattern = '{NARROW_GPT4_PATTERN}'"
    )
