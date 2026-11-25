"""add website_scraper to ToolCategory

Revision ID: b3c4d5e6f7a8
Revises: 029332ebbc0c
Create Date: 2026-09-22 10:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
from alembic_postgresql_enum import TableReference

# revision identifiers, used by Alembic.
revision: str = "b3c4d5e6f7a8"
down_revision: Union[str, None] = "029332ebbc0c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.sync_enum_values(
        enum_schema="public",
        enum_name="tool_category",
        new_values=[
            "http_api",
            "end_call",
            "transfer_call",
            "calculator",
            "native",
            "integration",
            "mcp",
            "website_scraper",
        ],
        affected_columns=[
            TableReference(
                table_schema="public", table_name="tools", column_name="category"
            )
        ],
        enum_values_to_rename=[],
    )


def downgrade() -> None:
    op.sync_enum_values(
        enum_schema="public",
        enum_name="tool_category",
        new_values=[
            "http_api",
            "end_call",
            "transfer_call",
            "calculator",
            "native",
            "integration",
            "mcp",
        ],
        affected_columns=[
            TableReference(
                table_schema="public", table_name="tools", column_name="category"
            )
        ],
        enum_values_to_rename=[],
    )