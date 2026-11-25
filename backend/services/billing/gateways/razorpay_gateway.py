"""Razorpay gateway adapter — thin wrapper over razorpay SDK."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
from typing import Any


def _client():
    import razorpay

    key_id = os.getenv("RAZORPAY_KEY_ID", "").strip()
    key_secret = os.getenv("RAZORPAY_KEY_SECRET", "").strip()
    if not key_id or not key_secret:
        raise RuntimeError("RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not set in api/.env")
    return razorpay.Client(auth=(key_id, key_secret))


def _clean_gateway_error(e: Exception) -> str:
    """Extract a safe message from razorpay SDK errors (no secrets).

    Includes key mode + secret length (never values) so truncated-key
    paste errors are obvious from the API response alone.
    """
    import os

    msg = str(e) or type(e).__name__
    lower = msg.lower()
    kid = os.getenv("RAZORPAY_KEY_ID", "").strip()
    sec = os.getenv("RAZORPAY_KEY_SECRET", "").strip()
    mode = "test" if kid.startswith("rzp_test_") else ("live" if kid.startswith("rzp_live_") else "unknown")
    diag = f"(key mode={mode}, id_len={len(kid)}, secret_len={len(sec)}, want secret_len~32)"
    if "authentication" in lower or "unauthor" in lower or "401" in lower:
        return (
            "Razorpay authentication failed: key pair rejected " + diag + ". "
            "Re-copy KEY_ID + KEY_SECRET as a pair from the SAME Razorpay mode "
            "(both test or both live) into api/.env, fully stop the backend "
            "(Ctrl+C, not just save — --reload does not reload .env), start again."
        )
    return f"Razorpay request failed {diag}: {msg}"


class RazorpayGateway:
    name = "razorpay"

    async def create_topup(
        self, *, org_id: int, amount_minor: int, currency: str = "INR",
        minutes: int = 0, success_url: str = "", cancel_url: str = "",
    ) -> dict[str, Any]:
        rz = _client()
        order = rz.order.create({
            "amount": amount_minor,
            "currency": "INR",
            "notes": {"org_id": str(org_id), "minutes": str(minutes), "purpose": "topup"},
        })
        return {
            "order_id": order["id"],
            "amount": amount_minor,
            "currency": "INR",
            "key_id": os.getenv("RAZORPAY_KEY_ID", ""),
        }

    async def create_subscription(self, *, org_id: int, plan) -> dict[str, Any]:
        rz = _client()
        if not getattr(plan, "razorpay_plan_id", None):
            raise ValueError(f"Plan {plan.name} has no razorpay_plan_id configured")
        sub = rz.subscription.create({
            "plan_id": plan.razorpay_plan_id,
            "total_count": 12,
            "notes": {"org_id": str(org_id), "plan_id": str(plan.id)},
        })
        return {"subscription_id": sub["id"], "key_id": os.getenv("RAZORPAY_KEY_ID", "")}

    def verify_webhook(self, *, raw: bytes, signature: str | None) -> dict[str, Any]:
        """Verify Razorpay webhook signature (fail closed when secret set)."""
        secret = os.getenv("RAZORPAY_WEBHOOK_SECRET", "")
        payload = json.loads(raw.decode() or "{}")
        if secret:
            if not signature:
                raise ValueError("Missing Razorpay signature")
            expected = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
            if not hmac.compare_digest(expected, signature):
                raise ValueError("Invalid Razorpay webhook signature")
        return payload

    def verify_payment_signature(self, *, order_id: str, payment_id: str, signature: str) -> None:
        _client().utility.verify_payment_signature({
            "razorpay_order_id": order_id,
            "razorpay_payment_id": payment_id,
            "razorpay_signature": signature,
        })

    async def fetch_payment(self, payment_id: str) -> dict[str, Any]:
        return _client().payment.fetch(payment_id)

    async def order_payments(self, order_id: str) -> list[dict]:
        data = _client().order.payments(order_id)
        return data.get("items", [])

    async def fetch_payment_async(self, payment_id: str) -> dict[str, Any]:
        return await self.fetch_payment(payment_id)


razorpay_gateway = RazorpayGateway()
