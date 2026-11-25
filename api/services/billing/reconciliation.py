"""Billing reconciliation — background sync, never in GET paths.

- sync_pending_razorpay_org: poll Razorpay for pending orders of one org
- reconcile_stale_intents: cron over stale pending intents (both gateways)
"""
from __future__ import annotations

from decimal import Decimal

from loguru import logger


async def sync_pending_razorpay_org(org_id: int) -> int:
    """Sync pending Razorpay orders captured on the gateway. Returns synced count."""
    from api.db.billing_client import billing_client
    from api.services.billing.service import billing_service

    intents = await billing_client.list_pending_razorpay_intents(org_id)
    if not intents:
        return 0
    try:
        from api.services.billing.gateways.razorpay_gateway import razorpay_gateway
    except Exception as e:
        logger.warning(f"Razorpay client unavailable for sync org={org_id}: {e}")
        return 0

    synced = 0
    for intent in intents:
        try:
            items = await razorpay_gateway.order_payments(intent.gateway_payment_id or "")
            for p in items:
                if p.get("status") in ("captured", "authorized"):
                    await billing_service.complete_razorpay_order(
                        gateway_payment_id=intent.gateway_payment_id or "",
                        org_id=org_id,
                        amount=Decimal(str(intent.amount)),
                        currency=intent.currency,
                        purpose=intent.purpose,
                        minutes=intent.minutes_to_credit or 0,
                    )
                    synced += 1
                    logger.info(
                        f"Auto-synced pending Razorpay intent {intent.id} org={org_id}"
                    )
                    break
        except Exception as e:
            logger.debug(f"Pending sync failed intent={intent.id}: {e}")
    return synced


async def reconcile_stale_intents(_ctx=None, older_than_minutes: int = 15) -> int:
    """ARQ cron: re-check stale pending intents via gateway APIs."""
    from api.db.billing_client import billing_client

    intents = await billing_client.list_stale_pending_intents(
        older_than_minutes=older_than_minutes
    )
    count = 0
    for intent in intents:
        try:
            if intent.gateway == "razorpay":
                count += await sync_pending_razorpay_org(intent.organization_id)
                break  # sync_pending handles all of that org at once
            # Stripe pending sessions expire on their own; just log for now
            logger.info(
                f"[billing-reconcile] stale {intent.gateway} intent "
                f"{intent.id} org={intent.organization_id} purpose={intent.purpose}"
            )
        except Exception as e:
            logger.warning(f"[billing-reconcile] intent {intent.id} failed: {e}")
    return count
