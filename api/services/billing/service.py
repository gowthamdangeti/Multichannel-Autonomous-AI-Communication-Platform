"""Convozent billing service — Stripe (international) + Razorpay (India).

Layering:
  routes/billing.py  -> this service -> db/billing_client.py + services/billing/wallet.py
  Gateways live in services/billing/gateways/, pricing in metering.py.

Gateway routing: currency == "INR" -> Razorpay, else Stripe.
All amounts stored in the org's currency. Money = Decimal, never float.
"""
from __future__ import annotations

import os
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

from loguru import logger
from sqlalchemy import select

from api.db.base_client import BaseDBClient
from api.db.models import (
    BillingPlanModel,
    OrgWalletModel,
    PaymentIntentModel,
    WalletTransactionModel,
)

# ── gateway clients (lazy init so missing keys don't crash the import) ────────
# Kept as module functions for backwards-compat (tests patch these).


def _stripe_client():
    from api.services.billing.gateways.stripe_gateway import _client

    return _client()


def _razorpay_client():
    from api.services.billing.gateways.razorpay_gateway import _client

    return _client()


def _gateway_for(currency: str) -> str:
    from api.services.billing.wallet import gateway_for

    return gateway_for(currency)


def is_india_location(country: str | None = None, phone_number: str | None = None) -> bool:
    if country:
        c = str(country).strip().upper()
        if c in ("IN", "INDIA") or "INDIA" in c:
            return True
    if phone_number and str(phone_number).strip().startswith("+91"):
        return True
    return False


def get_currency_for_location(country: str | None = None, phone_number: str | None = None) -> str:
    return "INR" if is_india_location(country, phone_number) else "USD"


