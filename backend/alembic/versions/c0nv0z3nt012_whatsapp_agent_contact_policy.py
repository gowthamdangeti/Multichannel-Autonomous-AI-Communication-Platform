"""rename WhatsApp active contacts and add deactive contacts

The existing ``allowed_contacts`` allowlist is renamed to ``active_contacts``
and a separate ``deactive_contacts`` denylist is added. An empty active list
means all contacts are eligible unless they are explicitly deactivated.
"""


from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op

revision: str = "c0nv0z3nt012"
down_revision: Union[str, None] = "f7c2a91d4b60"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "whatsapp_agents",
        "allowed_contacts",
        new_column_name="active_contacts",
    )
    op.add_column(
        "whatsapp_agents",
        sa.Column(
            "deactive_contacts",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[]'::json"),
        ),
    )


def downgrade() -> None:
    op.drop_column("whatsapp_agents", "deactive_contacts")
    op.alter_column(
        "whatsapp_agents",
        "active_contacts",
        new_column_name="allowed_contacts",
    )
