"""index usage events by operation so a provider request ID can be looked up

Revision ID: c0nv0z3nt036
Revises: c0nv0z3nt035

The existing unique index starts at workflow_run_id, so it can't serve a search
that begins from a provider's request ID. Built concurrently so live calls can
keep writing usage during the deploy.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "c0nv0z3nt036"
down_revision: str | None = "c0nv0z3nt035"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

INDEX_NAME = "ix_usage_event_operation_id"
TABLE_NAME = "workflow_run_usage_events"


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.create_index(
            INDEX_NAME,
            TABLE_NAME,
            ["operation_id"],
            postgresql_concurrently=True,
            if_not_exists=True,
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.drop_index(
            INDEX_NAME,
            table_name=TABLE_NAME,
            postgresql_concurrently=True,
            if_exists=True,
        )
