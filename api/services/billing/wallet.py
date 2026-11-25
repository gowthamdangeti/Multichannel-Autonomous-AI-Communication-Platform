"""Atomic wallet ledger — the ONLY writer of balances.

All balance mutations happen here inside a single DB transaction with
SELECT ... FOR UPDATE, so concurrent debits/credits cannot overspend or
double-credit. Callers never touch OrgWalletModel directly.
"""
from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from loguru import logger
from sqlalchemy import select

from api.db.base_client import BaseDBClient
from api.db.models import (
    OrgWalletModel,
    PaymentIntentModel,
    WalletTransactionModel,
)


def gateway_for(currency: str) -> str:
    return "razorpay" if currency.upper() == "INR" else "stripe"


class WalletLedger(BaseDBClient):
    async def get_or_create_wallet(
        self, org_id: int, currency: str = "USD"
    ) -> OrgWalletModel:
        async with self.async_session() as s:
            r = await s.execute(
                select(OrgWalletModel).where(
                    OrgWalletModel.organization_id == org_id
                )
            )
            wallet = r.scalar_one_or_none()
            if not wallet:
                wallet = OrgWalletModel(
                    organization_id=org_id,
                    currency=currency.upper(),
                    gateway=gateway_for(currency),
                )
                s.add(wallet)
                await s.commit()
                await s.refresh(wallet)
            return wallet

    async def credit(
        self,
        *,
        org_id: int,
        amount: Decimal,
        currency: str,
        tx_type: str,
        description: str,
        payment_intent_id: int | None = None,
        metadata: dict | None = None,
    ) -> WalletTransactionModel:
        amount = Decimal(str(amount))
        if amount <= 0:
            raise ValueError("credit amount must be > 0")
        async with self.async_session() as s:
            w = (
                await s.execute(
                    select(OrgWalletModel)
                    .where(OrgWalletModel.organization_id == org_id)
                    .with_for_update()
                )
            ).scalar_one_or_none()
            if not w:
                w = OrgWalletModel(
                    organization_id=org_id,
                    currency=currency.upper(),
                    gateway=gateway_for(currency),
                    balance=Decimal("0"),
                )
                s.add(w)
                await s.flush()
            # Currency guard: never mix currencies silently
            if w.currency.upper() != currency.upper():
                logger.warning(
                    f"[billing] currency mismatch org={org_id} "
                    f"wallet={w.currency} tx={currency} — keeping wallet currency"
                )
                currency = w.currency
            new_balance = Decimal(str(w.balance)) + amount
            w.balance = new_balance
            w.updated_at = datetime.now(UTC)
            tx = WalletTransactionModel(
                organization_id=org_id,
                amount=amount,
                currency=currency.upper(),
                tx_type=tx_type,
                description=description,
                balance_after=new_balance,
                payment_intent_id=payment_intent_id,
                metadata_=metadata,
            )
            s.add(tx)
            await s.commit()
            await s.refresh(tx)
            return tx

    async def debit(
        self,
        *,
        org_id: int,
        amount: Decimal,
        currency: str,
        description: str,
        workflow_run_id: int | None = None,
    ) -> tuple[WalletTransactionModel, bool]:
        """Deduct usage. Idempotent per workflow_run_id.

        Returns (tx, sufficient). On duplicate workflow_run_id returns the
        existing tx with sufficient=True (already accounted).
        """
        amount = Decimal(str(amount))
        if amount <= 0:
            raise ValueError("debit amount must be > 0")
        async with self.async_session() as s:
            if workflow_run_id is not None:
                dup = (
                    await s.execute(
                        select(WalletTransactionModel).where(
                            WalletTransactionModel.workflow_run_id
                            == workflow_run_id,
                            WalletTransactionModel.tx_type == "usage_debit",
                        )
                    )
                ).scalar_one_or_none()
                if dup:
                    return dup, True
            w = (
                await s.execute(
                    select(OrgWalletModel)
                    .where(OrgWalletModel.organization_id == org_id)
                    .with_for_update()
                )
            ).scalar_one_or_none()
            current = Decimal(str(w.balance)) if w else Decimal("0")
            new_balance = current - amount
            sufficient = new_balance >= 0
            # Clamp stored balance at 0 but report sufficiency so callers can
            # enforce exhaustion_policy (pause vs auto_bill)
            stored = max(new_balance, Decimal("0"))
            if w:
                w.balance = stored
                w.updated_at = datetime.now(UTC)
            tx = WalletTransactionModel(
                organization_id=org_id,
                amount=amount,
                currency=currency.upper(),
                tx_type="usage_debit",
                description=description,
                balance_after=stored,
                workflow_run_id=workflow_run_id,
            )
            s.add(tx)
            await s.commit()
            await s.refresh(tx)
            return tx, sufficient

    async def complete_payment_atomically(
        self,
        *,
        gateway_payment_id: str,
        gateway: str,
        org_id: int,
        amount: Decimal,
        currency: str,
        purpose: str,
        minutes: int = 0,
        tx_type_override: str | None = None,
    ) -> dict[str, Any]:
        """Mark intent succeeded + credit wallet in ONE transaction.

        Safe to call from webhooks AND frontend confirm — second call is a
        no-op returning already_processed.
        """
        async with self.async_session() as s:
            intent = (
                await s.execute(
                    select(PaymentIntentModel)
                    .where(
                        PaymentIntentModel.gateway_payment_id
                        == gateway_payment_id
                    )
                    .with_for_update()
                )
            ).scalar_one_or_none()

            intent_id: int | None = None
            if intent:
                if intent.status == "succeeded":
                    return {"status": "already_processed"}
                # Trust stored org/amount when caller disagrees
                org_id = intent.organization_id
                purpose = intent.purpose or purpose
                if not minutes and intent.minutes_to_credit:
                    minutes = intent.minutes_to_credit
                if not amount or amount == 0:
                    amount = intent.amount
                currency = intent.currency or currency
                intent.status = "succeeded"
                intent.updated_at = datetime.now(UTC)
                await s.flush()
                intent_id = intent.id
            else:
                # No intent (e.g. subscription renewal via gateway dashboard):
                # create a succeeded record for audit
                intent = PaymentIntentModel(
                    organization_id=org_id,
                    gateway=gateway,
                    gateway_payment_id=gateway_payment_id,
                    amount=Decimal(str(amount)),
                    currency=currency.upper(),
                    purpose=purpose,
                    status="succeeded",
                    minutes_to_credit=minutes or None,
                )
                s.add(intent)
                await s.flush()
                intent_id = intent.id

            tx: WalletTransactionModel | None = None
            should_credit = purpose == "topup" and minutes > 0
            if should_credit:
                w = (
                    await s.execute(
                        select(OrgWalletModel)
                        .where(OrgWalletModel.organization_id == org_id)
                        .with_for_update()
                    )
                ).scalar_one_or_none()
                if not w:
                    w = OrgWalletModel(
                        organization_id=org_id,
                        currency=currency.upper(),
                        gateway=gateway,
                        balance=Decimal("0"),
                    )
                    s.add(w)
                    await s.flush()
                new_balance = Decimal(str(w.balance)) + Decimal(str(amount))
                w.balance = new_balance
                w.updated_at = datetime.now(UTC)
                tx = WalletTransactionModel(
                    organization_id=org_id,
                    amount=Decimal(str(amount)),
                    currency=currency.upper(),
                    tx_type=tx_type_override or "topup",
                    description=f"Top-up: {minutes} minutes via {gateway}",
                    balance_after=new_balance,
                    payment_intent_id=intent_id,
                )
                s.add(tx)

            await s.commit()
            if tx:
                await s.refresh(tx)
                return {
                    "status": "credited",
                    "tx_id": tx.id,
                    "balance_after": float(tx.balance_after),
                }
            return {"status": "recorded", "intent_id": intent_id}


wallet_ledger = WalletLedger()
