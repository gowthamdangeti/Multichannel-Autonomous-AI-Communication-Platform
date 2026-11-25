"""billing hardening: idempotency + ledger invariants

- unique (gateway, gateway_payment_id) on payment_intents (null-safe)
- partial unique on wallet_transactions(workflow_run_id) for usage_debit
- CHECK amount > 0, balance_after >= 0, wallets.balance >= 0

Revision ID: c0nv0z3nt018
Revises: c0nv0z3nt020
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c0nv0z3nt018"
down_revision: Union[str, None] = "c0nv0z3nt020b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Dedupe first so unique constraints don't fail on legacy double-credits.
    # Keep the earliest row per (gateway, gateway_payment_id).
    op.execute(
        """
        DELETE FROM payment_intents a USING payment_intents b
        WHERE a.id > b.id
          AND a.gateway = b.gateway
          AND a.gateway_payment_id IS NOT NULL
          AND a.gateway_payment_id = b.gateway_payment_id
        """
    )
    # Keep earliest usage_debit per workflow_run_id.
    op.execute(
        """
        DELETE FROM wallet_transactions a USING wallet_transactions b
        WHERE a.id > b.id
          AND a.workflow_run_id IS NOT NULL
          AND a.workflow_run_id = b.workflow_run_id
          AND a.tx_type = 'usage_debit' AND b.tx_type = 'usage_debit'
        """
    )
    # Clamp any legacy negative balances (ledger now clamps at 0).
    op.execute("UPDATE org_wallets SET balance = 0 WHERE balance < 0")
    op.execute("UPDATE wallet_transactions SET balance_after = 0 WHERE balance_after < 0")
    op.execute("UPDATE wallet_transactions SET amount = 0.0001 WHERE amount <= 0")
    op.execute("UPDATE payment_intents SET amount = 0.01 WHERE amount <= 0")

    op.create_unique_constraint(
        "uq_payment_intents_gateway_payment",
        "payment_intents",
        ["gateway", "gateway_payment_id"],
    )
    op.create_index(
        "uq_wallet_tx_workflow_run_usage",
        "wallet_transactions",
        ["workflow_run_id"],
        unique=True,
        postgresql_where=sa.text(
            "workflow_run_id IS NOT NULL AND tx_type = 'usage_debit'"
        ),
    )
    op.create_check_constraint(
        "ck_wallet_tx_amount_positive", "wallet_transactions", "amount > 0"
    )
    op.create_check_constraint(
        "ck_wallet_tx_balance_nonneg",
        "wallet_transactions",
        "balance_after >= 0",
    )
    op.create_check_constraint(
        "ck_org_wallets_balance_nonneg", "org_wallets", "balance >= 0"
    )
    op.create_check_constraint(
        "ck_payment_intents_amount_positive", "payment_intents", "amount > 0"
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_payment_intents_amount_positive", "payment_intents", type_="check"
    )
    op.drop_constraint(
        "ck_org_wallets_balance_nonneg", "org_wallets", type_="check"
    )
    op.drop_constraint(
        "ck_wallet_tx_balance_nonneg", "wallet_transactions", type_="check"
    )
    op.drop_constraint(
        "ck_wallet_tx_amount_positive", "wallet_transactions", type_="check"
    )
    op.drop_index("uq_wallet_tx_workflow_run_usage", table_name="wallet_transactions")
    op.drop_constraint(
        "uq_payment_intents_gateway_payment", "payment_intents", type_="unique"
    )