class BillingService(BaseDBClient):
    # ------------------------------------------------------------------ #
    # Plans (reads via billing_client, writes stay here for provisioning)
    # ------------------------------------------------------------------ #

    async def list_plans(self, *, currency: str | None = None, active_only: bool = True) -> list[BillingPlanModel]:
        from api.db.billing_client import billing_client

        return await billing_client.list_plans(currency=currency, active_only=active_only)

    async def get_plan(self, plan_id: int) -> BillingPlanModel | None:
        from api.db.billing_client import billing_client

        return await billing_client.get_plan(plan_id)

    async def _provision_stripe_plan(self, plan: BillingPlanModel) -> tuple[str, str]:
        """Create a Stripe Product + recurring Price. Returns (product_id, price_id)."""
        stripe = _stripe_client()
        product = stripe.Product.create(
            name=plan.name,
            description=plan.description or f"Convozent {plan.name} plan",
            metadata={"convozent_plan_id": str(plan.id)},
        )
        price = stripe.Price.create(
            product=product.id,
            unit_amount=int(Decimal(str(plan.price_per_month)) * 100),  # cents
            currency=plan.currency.lower(),
            recurring={"interval": "month"},
            metadata={"convozent_plan_id": str(plan.id)},
        )
        logger.info(f"Stripe plan created: product={product.id} price={price.id}")
        return product.id, price.id

    async def _provision_razorpay_plan(self, plan: BillingPlanModel) -> str:
        """Create a Razorpay Plan. Returns plan_id."""
        rz = _razorpay_client()
        rz_plan = rz.plan.create({
            "period": "monthly",
            "interval": 1,
            "item": {
                "name": plan.name,
                "amount": int(Decimal(str(plan.price_per_month)) * 100),  # paise
                "unit": "months",
                "currency": "INR",
                "description": plan.description or f"Convozent {plan.name} plan",
            },
            "notes": {"convozent_plan_id": str(plan.id)},
        })
        logger.info(f"Razorpay plan created: {rz_plan['id']}")
        return rz_plan["id"]

    async def create_plan(self, data: dict[str, Any]) -> BillingPlanModel:
        # 1. Save to DB first (without gateway IDs)
        async with self.async_session() as s:
            plan = BillingPlanModel(**data)
            s.add(plan)
            await s.commit()
            await s.refresh(plan)

        # 2. Auto-provision on the appropriate gateway
        currency = (plan.currency or "USD").upper()
        try:
            if currency == "INR":
                if not plan.razorpay_plan_id:
                    rzp_id = await self._provision_razorpay_plan(plan)
                    async with self.async_session() as s:
                        r = await s.execute(select(BillingPlanModel).where(BillingPlanModel.id == plan.id))
                        p = r.scalar_one()
                        p.razorpay_plan_id = rzp_id
                        p.updated_at = datetime.now(UTC)
                        await s.commit()
                        await s.refresh(p)
                        plan = p
            else:
                if not plan.stripe_price_id:
                    product_id, price_id = await self._provision_stripe_plan(plan)
                    async with self.async_session() as s:
                        r = await s.execute(select(BillingPlanModel).where(BillingPlanModel.id == plan.id))
                        p = r.scalar_one()
                        p.stripe_product_id = product_id
                        p.stripe_price_id = price_id
                        p.updated_at = datetime.now(UTC)
                        await s.commit()
                        await s.refresh(p)
                        plan = p
        except Exception as e:
            # Gateway provisioning failed — plan is still saved in DB, log the error
            logger.error(f"Gateway provisioning failed for plan {plan.id}: {e}")

        return plan

    async def update_plan(self, plan_id: int, data: dict[str, Any]) -> BillingPlanModel | None:
        async with self.async_session() as s:
            r = await s.execute(select(BillingPlanModel).where(BillingPlanModel.id == plan_id))
            plan = r.scalar_one_or_none()
            if not plan:
                return None

            price_changed = "price_per_month" in data and data["price_per_month"] != float(plan.price_per_month)
            name_changed = "name" in data and data["name"] != plan.name

            for k, v in data.items():
                setattr(plan, k, v)
            plan.updated_at = datetime.now(UTC)
            await s.commit()
            await s.refresh(plan)

        # Sync name change to Stripe product
        currency = (plan.currency or "USD").upper()
        try:
            if currency != "INR" and plan.stripe_product_id and name_changed:
                stripe = _stripe_client()
                stripe.Product.modify(plan.stripe_product_id, name=plan.name,
                                      description=plan.description or f"Convozent {plan.name} plan")
                logger.info(f"Stripe product updated: {plan.stripe_product_id}")

            # Price changed on Stripe: create a new Price (Stripe prices are immutable)
            if currency != "INR" and price_changed and plan.stripe_product_id:
                stripe = _stripe_client()
                # Archive old price
                if plan.stripe_price_id:
                    try:
                        stripe.Price.modify(plan.stripe_price_id, active=False)
                    except Exception:
                        pass
                new_price = stripe.Price.create(
                    product=plan.stripe_product_id,
                    unit_amount=int(Decimal(str(plan.price_per_month)) * 100),
                    currency=plan.currency.lower(),
                    recurring={"interval": "month"},
                    metadata={"convozent_plan_id": str(plan.id)},
                )
                async with self.async_session() as s:
                    r = await s.execute(select(BillingPlanModel).where(BillingPlanModel.id == plan_id))
                    p = r.scalar_one()
                    p.stripe_price_id = new_price.id
                    p.updated_at = datetime.now(UTC)
                    await s.commit()
                    await s.refresh(p)
                    plan = p
                logger.info(f"Stripe price updated: {new_price.id}")
        except Exception as e:
            logger.error(f"Gateway sync failed for plan {plan.id}: {e}")

        return plan

    # ------------------------------------------------------------------ #
    # Wallet — reads via billing_client, writes via atomic ledger
    # ------------------------------------------------------------------ #

    async def get_or_create_wallet(self, org_id: int, currency: str = "USD") -> OrgWalletModel:
        from api.services.billing.wallet import wallet_ledger

        return await wallet_ledger.get_or_create_wallet(org_id, currency)

    async def get_wallet(self, org_id: int) -> OrgWalletModel | None:
        from api.db.billing_client import billing_client

        return await billing_client.get_wallet(org_id)

    async def get_wallet_view(
        self, org_id: int, *, country: str | None = None, phone_number: str | None = None
    ) -> OrgWalletModel:
        """Org-facing wallet read with currency auto-fix + legacy plan sync.

        Moved out of routes so handlers stay thin. Wallet is source of truth —
        never overwrites an existing billing_plan_id.
        """
        user_currency = get_currency_for_location(country, phone_number)
        wallet = await self.get_wallet(org_id)
        if not wallet:
            return await self.get_or_create_wallet(org_id, currency=user_currency)
        # Auto-fix unused USD wallet for Indian users
        if (
            wallet.currency != user_currency
            and float(wallet.balance) == 0.0
            and wallet.billing_plan_id is None
        ):
            async with self.async_session() as s:
                r = await s.execute(
                    select(OrgWalletModel).where(OrgWalletModel.organization_id == org_id)
                )
                w = r.scalar_one_or_none()
                if w and float(w.balance) == 0.0 and w.billing_plan_id is None:
                    w.currency = user_currency
                    w.gateway = "razorpay" if user_currency == "INR" else "stripe"
                    w.updated_at = datetime.now(UTC)
                    await s.commit()
                    await s.refresh(w)
                    wallet = w
        # Legacy auto-sync (deprecated): hydrate from org_subscriptions once
        if wallet and not wallet.billing_plan_id:
            try:
                from api.db.platform_client import platform_client

                sub = await platform_client.get_org_subscription(org_id)
                if sub and getattr(sub, "plan_name", None):
                    plans = await self.list_plans(active_only=False)
                    match = next(
                        (p for p in plans if p.name.lower() == sub.plan_name.lower()),
                        None,
                    )
                    if match:
                        async with self.async_session() as s:
                            r = await s.execute(
                                select(OrgWalletModel).where(
                                    OrgWalletModel.organization_id == org_id
                                )
                            )
                            w = r.scalar_one_or_none()
                            if w and not w.billing_plan_id:
                                w.billing_plan_id = match.id
                                if w.currency != match.currency:
                                    w.currency = match.currency
                                    w.gateway = (
                                        "razorpay"
                                        if match.currency == "INR"
                                        else "stripe"
                                    )
                                w.updated_at = datetime.now(UTC)
                                await s.commit()
                                await s.refresh(w)
                                wallet = w
            except Exception:
                pass
        return wallet

    async def update_wallet_admin(
        self, org_id: int, updates: dict[str, Any]
    ) -> OrgWalletModel | None:
        """Admin metadata update (currency/gateway/policy/plan). No balance edits.

        Balance changes must go through credit/debit so the ledger stays intact.
        """
        allowed = {"currency", "gateway", "exhaustion_policy", "billing_plan_id"}
        updates = {k: v for k, v in updates.items() if k in allowed}
        async with self.async_session() as s:
            r = await s.execute(
                select(OrgWalletModel).where(OrgWalletModel.organization_id == org_id)
            )
            w = r.scalar_one_or_none()
            if not w:
                return None
            for k, v in updates.items():
                setattr(w, k, v)
            w.updated_at = datetime.now(UTC)
            await s.commit()
            await s.refresh(w)
            return w

    async def cancel_subscription(self, org_id: int) -> bool:
        """Org cancels plan — clears wallet plan but keeps balance.

        Returns False when there was no active subscription.
        Gateway-side cancellation is a TODO when live keys are configured.
        """
        async with self.async_session() as s:
            r = await s.execute(
                select(OrgWalletModel).where(
                    OrgWalletModel.organization_id == org_id
                )
            )
            w = r.scalar_one_or_none()
            if not w or not w.billing_plan_id:
                return False
            # TODO: cancel gateway subscription via Stripe/Razorpay API when live
            w.billing_plan_id = None
            w.plan_expires_at = None
            w.updated_at = datetime.now(UTC)
            await s.commit()
            return True

    async def credit_wallet(
        self,
        org_id: int,
        amount: Decimal,
        currency: str,
        tx_type: str,
        description: str,
        payment_intent_id: int | None = None,
        metadata: dict | None = None,
    ) -> WalletTransactionModel:
        """Add funds — delegates to atomic ledger."""
        from api.services.billing.wallet import wallet_ledger

        return await wallet_ledger.credit(
            org_id=org_id,
            amount=Decimal(str(amount)),
            currency=currency,
            tx_type=tx_type,
            description=description,
            payment_intent_id=payment_intent_id,
            metadata=metadata,
        )

    async def debit_wallet(
        self,
        org_id: int,
        amount: Decimal,
        currency: str,
        description: str,
        workflow_run_id: int | None = None,
    ) -> tuple[WalletTransactionModel, bool]:
        """Deduct usage — delegates to atomic ledger (idempotent per run)."""
        from api.services.billing.wallet import wallet_ledger

        return await wallet_ledger.debit(
            org_id=org_id,
            amount=Decimal(str(amount)),
            currency=currency,
            description=description,
            workflow_run_id=workflow_run_id,
        )

    async def get_wallet_transactions(self, org_id: int, limit: int = 50, offset: int = 0) -> list[WalletTransactionModel]:
        # NOTE: no gateway sync here — reads must not do network I/O.
        # Use services/billing/reconciliation.py (ARQ cron) for pending sync.
        from api.db.billing_client import billing_client

        return await billing_client.list_transactions(org_id, limit=limit, offset=offset)

    async def count_wallet_transactions(self, org_id: int) -> int:
        from api.db.billing_client import billing_client

        return await billing_client.count_transactions(org_id)

    # ------------------------------------------------------------------ #
    # Stripe — create checkout session (top-up or subscription)
    # ------------------------------------------------------------------ #

    async def create_stripe_topup_session(
        self,
        org_id: int,
        amount_cents: int,
        currency: str,
        minutes: int,
        success_url: str,
        cancel_url: str,
    ) -> dict[str, str]:
        """Create a Stripe Checkout session for a one-time top-up."""
        stripe = _stripe_client()

        # Create or retrieve Stripe customer
        wallet = await self.get_wallet(org_id)
        customer_id = wallet.stripe_customer_id if wallet else None

        try:
            session = stripe.checkout.Session.create(
                mode="payment",
                customer=customer_id,
                line_items=[{
                    "price_data": {
                        "currency": currency.lower(),
                        "unit_amount": amount_cents,
                        "product_data": {"name": f"{minutes} minutes top-up"},
                    },
                    "quantity": 1,
                }],
                success_url=success_url,
                cancel_url=cancel_url,
                metadata={"org_id": str(org_id), "minutes": str(minutes), "purpose": "topup"},
            )
        except (RuntimeError, ValueError):
            raise
        except Exception as e:
            msg = str(e) or type(e).__name__
            if "auth" in msg.lower() or "invalid api key" in msg.lower():
                raise RuntimeError(
                    "Stripe authentication failed: STRIPE_SECRET_KEY rejected. "
                    "Check api/.env key (test vs live) and restart the backend."
                )
            logger.error(f"Stripe Session.create failed org={org_id}: {e}")
            raise RuntimeError(f"Stripe request failed: {msg}")

        # Record the pending intent
        async with self.async_session() as s:
            intent = PaymentIntentModel(
                organization_id=org_id,
                gateway="stripe",
                gateway_payment_id=session.id,
                amount=Decimal(amount_cents) / 100,
                currency=currency.upper(),
                purpose="topup",
                status="pending",
                minutes_to_credit=minutes,
            )
            s.add(intent)
            await s.commit()

        return {"session_id": session.id, "url": session.url}

    async def create_stripe_subscription_session(
        self,
        org_id: int,
        plan: BillingPlanModel,
        success_url: str,
        cancel_url: str,
    ) -> dict[str, str]:
        """Create a Stripe Checkout session for a recurring subscription."""
        stripe = _stripe_client()
        if not plan.stripe_price_id:
            raise ValueError(f"Plan {plan.name} has no stripe_price_id configured")

        try:
            session = stripe.checkout.Session.create(
                mode="subscription",
                line_items=[{"price": plan.stripe_price_id, "quantity": 1}],
                success_url=success_url,
                cancel_url=cancel_url,
                metadata={"org_id": str(org_id), "plan_id": str(plan.id), "purpose": "subscription"},
            )
        except (RuntimeError, ValueError):
            raise
        except Exception as e:
            msg = str(e) or type(e).__name__
            if "auth" in msg.lower() or "invalid api key" in msg.lower():
                raise RuntimeError(
                    "Stripe authentication failed: STRIPE_SECRET_KEY rejected. "
                    "Check api/.env key (test vs live) and restart the backend."
                )
            logger.error(f"Stripe subscription Session.create failed org={org_id}: {e}")
            raise RuntimeError(f"Stripe request failed: {msg}")

        async with self.async_session() as s:
            intent = PaymentIntentModel(
                organization_id=org_id,
                gateway="stripe",
                gateway_payment_id=session.id,
                amount=plan.price_per_month,
                currency=plan.currency,
                purpose="subscription",
                status="pending",
            )
            s.add(intent)
            await s.commit()

        return {"session_id": session.id, "url": session.url}

    # ------------------------------------------------------------------ #
    # Razorpay — create order (top-up or subscription)
    # ------------------------------------------------------------------ #

    async def create_razorpay_topup_order(
        self,
        org_id: int,
        amount_paise: int,
        minutes: int,
    ) -> dict[str, Any]:
        """Create a Razorpay order for a one-time top-up (amount in paise)."""
        if amount_paise < 100:
            raise ValueError("amount_paise must be >= 100 (min Rs 1)")
        if minutes <= 0:
            raise ValueError("minutes must be > 0")
        try:
            rz = _razorpay_client()
            order = rz.order.create({
                "amount": amount_paise,
                "currency": "INR",
                "notes": {"org_id": str(org_id), "minutes": str(minutes), "purpose": "topup"},
            })
        except (RuntimeError, ValueError):
            raise
        except Exception as e:
            from api.services.billing.gateways.razorpay_gateway import (
                _clean_gateway_error,
            )

            logger.error(f"Razorpay order.create failed org={org_id}: {e}")
            raise RuntimeError(_clean_gateway_error(e))

        async with self.async_session() as s:
            intent = PaymentIntentModel(
                organization_id=org_id,
                gateway="razorpay",
                gateway_payment_id=order["id"],
                amount=Decimal(amount_paise) / 100,
                currency="INR",
                purpose="topup",
                status="pending",
                minutes_to_credit=minutes,
            )
            s.add(intent)
            await s.commit()

        return {
            "order_id": order["id"],
            "amount": amount_paise,
            "currency": "INR",
            "key_id": os.getenv("RAZORPAY_KEY_ID", ""),
        }

    async def create_razorpay_subscription(
        self,
        org_id: int,
        plan: BillingPlanModel,
    ) -> dict[str, Any]:
        """Create a Razorpay subscription for a recurring plan."""
        rz = _razorpay_client()
        if not plan.razorpay_plan_id:
            raise ValueError(f"Plan {plan.name} has no razorpay_plan_id configured")

        try:
            sub = rz.subscription.create({
                "plan_id": plan.razorpay_plan_id,
                "total_count": 12,  # 12 billing cycles
                "notes": {"org_id": str(org_id), "plan_id": str(plan.id)},
            })
        except (RuntimeError, ValueError):
            raise
        except Exception as e:
            from api.services.billing.gateways.razorpay_gateway import (
                _clean_gateway_error,
            )

            logger.error(f"Razorpay subscription.create failed org={org_id}: {e}")
            raise RuntimeError(_clean_gateway_error(e))

        async with self.async_session() as s:
            intent = PaymentIntentModel(
                organization_id=org_id,
                gateway="razorpay",
                gateway_payment_id=sub["id"],
                amount=plan.price_per_month,
                currency="INR",
                purpose="subscription",
                status="pending",
            )
            s.add(intent)
            await s.commit()

        return {
            "subscription_id": sub["id"],
            "key_id": os.getenv("RAZORPAY_KEY_ID", ""),
        }

    # ------------------------------------------------------------------ #
    # Payment confirmation (frontend return path — verified server-side)
    # ------------------------------------------------------------------ #

    async def confirm_stripe_session(self, session_id: str, org_id: int) -> dict:
        """Verify Checkout session with Stripe and credit wallet (idempotent)."""
        stripe = _stripe_client()
        try:
            session = stripe.checkout.Session.retrieve(session_id)
        except Exception as e:
            logger.error(f"Stripe retrieve failed for {session_id}: {e}")
            raise RuntimeError(f"Stripe retrieve failed: {e}")

        payment_ok = session.payment_status in ("paid", "no_payment_required")
        session_complete = getattr(session, "status", None) == "complete"
        has_subscription = bool(getattr(session, "subscription", None))
        if not payment_ok and not (session_complete and has_subscription):
            logger.warning(f"Stripe session {session_id} not paid yet: payment_status={session.payment_status} status={getattr(session,'status',None)}")
            return {"status": "pending", "message": "Payment not completed yet", "payment_status": session.payment_status}

        raw_meta = session.metadata or {}
        try:
            meta = dict(raw_meta) if not isinstance(raw_meta, dict) else raw_meta
        except Exception:
            meta = getattr(raw_meta, "to_dict", lambda: {})() if hasattr(raw_meta, "to_dict") else {}

        def _mget(k, default=""):
            return meta.get(k, default) if isinstance(meta, dict) else getattr(meta, k, default)

        purpose = _mget("purpose", "")
        sid = session.id

        # Fallback: look up stored PaymentIntent when metadata is missing
        if not purpose:
            async with self.async_session() as s:
                r = await s.execute(
                    select(PaymentIntentModel).where(PaymentIntentModel.gateway_payment_id == sid)
                )
                intent = r.scalar_one_or_none()
                if intent:
                    purpose = intent.purpose or ""
                    if not _mget("plan_id") and intent.metadata_:
                        try:
                            meta = {**meta, **{k: str(v) for k, v in (intent.metadata_ or {}).items()}}
                        except Exception:
                            pass
                    logger.info(f"Stripe session {sid} purpose fallback to PaymentIntent: {purpose}")

        # Idempotency: already succeeded -> repair subscription link if needed
        async with self.async_session() as s:
            r = await s.execute(
                select(PaymentIntentModel).where(
                    PaymentIntentModel.gateway_payment_id == sid,
                    PaymentIntentModel.status == "succeeded",
                )
            )
            if r.scalar_one_or_none():
                if purpose == "subscription":
                    _pid = meta.get("plan_id", 0) if isinstance(meta, dict) else getattr(meta, "plan_id", 0)
                    plan_id = int(_pid or 0)
                    if plan_id:
                        wallet = await self.get_wallet(org_id)
                        if not wallet or wallet.billing_plan_id != plan_id:
                            plan = await self.get_plan(plan_id)
                            if plan:
                                logger.info(f"Repairing missing subscription for org {org_id} plan {plan_id}")
                                await self._activate_subscription(org_id, plan, "stripe", getattr(session, "subscription", None))
                return {"status": "already_processed"}

        if purpose == "topup":
            _mins = meta.get("minutes", 0) if isinstance(meta, dict) else getattr(meta, "minutes", 0)
            minutes = int(_mins or 0)
            if minutes == 0:
                async with self.async_session() as s:
                    r = await s.execute(select(PaymentIntentModel).where(PaymentIntentModel.gateway_payment_id == sid))
                    intent = r.scalar_one_or_none()
                    if intent and intent.minutes_to_credit:
                        minutes = intent.minutes_to_credit
            amount = Decimal(str(session.amount_total or 0)) / 100
            if amount == 0:
                async with self.async_session() as s:
                    r = await s.execute(select(PaymentIntentModel).where(PaymentIntentModel.gateway_payment_id == sid))
                    intent = r.scalar_one_or_none()
                    if intent:
                        amount = intent.amount
            currency = (session.currency or "usd").upper()
            await self._complete_payment(sid, "stripe", org_id, amount, currency, purpose, minutes)
            logger.info(f"Stripe topup confirmed: org={org_id} sid={sid} minutes={minutes} amount={amount}")
            return {"status": "credited", "minutes": minutes, "amount": float(amount), "currency": currency}

        elif purpose == "subscription":
            _pid2 = meta.get("plan_id", 0) if isinstance(meta, dict) else getattr(meta, "plan_id", 0)
            plan_id = int(_pid2 or 0)
            if not plan_id:
                logger.warning(f"Stripe subscription session {sid} missing plan_id, attempting price lookup")
                try:
                    line_items = stripe.checkout.Session.list_line_items(sid, limit=1)
                    if line_items.data:
                        price_id = line_items.data[0].price.id if line_items.data[0].price else None
                        if price_id:
                            from api.db.billing_client import billing_client

                            plan_by_price = await billing_client.get_plan_by_stripe_price(price_id)
                            if plan_by_price:
                                plan_id = plan_by_price.id
                                meta["plan_id"] = str(plan_id)
                except Exception as e:
                    logger.warning(f"Price lookup failed for {sid}: {e}")
            plan = await self.get_plan(plan_id) if plan_id else None
            if plan:
                await self._activate_subscription(org_id, plan, "stripe", getattr(session, "subscription", None))
                await self._complete_payment(sid, "stripe", org_id, plan.price_per_month, plan.currency, purpose)
                logger.info(f"Stripe subscription confirmed: org={org_id} sid={sid} plan={plan.name}")
                return {"status": "subscribed", "plan": plan.name}
            logger.error(f"Plan not found for subscription session {sid} plan_id={plan_id}")
            return {"status": "error", "message": f"Plan {plan_id} not found"}

        logger.warning(f"Stripe session {sid} unknown purpose: meta={meta}")
        return {"status": "unknown_purpose", "meta": meta}

    async def confirm_razorpay_payment(
        self,
        org_id: int,
        razorpay_payment_id: str,
        razorpay_order_id: str | None = None,
        razorpay_signature: str | None = None,
        razorpay_subscription_id: str | None = None,
    ) -> dict[str, Any]:
        """Verify Razorpay payment server-side and credit wallet (idempotent)."""
        rz = _razorpay_client()

        if razorpay_order_id and razorpay_signature:
            try:
                rz.utility.verify_payment_signature({
                    "razorpay_order_id": razorpay_order_id,
                    "razorpay_payment_id": razorpay_payment_id,
                    "razorpay_signature": razorpay_signature,
                })
            except Exception as e:
                logger.error(f"Razorpay payment signature error for order {razorpay_order_id}: {e}")
        elif razorpay_subscription_id and razorpay_signature:
            try:
                rz.utility.verify_subscription_payment_signature({
                    "razorpay_subscription_id": razorpay_subscription_id,
                    "razorpay_payment_id": razorpay_payment_id,
                    "razorpay_signature": razorpay_signature,
                })
            except Exception as e:
                logger.error(f"Razorpay subscription signature error: {e}")

        try:
            payment = rz.payment.fetch(razorpay_payment_id)
        except Exception as e:
            logger.error(f"Razorpay fetch payment failed for {razorpay_payment_id}: {e}")
            raise RuntimeError(f"Razorpay payment lookup failed: {e}")

        payment_status = payment.get("status")
        if payment_status not in ("captured", "authorized"):
            logger.warning(f"Razorpay payment {razorpay_payment_id} status is {payment_status}")
            return {"status": "pending", "message": f"Payment status is {payment_status}"}

        lookup_id = razorpay_order_id or payment.get("order_id") or razorpay_subscription_id or razorpay_payment_id

        async with self.async_session() as s:
            r = await s.execute(
                select(PaymentIntentModel).where(
                    PaymentIntentModel.gateway == "razorpay",
                    PaymentIntentModel.gateway_payment_id == lookup_id,
                )
            )
            intent = r.scalar_one_or_none()
            if intent and intent.status == "succeeded":
                return {"status": "already_processed"}

        notes = payment.get("notes") or {}
        if razorpay_order_id and not notes:
            try:
                order = rz.order.fetch(razorpay_order_id)
                notes = order.get("notes") or {}
            except Exception:
                pass

        purpose = (intent.purpose if intent else None) or notes.get("purpose", "topup")
        minutes = (intent.minutes_to_credit if intent else None) or int(notes.get("minutes", 0))
        amount = intent.amount if intent else Decimal(str(payment.get("amount", 0))) / 100
        currency = payment.get("currency", "INR").upper()

        if purpose == "topup":
            if minutes == 0 and amount > 0:
                minutes = int(amount / Decimal("0.05"))
            await self._complete_payment(lookup_id, "razorpay", org_id, amount, currency, purpose, minutes)
            logger.info(f"Razorpay topup confirmed: org={org_id} payment={razorpay_payment_id} minutes={minutes} amount={amount}")
            return {"status": "credited", "minutes": minutes, "amount": float(amount), "currency": currency}

        elif purpose == "subscription":
            plan_id = int(notes.get("plan_id", 0))
            plan = await self.get_plan(plan_id) if plan_id else None
            if plan:
                await self._activate_subscription(org_id, plan, "razorpay", razorpay_subscription_id)
                await self._complete_payment(lookup_id, "razorpay", org_id, plan.price_per_month, plan.currency, purpose)
                logger.info(f"Razorpay subscription confirmed: org={org_id} payment={razorpay_payment_id} plan={plan.name}")
                return {"status": "subscribed", "plan": plan.name}
            return {"status": "error", "message": f"Plan {plan_id} not found"}

        return {"status": "unknown_purpose"}

    async def sync_pending_razorpay_payments(self, org_id: int) -> int:
        """Explicit pending sync — call from ARQ cron, NOT from GET paths."""
        from api.services.billing.reconciliation import sync_pending_razorpay_org

        return await sync_pending_razorpay_org(org_id)

    # ------------------------------------------------------------------ #
    # Webhook handlers (signature-verified, idempotent)
    # ------------------------------------------------------------------ #

    async def handle_stripe_webhook(self, payload: bytes, sig_header: str | None) -> str:
        """Process Stripe webhook. Fails closed when secret is configured."""
        import json

        webhook_secret = os.getenv("STRIPE_WEBHOOK_SECRET", "")
        try:
            if webhook_secret:
                import stripe as stripe_lib

                if not sig_header:
                    raise ValueError("Missing Stripe-Signature header")
                event = stripe_lib.Webhook.construct_event(payload, sig_header, webhook_secret)
                etype = event["type"]
                data = event["data"]["object"]
            else:
                import stripe as stripe_lib

                logger.warning("Stripe webhook without signature verification (STRIPE_WEBHOOK_SECRET not set)")
                event = stripe_lib.Event.construct_from(json.loads(payload), stripe_lib.api_key)
                etype = event["type"]
                data = event["data"]["object"]
        except ValueError:
            raise
        except Exception as e:
            raise ValueError(f"Invalid Stripe webhook: {e}")

        # Derive org from stored intent when metadata is missing
        if etype == "checkout.session.completed":
            session_id = data["id"]
            meta = data.get("metadata", {}) or {}
            org_id = int(meta.get("org_id", 0) or 0)
            purpose = meta.get("purpose", "")
            if not org_id or not purpose:
                async with self.async_session() as s:
                    r = await s.execute(
                        select(PaymentIntentModel).where(
                            PaymentIntentModel.gateway_payment_id == session_id
                        )
                    )
                    intent = r.scalar_one_or_none()
                    if intent:
                        org_id = intent.organization_id
                        purpose = purpose or intent.purpose
            if not org_id:
                logger.warning(f"Stripe webhook {session_id}: cannot derive org, skipping")
                return etype

            if purpose == "topup":
                minutes = int(meta.get("minutes", 0) or 0)
                amount = Decimal(str(data.get("amount_total", 0))) / 100
                currency = str(data.get("currency", "usd")).upper()
                await self._complete_payment(session_id, "stripe", org_id, amount, currency, purpose, minutes)

            elif purpose == "subscription":
                plan_id = int(meta.get("plan_id", 0) or 0)
                plan = await self.get_plan(plan_id) if plan_id else None
                if plan:
                    await self._activate_subscription(org_id, plan, "stripe", data.get("subscription"))

        elif etype in ("invoice.payment_succeeded",):
            sub_id = data.get("subscription")
            if sub_id:
                await self._handle_stripe_renewal(sub_id, data)

        logger.info(f"Stripe webhook handled: {etype}")
        return etype

    async def handle_razorpay_webhook(
        self, payload: dict, *, raw: bytes | None = None, signature: str | None = None
    ) -> str:
        """Process Razorpay webhook. Verifies signature when secret is configured."""
        if raw is not None:
            secret = os.getenv("RAZORPAY_WEBHOOK_SECRET", "")
            if secret:
                import hashlib
                import hmac

                if not signature:
                    raise ValueError("Missing Razorpay signature")
                expected = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
                if not hmac.compare_digest(expected, signature):
                    raise ValueError("Invalid Razorpay webhook signature")
        event = payload.get("event", "")

        if event == "payment.captured":
            payment = payload.get("payload", {}).get("payment", {}).get("entity", {})
            order_id = payment.get("order_id", "")
            notes = payment.get("notes", {}) or {}
            org_id = int(notes.get("org_id", 0) or 0)
            purpose = notes.get("purpose", "")
            if not org_id and order_id:
                # Derive org from stored intent (don't trust payload alone)
                async with self.async_session() as s:
                    r = await s.execute(
                        select(PaymentIntentModel).where(
                            PaymentIntentModel.gateway_payment_id == order_id
                        )
                    )
                    intent = r.scalar_one_or_none()
                    if intent:
                        org_id = intent.organization_id
                        purpose = purpose or intent.purpose
            if not org_id:
                logger.warning(f"Razorpay webhook order {order_id}: cannot derive org")
                return event
            amount = Decimal(str(payment.get("amount", 0))) / 100
            currency = str(payment.get("currency", "INR")).upper()

            if purpose == "topup":
                minutes = int(notes.get("minutes", 0) or 0)
                await self._complete_payment(order_id, "razorpay", org_id, amount, currency, purpose, minutes)

        elif event == "subscription.charged":
            sub = payload.get("payload", {}).get("subscription", {}).get("entity", {})
            await self._handle_razorpay_renewal(sub)

        logger.info(f"Razorpay webhook handled: {event}")
        return event

    # ── internal helpers ──────────────────────────────────────────────

    async def _complete_payment(
        self, gateway_id: str, gateway: str, org_id: int,
        amount: Decimal, currency: str, purpose: str, minutes: int = 0,
    ) -> dict | None:
        """Idempotent complete: second call is a no-op (fixes double-credit)."""
        from api.services.billing.wallet import wallet_ledger

        return await wallet_ledger.complete_payment_atomically(
            gateway_payment_id=gateway_id,
            gateway=gateway,
            org_id=org_id,
            amount=Decimal(str(amount)),
            currency=currency,
            purpose=purpose,
            minutes=minutes,
        )

    async def complete_razorpay_order(
        self, *, gateway_payment_id: str, org_id: int,
        amount: Decimal, currency: str, purpose: str, minutes: int = 0,
    ) -> dict:
        from api.services.billing.wallet import wallet_ledger

        return await wallet_ledger.complete_payment_atomically(
            gateway_payment_id=gateway_payment_id,
            gateway="razorpay",
            org_id=org_id,
            amount=Decimal(str(amount)),
            currency=currency,
            purpose=purpose,
            minutes=minutes,
        )

    async def _activate_subscription(
        self, org_id: int, plan: BillingPlanModel, gateway: str,
        gateway_sub_id: str | None, *, force_credit: bool = False,
    ) -> None:
        """Activate plan. Skips duplicate credit when already active (idempotent)."""
        from api.services.billing.metering import subscription_credit_amount

        async with self.async_session() as s:
            r = await s.execute(select(OrgWalletModel).where(OrgWalletModel.organization_id == org_id))
            wallet = r.scalar_one_or_none()
            if not wallet:
                wallet = OrgWalletModel(organization_id=org_id, currency=plan.currency, gateway=gateway)
                s.add(wallet)
                await s.flush()
            # Idempotency: same plan, same gateway sub, still valid -> skip re-credit
            if (
                not force_credit
                and wallet.billing_plan_id == plan.id
                and wallet.plan_expires_at is not None
                and wallet.plan_expires_at > datetime.now(UTC) + timedelta(days=20)
            ):
                if gateway == "stripe" and gateway_sub_id:
                    wallet.stripe_subscription_id = gateway_sub_id
                elif gateway == "razorpay" and gateway_sub_id:
                    wallet.razorpay_subscription_id = gateway_sub_id
                wallet.updated_at = datetime.now(UTC)
                await s.commit()
                logger.info(f"Subscription already active org={org_id} plan={plan.name}, skipped credit")
                return
            wallet.billing_plan_id = plan.id
            wallet.plan_expires_at = datetime.now(UTC) + timedelta(days=30)
            if gateway == "stripe" and gateway_sub_id:
                wallet.stripe_subscription_id = gateway_sub_id
            elif gateway == "razorpay" and gateway_sub_id:
                wallet.razorpay_subscription_id = gateway_sub_id
            wallet.updated_at = datetime.now(UTC)
            await s.commit()

        # Credit the included minutes as balance (separate atomic ledger tx)
        minute_value = subscription_credit_amount(
            included_minutes=plan.included_minutes,
            rate_per_minute=plan.price_per_extra_minute,
        )
        await self.credit_wallet(
            org_id, minute_value, plan.currency,
            "subscription_credit",
            f"Subscription activated: {plan.name} ({plan.included_minutes} mins)",
        )

    async def _handle_stripe_renewal(self, subscription_id: str, invoice_data: dict) -> None:
        from api.db.billing_client import billing_client

        wallet = await billing_client.get_wallet_by_stripe_subscription(subscription_id)
        if not wallet or not wallet.billing_plan_id:
            return
        plan = await self.get_plan(wallet.billing_plan_id)
        if plan:
            await self._activate_subscription(
                wallet.organization_id, plan, "stripe", subscription_id, force_credit=True
            )

    async def _handle_razorpay_renewal(self, sub_entity: dict) -> None:
        from api.db.billing_client import billing_client

        sub_id = sub_entity.get("id", "")
        wallet = await billing_client.get_wallet_by_razorpay_subscription(sub_id)
        if not wallet or not wallet.billing_plan_id:
            return
        plan = await self.get_plan(wallet.billing_plan_id)
        if plan:
            await self._activate_subscription(
                wallet.organization_id, plan, "razorpay", sub_id, force_credit=True
            )


billing_service = BillingService()
