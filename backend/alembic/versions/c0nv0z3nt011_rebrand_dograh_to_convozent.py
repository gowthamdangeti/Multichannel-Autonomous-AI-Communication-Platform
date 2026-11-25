"""rebrand dograh -> convozent (columns + persisted config/usage values)

Renames the *_dograh_tokens quota/usage columns and rewrites persisted "dograh"
values (LLM provider/mode + usage keys) inside JSON config/usage columns so the
renamed enum value + column names line up with existing data.

Revision ID: c0nv0z3nt011
Revises: c0nv0z3nt010
Create Date: 2026-07-21
"""
from typing import Sequence, Union

from alembic import op

revision: str = "c0nv0z3nt011"
down_revision: Union[str, None] = "c0nv0z3nt010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# JSON columns that may contain "dograh" as a provider/mode value or usage key.
_JSON_COLUMNS = [
    ("organization_configurations", "value"),
    ("user_configurations", "configuration"),
    ("workflow_runs", "usage_info"),
    ("workflow_runs", "logs"),
]


def upgrade() -> None:
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='organizations' AND column_name='quota_dograh_tokens') THEN
                ALTER TABLE organizations RENAME COLUMN quota_dograh_tokens TO quota_convozent_tokens;
            END IF;
            IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='organization_usage_cycles' AND column_name='quota_dograh_tokens') THEN
                ALTER TABLE organization_usage_cycles RENAME COLUMN quota_dograh_tokens TO quota_convozent_tokens;
            END IF;
            IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='organization_usage_cycles' AND column_name='used_dograh_tokens') THEN
                ALTER TABLE organization_usage_cycles RENAME COLUMN used_dograh_tokens TO used_convozent_tokens;
            END IF;
        END $$;
    """)

    for table, column in _JSON_COLUMNS:
        op.execute(
            f"UPDATE {table} SET {column} = "
            f"replace({column}::text, 'dograh', 'convozent')::json "
            f"WHERE {column}::text LIKE '%dograh%'"
        )


def downgrade() -> None:
    for table, column in _JSON_COLUMNS:
        op.execute(
            f"UPDATE {table} SET {column} = "
            f"replace({column}::text, 'convozent', 'dograh')::json "
            f"WHERE {column}::text LIKE '%convozent%'"
        )

    op.alter_column(
        "organizations", "quota_convozent_tokens", new_column_name="quota_dograh_tokens"
    )
    op.alter_column(
        "organization_usage_cycles",
        "quota_convozent_tokens",
        new_column_name="quota_dograh_tokens",
    )
    op.alter_column(
        "organization_usage_cycles",
        "used_convozent_tokens",
        new_column_name="used_dograh_tokens",
    )
