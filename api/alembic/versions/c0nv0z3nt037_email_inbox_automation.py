"""email_inbox_automation: models for rules, follow-ups, attachments, digests and triage

Revision ID: c0nv0z3nt037
Revises: c0nv0z3nt036
Create Date: 2026-11-05 11:15:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "c0nv0z3nt037"
down_revision: Union[str, None] = "c0nv0z3nt036"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    insp = sa.inspect(conn)
    tables = set(insp.get_table_names())

    # 1. gmail_accounts (if not already existing)
    if "gmail_accounts" not in tables:
        op.create_table(
            "gmail_accounts",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
            sa.Column("email", sa.String(length=320), nullable=False),
            sa.Column("refresh_token_encrypted", sa.Text(), nullable=False),
            sa.Column("access_token_encrypted", sa.Text(), nullable=True),
            sa.Column("access_token_expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("history_id", sa.String(length=32), nullable=True),
            sa.Column("status", sa.String(length=24), nullable=False, server_default="connected"),
            sa.Column("extra_metadata", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.UniqueConstraint("organization_id", "email", name="uq_gmail_accounts_org_email"),
        )
        op.create_index("ix_gmail_accounts_org", "gmail_accounts", ["organization_id"])
        op.create_index("ix_gmail_accounts_id", "gmail_accounts", ["id"])

    # 2. outlook_accounts (if not already existing)
    if "outlook_accounts" not in tables:
        op.create_table(
            "outlook_accounts",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
            sa.Column("email", sa.String(length=320), nullable=False),
            sa.Column("refresh_token_encrypted", sa.Text(), nullable=False),
            sa.Column("access_token_encrypted", sa.Text(), nullable=True),
            sa.Column("access_token_expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("delta_link", sa.Text(), nullable=True),
            sa.Column("status", sa.String(length=24), nullable=False, server_default="connected"),
            sa.Column("extra_metadata", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.UniqueConstraint("organization_id", "email", name="uq_outlook_accounts_org_email"),
        )
        op.create_index("ix_outlook_accounts_org", "outlook_accounts", ["organization_id"])
        op.create_index("ix_outlook_accounts_id", "outlook_accounts", ["id"])

    # 3. email_agents (if not already existing)
    if "email_agents" not in tables:
        op.create_table(
            "email_agents",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
            sa.Column("name", sa.String(length=64), nullable=False),
            sa.Column("description", sa.String(length=512), nullable=True),
            sa.Column("system_prompt", sa.Text(), nullable=False, server_default=""),
            sa.Column("gmail_account_id", sa.Integer(), sa.ForeignKey("gmail_accounts.id", ondelete="SET NULL"), nullable=True),
            sa.Column("outlook_account_id", sa.Integer(), sa.ForeignKey("outlook_accounts.id", ondelete="SET NULL"), nullable=True),
            sa.Column("model_config_ref", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.Column("auto_reply_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.UniqueConstraint("organization_id", "name", name="uq_email_agents_org_name"),
        )
        op.create_index("ix_email_agents_org", "email_agents", ["organization_id"])
        op.create_index("ix_email_agents_account", "email_agents", ["gmail_account_id"])
        op.create_index("ix_email_agents_outlook_account", "email_agents", ["outlook_account_id"])
        op.create_index("ix_email_agents_id", "email_agents", ["id"])

    # 4. email_messages (if not already existing)
    if "email_messages" not in tables:
        op.create_table(
            "email_messages",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
            sa.Column("gmail_account_id", sa.Integer(), sa.ForeignKey("gmail_accounts.id", ondelete="CASCADE"), nullable=True),
            sa.Column("outlook_account_id", sa.Integer(), sa.ForeignKey("outlook_accounts.id", ondelete="CASCADE"), nullable=True),
            sa.Column("provider", sa.String(length=16), nullable=False, server_default="gmail"),
            sa.Column("gmail_message_id", sa.String(length=32), nullable=False),
            sa.Column("gmail_thread_id", sa.String(length=32), nullable=True),
            sa.Column("subject", sa.String(length=1024), nullable=True),
            sa.Column("sender", sa.String(length=320), nullable=True),
            sa.Column("snippet", sa.String(length=2048), nullable=True),
            sa.Column("body_text", sa.Text(), nullable=True),
            sa.Column("body_html", sa.Text(), nullable=True),
            sa.Column("gmail_labels", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")),
            sa.Column("headers", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
            sa.Column("internal_date", sa.DateTime(timezone=True), nullable=True),
            sa.Column("ai_category", sa.String(length=48), nullable=True),
            sa.Column("ai_priority", sa.String(length=16), nullable=True),
            sa.Column("is_read", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("is_archived", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.UniqueConstraint("organization_id", "gmail_account_id", "gmail_message_id", name="uq_email_messages_gmail_account_message"),
            sa.UniqueConstraint("organization_id", "outlook_account_id", "gmail_message_id", name="uq_email_messages_outlook_account_message"),
        )
        op.create_index("ix_email_messages_id", "email_messages", ["id"])
        op.create_index("ix_email_messages_account_date", "email_messages", ["gmail_account_id", "internal_date"])
        op.create_index("ix_email_messages_outlook_account_date", "email_messages", ["outlook_account_id", "internal_date"])
        op.create_index("ix_email_messages_ai_category", "email_messages", ["ai_category"])
    else:
        # Check for newly added columns on existing email_messages
        msg_cols = {c["name"] for c in insp.get_columns("email_messages")}
        if "ai_category" not in msg_cols:
            op.add_column("email_messages", sa.Column("ai_category", sa.String(length=48), nullable=True))
            op.create_index("ix_email_messages_ai_category", "email_messages", ["ai_category"])
        if "ai_priority" not in msg_cols:
            op.add_column("email_messages", sa.Column("ai_priority", sa.String(length=16), nullable=True))
        if "is_read" not in msg_cols:
            op.add_column("email_messages", sa.Column("is_read", sa.Boolean(), nullable=False, server_default=sa.text("false")))
        if "is_archived" not in msg_cols:
            op.add_column("email_messages", sa.Column("is_archived", sa.Boolean(), nullable=False, server_default=sa.text("false")))

    # 5. email_ai_runs (if not already existing)
    if "email_ai_runs" not in tables:
        op.create_table(
            "email_ai_runs",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
            sa.Column("email_message_id", sa.Integer(), sa.ForeignKey("email_messages.id", ondelete="CASCADE"), nullable=False),
            sa.Column("email_agent_id", sa.Integer(), sa.ForeignKey("email_agents.id", ondelete="SET NULL"), nullable=True),
            sa.Column("summary", sa.Text(), nullable=True),
            sa.Column("draft_reply", sa.Text(), nullable=True),
            sa.Column("key_points", sa.JSON(), nullable=True, server_default=sa.text("'[]'::json")),
            sa.Column("suggested_action", sa.Text(), nullable=True),
            sa.Column("model", sa.String(length=128), nullable=True),
            sa.Column("status", sa.String(length=24), nullable=False, server_default="completed"),
            sa.Column("error", sa.Text(), nullable=True),
            sa.Column("gmail_draft_id", sa.String(length=32), nullable=True),
            sa.Column("gmail_sent_message_id", sa.String(length=32), nullable=True),
            sa.Column("auto_send_status", sa.String(length=16), nullable=False, server_default="none"),
            sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("send_error", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.UniqueConstraint("email_message_id", "email_agent_id", name="uq_email_ai_runs_message_agent"),
        )
        op.create_index("ix_email_ai_runs_id", "email_ai_runs", ["id"])
        op.create_index("ix_email_ai_runs_message", "email_ai_runs", ["email_message_id"])

    # 6. email_rules (Rules Engine)
    if "email_rules" not in tables:
        op.create_table(
            "email_rules",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
            sa.Column("name", sa.String(length=128), nullable=False),
            sa.Column("description", sa.String(length=512), nullable=True),
            sa.Column("natural_language_prompt", sa.Text(), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.Column("priority", sa.Integer(), nullable=False, server_default=sa.text("0")),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index("ix_email_rules_org", "email_rules", ["organization_id"])
        op.create_index("ix_email_rules_priority", "email_rules", ["priority"])

    # 7. email_rule_conditions
    if "email_rule_conditions" not in tables:
        op.create_table(
            "email_rule_conditions",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("rule_id", sa.Integer(), sa.ForeignKey("email_rules.id", ondelete="CASCADE"), nullable=False),
            sa.Column("field", sa.String(length=64), nullable=False),
            sa.Column("operator", sa.String(length=32), nullable=False),
            sa.Column("value", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index("ix_email_rule_conditions_rule_id", "email_rule_conditions", ["rule_id"])

    # 8. email_rule_actions
    if "email_rule_actions" not in tables:
        op.create_table(
            "email_rule_actions",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("rule_id", sa.Integer(), sa.ForeignKey("email_rules.id", ondelete="CASCADE"), nullable=False),
            sa.Column("action_type", sa.String(length=64), nullable=False),
            sa.Column("parameters", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index("ix_email_rule_actions_rule_id", "email_rule_actions", ["rule_id"])

    # 9. email_rule_executions (Audit log)
    if "email_rule_executions" not in tables:
        op.create_table(
            "email_rule_executions",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("rule_id", sa.Integer(), sa.ForeignKey("email_rules.id", ondelete="CASCADE"), nullable=False),
            sa.Column("message_id", sa.Integer(), sa.ForeignKey("email_messages.id", ondelete="CASCADE"), nullable=False),
            sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
            sa.Column("status", sa.String(length=24), nullable=False, server_default=sa.text("'success'")),
            sa.Column("details", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
            sa.Column("executed_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index("ix_email_rule_executions_org_date", "email_rule_executions", ["organization_id", "executed_at"])
        op.create_index("ix_email_rule_executions_rule_id", "email_rule_executions", ["rule_id"])
        op.create_index("ix_email_rule_executions_message_id", "email_rule_executions", ["message_id"])

    # 10. email_followups (Reply Zero)
    if "email_followups" not in tables:
        op.create_table(
            "email_followups",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
            sa.Column("email_message_id", sa.Integer(), sa.ForeignKey("email_messages.id", ondelete="CASCADE"), nullable=False, unique=True),
            sa.Column("thread_id", sa.String(length=64), nullable=True),
            sa.Column("status", sa.String(length=32), nullable=False, server_default=sa.text("'needs_reply'")),
            sa.Column("due_date", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_contact_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("suggested_followup", sa.Text(), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index("ix_email_followups_org_status", "email_followups", ["organization_id", "status"])
        op.create_index("ix_email_followups_thread_id", "email_followups", ["thread_id"])

    # 11. email_attachments (Smart Filing)
    if "email_attachments" not in tables:
        op.create_table(
            "email_attachments",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
            sa.Column("email_message_id", sa.Integer(), sa.ForeignKey("email_messages.id", ondelete="CASCADE"), nullable=False),
            sa.Column("filename", sa.String(length=256), nullable=False),
            sa.Column("content_type", sa.String(length=128), nullable=True),
            sa.Column("file_size", sa.Integer(), nullable=False, server_default=sa.text("0")),
            sa.Column("storage_path", sa.String(length=512), nullable=False),
            sa.Column("file_hash", sa.String(length=64), nullable=True),
            sa.Column("is_uploaded", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index("ix_email_attachments_org", "email_attachments", ["organization_id"])
        op.create_index("ix_email_attachments_msg", "email_attachments", ["email_message_id"])

    # 12. email_digests (Periodic Digests)
    if "email_digests" not in tables:
        op.create_table(
            "email_digests",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
            sa.Column("frequency", sa.String(length=24), nullable=False, server_default=sa.text("'daily'")),
            sa.Column("status", sa.String(length=24), nullable=False, server_default=sa.text("'generated'")),
            sa.Column("content_summary", sa.Text(), nullable=False),
            sa.Column("stats", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
            sa.Column("generated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index("ix_email_digests_org_freq", "email_digests", ["organization_id", "frequency"])


def downgrade() -> None:
    op.drop_table("email_digests")
    op.drop_table("email_attachments")
    op.drop_table("email_followups")
    op.drop_table("email_rule_executions")
    op.drop_table("email_rule_actions")
    op.drop_table("email_rule_conditions")
    op.drop_table("email_rules")
    # For email_messages, drop added triage columns if present
    conn = op.get_bind()
    insp = sa.inspect(conn)
    tables = set(insp.get_table_names())
    if "email_messages" in tables:
        msg_cols = {c["name"] for c in insp.get_columns("email_messages")}
        if "ai_category" in msg_cols:
            op.drop_index("ix_email_messages_ai_category", table_name="email_messages")
            op.drop_column("email_messages", "ai_category")
        if "ai_priority" in msg_cols:
            op.drop_column("email_messages", "ai_priority")
        if "is_read" in msg_cols:
            op.drop_column("email_messages", "is_read")
        if "is_archived" in msg_cols:
            op.drop_column("email_messages", "is_archived")

