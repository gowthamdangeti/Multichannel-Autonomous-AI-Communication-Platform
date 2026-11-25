"""enterprise leads + org onboarding profiles (in-house, data residency)

Revision ID: c0nv0z3nt019
Revises: c0nv0z3nt018
(Standalone: creates two new tables only, no dependency on c0nv0z3nt018.)
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c0nv0z3nt019"
down_revision: Union[str, None] = "c0nv0z3nt018"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    insp = sa.inspect(conn)
    tables = set(insp.get_table_names())

    if "enterprise_leads" not in tables:
        op.create_table(
            "enterprise_leads",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("name", sa.String(length=256), nullable=False),
            sa.Column("company", sa.String(length=256), nullable=False),
            sa.Column("job_title", sa.String(length=256), nullable=False),
            sa.Column("work_email", sa.String(length=320), nullable=False),
            sa.Column("phone", sa.String(length=64), nullable=False),
            sa.Column("volume", sa.String(length=32), nullable=False, server_default="not-sure"),
            sa.Column("deployment", sa.String(length=32), nullable=False, server_default="yes"),
            sa.Column("agent_goal", sa.Text(), nullable=True),
            sa.Column("source", sa.String(length=64), nullable=False, server_default="landing_contact"),
            sa.Column("origin", sa.String(length=32), nullable=False, server_default="oss_app"),
            sa.Column("country", sa.String(length=128), nullable=True),
            sa.Column("status", sa.String(length=32), nullable=False, server_default="new"),
            sa.Column("contacted_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("contacted_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_enterprise_leads_created_at", "enterprise_leads", ["created_at"])
        op.create_index("ix_enterprise_leads_status", "enterprise_leads", ["status"])
        op.create_index("ix_enterprise_leads_work_email", "enterprise_leads", ["work_email"])
        op.create_index("ix_enterprise_leads_source", "enterprise_leads", ["source"])

    if "org_onboarding_profiles" not in tables:
        op.create_table(
            "org_onboarding_profiles",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, unique=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("email", sa.String(length=320), nullable=True),
            sa.Column("persona", sa.String(length=64), nullable=True),
            sa.Column("onprem_need", sa.String(length=32), nullable=True),
            sa.Column("migrating_from", sa.String(length=64), nullable=True),
            sa.Column("migrating_other_provider", sa.String(length=256), nullable=True),
            sa.Column("switch_reason", sa.Text(), nullable=True),
            sa.Column("how_heard", sa.String(length=64), nullable=True),
            sa.Column("volume", sa.String(length=32), nullable=True),
            sa.Column("country", sa.String(length=128), nullable=True),
            sa.Column("origin", sa.String(length=32), nullable=False, server_default="oss_app"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_org_onboarding_profiles_org_id", "org_onboarding_profiles", ["organization_id"])
        op.create_index("ix_org_onboarding_profiles_email", "org_onboarding_profiles", ["email"])


def downgrade() -> None:
    op.drop_index("ix_org_onboarding_profiles_email", table_name="org_onboarding_profiles")
    op.drop_index("ix_org_onboarding_profiles_org_id", table_name="org_onboarding_profiles")
    op.drop_table("org_onboarding_profiles")
    op.drop_index("ix_enterprise_leads_source", table_name="enterprise_leads")
    op.drop_index("ix_enterprise_leads_work_email", table_name="enterprise_leads")
    op.drop_index("ix_enterprise_leads_status", table_name="enterprise_leads")
    op.drop_index("ix_enterprise_leads_created_at", table_name="enterprise_leads")
    op.drop_table("enterprise_leads")
