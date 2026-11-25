"""Stripe gateway adapter — thin wrapper over stripe SDK."""
from __future__ import annotations

import json
import os
from decimal import Decimal
from typing import Any

from loguru import logger


def _client():
    import stripe

    key = os.getenv("STRIPE_SECRET_KEY", "")
    if not key:
        raise RuntimeError("STRIPE_SECRET_KEY is not set in api/.env")
    stripe.api_key = key
    return stripe


class StripeGateway:
    name = "stripe"

    async def create_topup(
        self, *, org_id: int, amount_minor: int, currency: str,
        minutes: int, success_url: str = "", cancel_url: str = "",
    ) -> dict[str, Any]:
        stripe = _client()
        session = stripe.checkout.Session.create(
            mode="payment",
            line_items=[{
                "price_data": {
                    "currency": currency.lower(),
                    "unit_amount": amount_minor,
                    "product_data": {"name": f"{minutes} minutes top-up"},
                },
                "quantity": 1,
            }],
            success_url=success_url,
            cancel_url=cancel_url,
            metadata={"org_id": str(org_id), "minutes": str(minutes), "purpose": "topup"},
        )
        return {"session_id": session.id, "url": session.url}

    async def create_subscription(self, *, org_id: int, plan) -> dict[str, Any]:
        stripe = _client()
        if not getattr(plan, "stripe_price_id", None):
            raise ValueError(f"Plan {plan.name} has no stripe_price_id configured")
        # NOTE: success/cancel URLs are passed by the service layer caller
        raise NotImplementedError("use BillingService.create_stripe_subscription_session for URL wiring")

    def verify_webhook(self, *, raw: bytes, signature: str | None) -> dict[str, Any]:
        import stripe as stripe_lib

        secret = os.getenv("STRIPE_WEBHOOK_SECRET", "")
        if not secret:
            # Fail closed in production, warn in dev
            if os.getenv("DEPLOYMENT_MODE", "oss") != "oss" or os.getenv("ENV", "dev") == "prod":
                raise ValueError("STRIPE_WEBHOOK_SECRET is not configured")
            logger.warning("Stripe webhook without signature verification (no secret set)")
            return json.loads(raw.decode() or "{}")
        if not signature:
            raise ValueError("Missing Stripe-Signature header")
        try:
            event = stripe_lib.Webhook.construct_event(raw, signature, secret)
            return {"type": event["type"], "object": event["data"]["object"]}
        except Exception as e:
            raise ValueError(f"Invalid Stripe webhook: {e}")

    async def fetch_session(self, session_id: str):
        return _client().checkout.Session.retrieve(session_id)

    async def fetch_payment(self, payment_id: str) -> dict[str, Any]:
        s = await self.fetch_session(payment_id)
        return {"id": s.id, "status": getattr(s, "payment_status", "")}


stripe_gateway = StripeGateway()
