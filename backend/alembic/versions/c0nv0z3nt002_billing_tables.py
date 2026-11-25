"""convozent billing tables

Adds tables for the full billing system:
  - billing_plans       : admin-defined subscription plans
  - org_wallets         : prepaid credit balance per org (INR or USD)
  - wallet_transactions : every debit (usage) and credit (top-up/renewal)
  - payment_intents     : tracks Stripe/Razorpay payment attempts

Revision ID: c0nv0z3nt002
Revises: c0nv0z3nt001
Create Date: 2026-06-19
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c0nv0z3nt002"
down_revision: Union[str, None] = "c0nv0z3nt001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # billing_plans
    # Admin-defined plans. gateway = "stripe" | "razorpay" | "both".
    # currency = "INR" (Razorpay) | "USD" (Stripe) | etc.
    # ------------------------------------------------------------------
    op.create_table(
        "billing_plans",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("name", sa.String(64), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("currency", sa.String(8), nullable=False, server_default="USD",
                  comment="INR for Razorpay, USD for Stripe"),
        sa.Column("price_per_month", sa.Numeric(12, 2), nullable=False),
        sa.Column("included_minutes", sa.Integer(), nullable=False, server_default=sa.text("100")),
        sa.Column("included_messages", sa.Integer(), nullable=False, server_default=sa.text("1000")),
        sa.Column("price_per_extra_minute", sa.Numeric(10, 4), nullable=False, server_default=sa.text("0.05")),
        sa.Column("price_per_extra_message", sa.Numeric(10, 4), nullable=False, server_default=sa.text("0.001")),
        # Stripe product/price IDs for recurring billing
        sa.Column("stripe_product_id", sa.String(128), nullable=True),
        sa.Column("stripe_price_id", sa.String(128), nullable=True),
        # Razorpay plan ID for recurring billing
        sa.Column("razorpay_plan_id", sa.String(128), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("name", "currency", name="uq_billing_plans_name_currency"),
    )
    op.create_index("ix_billing_plans_currency", "billing_plans", ["currency"])
    op.create_index("ix_billing_plans_is_active", "billing_plans", ["is_active"])

    # ------------------------------------------------------------------
    # org_wallets
    # One wallet per org. balance is in the org's currency (INR or USD).
    # exhaustion_policy: "pause" | "auto_bill"
    # gateway: "stripe" | "razorpay" — determines which provider to use
    # ------------------------------------------------------------------
    op.create_table(
        "org_wallets",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column(
            "organization_id",
            sa.Integer(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("balance", sa.Numeric(14, 4), nullable=False, server_default=sa.text("0")),
        sa.Column("currency", sa.String(8), nullable=False, server_default="USD"),
        sa.Column(
            "gateway", sa.String(16), nullable=False, server_default="stripe",
            comment="stripe | razorpay"
        ),
        sa.Column(
            "exhaustion_policy", sa.String(16), nullable=False, server_default="pause",
            comment="pause | auto_bill"
        ),
        # Stripe customer + subscription IDs
        sa.Column("stripe_customer_id", sa.String(128), nullable=True),
        sa.Column("stripe_subscription_id", sa.String(128), nullable=True),
        # Razorpay customer + subscription IDs
        sa.Column("razorpay_customer_id", sa.String(128), nullable=True),
        sa.Column("razorpay_subscription_id", sa.String(128), nullable=True),
        # Linked plan
        sa.Column("billing_plan_id", sa.Integer(), sa.ForeignKey("billing_plans.id"), nullable=True),
        sa.Column("plan_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_org_wallets_org_id", "org_wallets", ["organization_id"])
    op.create_index("ix_org_wallets_stripe_customer", "org_wallets", ["stripe_customer_id"])
    op.create_index("ix_org_wallets_razorpay_customer", "org_wallets", ["razorpay_customer_id"])

    # ------------------------------------------------------------------
    # wallet_transactions
    # Every balance movement: subscription credit, top-up, usage debit.
    # amount is always positive; tx_type determines direction.
    # tx_type: "subscription_credit" | "topup" | "usage_debit" | "refund"
    # ------------------------------------------------------------------
    op.create_table(
        "wallet_transactions",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column(
            "organization_id",
            sa.Integer(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("amount", sa.Numeric(14, 4), nullable=False,
                  comment="Always positive; direction set by tx_type"),
        sa.Column("currency", sa.String(8), nullable=False),
        sa.Column(
            "tx_type", sa.String(32), nullable=False,
            comment="subscription_credit | topup | usage_debit | refund"
        ),
        sa.Column("description", sa.Text(), nullable=True),
        # Balance after this transaction
        sa.Column("balance_after", sa.Numeric(14, 4), nullable=False),
        # Link to payment_intent if this came from a payment
        sa.Column("payment_intent_id", sa.Integer(), nullable=True),
        # Link to workflow_run if this is a usage debit
        sa.Column("workflow_run_id", sa.Integer(), sa.ForeignKey("workflow_runs.id"), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_wallet_tx_org_id", "wallet_transactions", ["organization_id"])
    op.create_index("ix_wallet_tx_type", "wallet_transactions", ["tx_type"])
    op.create_index("ix_wallet_tx_created_at", "wallet_transactions", ["created_at"])

    # ------------------------------------------------------------------
    # payment_intents
    # Tracks every payment attempt (subscription or top-up).
    # gateway: "stripe" | "razorpay"
    # status: "pending" | "succeeded" | "failed" | "refunded"
    # ------------------------------------------------------------------
    op.create_table(
        "payment_intents",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column(
            "organization_id",
            sa.Integer(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("gateway", sa.String(16), nullable=False, comment="stripe | razorpay"),
        sa.Column("gateway_payment_id", sa.String(256), nullable=True,
                  comment="Stripe PaymentIntent ID or Razorpay order/payment ID"),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("currency", sa.String(8), nullable=False),
        sa.Column(
            "purpose", sa.String(32), nullable=False,
            comment="subscription | topup"
        ),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending",
                  comment="pending | succeeded | failed | refunded"),
        sa.Column("minutes_to_credit", sa.Integer(), nullable=True,
                  comment="For topup: how many minutes this payment buys"),
        sa.Column("metadata", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_payment_intents_org_id", "payment_intents", ["organization_id"])
    op.create_index("ix_payment_intents_gateway_id", "payment_intents", ["gateway_payment_id"])
    op.create_index("ix_payment_intents_status", "payment_intents", ["status"])

    # Also add billing_plan_id + gateway to org_subscriptions (already exists from phase 1)
    op.add_column("org_subscriptions",
        sa.Column("billing_plan_id", sa.Integer(), sa.ForeignKey("billing_plans.id"), nullable=True))
    op.add_column("org_subscriptions",
        sa.Column("gateway", sa.String(16), nullable=False, server_default="stripe"))
    op.add_column("org_subscriptions",
        sa.Column("currency", sa.String(8), nullable=False, server_default="USD"))


def downgrade() -> None:
    op.drop_column("org_subscriptions", "currency")
    op.drop_column("org_subscriptions", "gateway")
    op.drop_column("org_subscriptions", "billing_plan_id")
    op.drop_index("ix_payment_intents_status", table_name="payment_intents")
    op.drop_index("ix_payment_intents_gateway_id", table_name="payment_intents")
    op.drop_index("ix_payment_intents_org_id", table_name="payment_intents")
    op.drop_table("payment_intents")
    op.drop_index("ix_wallet_tx_created_at", table_name="wallet_transactions")
    op.drop_index("ix_wallet_tx_type", table_name="wallet_transactions")
    op.drop_index("ix_wallet_tx_org_id", table_name="wallet_transactions")
    op.drop_table("wallet_transactions")
    op.drop_index("ix_org_wallets_razorpay_customer", table_name="org_wallets")
    op.drop_index("ix_org_wallets_stripe_customer", table_name="org_wallets")
    op.drop_index("ix_org_wallets_org_id", table_name="org_wallets")
    op.drop_table("org_wallets")
    op.drop_index("ix_billing_plans_is_active", table_name="billing_plans")
    op.drop_index("ix_billing_plans_currency", table_name="billing_plans")
    op.drop_table("billing_plans")
