"""DB client for billing tables — org-scoped access only.

All queries filter by organization_id. Routes/services must use this
client instead of inline SELECTs so tenant isolation is enforced in one place.
"""
from __future__ import annotations

from sqlalchemy import func, select

from api.db.base_client import BaseDBClient
from api.db.models import (
    BillingPlanModel,
    OrgWalletModel,
    PaymentIntentModel,
    WalletTransactionModel,
)


class BillingClient(BaseDBClient):
    # ── Plans ──
    async def list_plans(
        self, *, currency: str | None = None, active_only: bool = True
    ) -> list[BillingPlanModel]:
        async with self.async_session() as s:
            q = select(BillingPlanModel)
            if active_only:
                q = q.where(BillingPlanModel.is_active.is_(True))
            if currency:
                q = q.where(BillingPlanModel.currency == currency.upper())
            r = await s.execute(q.order_by(BillingPlanModel.price_per_month))
            return list(r.scalars().all())

    async def get_plan(self, plan_id: int) -> BillingPlanModel | None:
        async with self.async_session() as s:
            r = await s.execute(
                select(BillingPlanModel).where(BillingPlanModel.id == plan_id)
            )
            return r.scalar_one_or_none()

    async def get_plan_by_stripe_price(self, price_id: str) -> BillingPlanModel | None:
        async with self.async_session() as s:
            r = await s.execute(
                select(BillingPlanModel).where(
                    BillingPlanModel.stripe_price_id == price_id
                )
            )
            return r.scalar_one_or_none()

    # ── Wallets (read-only helpers; writes go via services/billing/wallet.py) ──
    async def get_wallet(self, org_id: int) -> OrgWalletModel | None:
        async with self.async_session() as s:
            r = await s.execute(
                select(OrgWalletModel).where(
                    OrgWalletModel.organization_id == org_id
                )
            )
            return r.scalar_one_or_none()

    async def get_wallet_by_stripe_subscription(
        self, subscription_id: str
    ) -> OrgWalletModel | None:
        async with self.async_session() as s:
            r = await s.execute(
                select(OrgWalletModel).where(
                    OrgWalletModel.stripe_subscription_id == subscription_id
                )
            )
            return r.scalar_one_or_none()

    async def get_wallet_by_razorpay_subscription(
        self, subscription_id: str
    ) -> OrgWalletModel | None:
        async with self.async_session() as s:
            r = await s.execute(
                select(OrgWalletModel).where(
                    OrgWalletModel.razorpay_subscription_id == subscription_id
                )
            )
            return r.scalar_one_or_none()

    # ── Transactions ──
    async def list_transactions(
        self, org_id: int, limit: int = 50, offset: int = 0
    ) -> list[WalletTransactionModel]:
        limit = max(1, min(limit, 200))
        offset = max(0, offset)
        async with self.async_session() as s:
            r = await s.execute(
                select(WalletTransactionModel)
                .where(WalletTransactionModel.organization_id == org_id)
                .order_by(WalletTransactionModel.created_at.desc())
                .limit(limit)
                .offset(offset)
            )
            return list(r.scalars().all())

    async def count_transactions(self, org_id: int) -> int:
        async with self.async_session() as s:
            r = await s.execute(
                select(func.count())
                .select_from(WalletTransactionModel)
                .where(WalletTransactionModel.organization_id == org_id)
            )
            return r.scalar_one()

    async def has_usage_debit(self, workflow_run_id: int) -> bool:
        async with self.async_session() as s:
            r = await s.execute(
                select(WalletTransactionModel.id).where(
                    WalletTransactionModel.workflow_run_id == workflow_run_id,
                    WalletTransactionModel.tx_type == "usage_debit",
                )
            )
            return r.scalar_one_or_none() is not None

    # ── Payment intents ──
    async def get_intent_by_gateway_id(
        self, gateway_payment_id: str, gateway: str | None = None
    ) -> PaymentIntentModel | None:
        async with self.async_session() as s:
            q = select(PaymentIntentModel).where(
                PaymentIntentModel.gateway_payment_id == gateway_payment_id
            )
            if gateway:
                q = q.where(PaymentIntentModel.gateway == gateway)
            r = await s.execute(q)
            return r.scalar_one_or_none()

    async def list_pending_razorpay_intents(
        self, org_id: int
    ) -> list[PaymentIntentModel]:
        async with self.async_session() as s:
            r = await s.execute(
                select(PaymentIntentModel).where(
                    PaymentIntentModel.organization_id == org_id,
                    PaymentIntentModel.gateway == "razorpay",
                    PaymentIntentModel.status == "pending",
                )
            )
            return list(r.scalars().all())

    async def list_stale_pending_intents(
        self, older_than_minutes: int = 15, limit: int = 100
    ) -> list[PaymentIntentModel]:
        from datetime import UTC, datetime, timedelta

        cutoff = datetime.now(UTC) - timedelta(minutes=older_than_minutes)
        async with self.async_session() as s:
            r = await s.execute(
                select(PaymentIntentModel)
                .where(
                    PaymentIntentModel.status == "pending",
                    PaymentIntentModel.created_at < cutoff,
                )
                .order_by(PaymentIntentModel.created_at)
                .limit(limit)
            )
            return list(r.scalars().all())


billing_client = BillingClient()
