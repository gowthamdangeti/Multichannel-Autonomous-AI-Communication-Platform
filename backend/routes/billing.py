"""Convozent billing routes — thin handlers only.

Domain logic lives in services/billing/*, DB access in db/billing_client.py.
Handlers: parse/validate -> resolve org_id -> delegate -> shape response.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel

from api.db.models import UserModel
from api.db.platform_client import platform_client
from api.services.auth.depends import get_superuser, get_user
from api.services.billing.service import billing_service

router = APIRouter(prefix="/billing", tags=["billing"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class PlanResponse(BaseModel):
    id: int
    name: str
    description: str | None
    currency: str
    price_per_month: float
    included_minutes: int
    included_messages: int
    price_per_extra_minute: float
    price_per_extra_message: float
    is_active: bool
    stripe_product_id: str | None = None
    stripe_price_id: str | None = None
    razorpay_plan_id: str | None = None

    class Config:
        from_attributes = True


class WalletResponse(BaseModel):
    organization_id: int
    balance: float
    currency: str
    gateway: str
    exhaustion_policy: str
    billing_plan_id: int | None
    plan_expires_at: str | None

    class Config:
        from_attributes = True


class TransactionResponse(BaseModel):
    id: int
    amount: float
    currency: str
    tx_type: str
    description: str | None
    balance_after: float
    workflow_run_id: int | None = None
    created_at: str

    class Config:
        from_attributes = True


class TopupStripeRequest(BaseModel):
    amount_cents: int       # e.g. 50000 = $500.00
    currency: str = "USD"
    minutes: int
    success_url: str
    cancel_url: str


class TopupRazorpayRequest(BaseModel):
    amount_paise: int       # e.g. 50000 = ₹500.00
    minutes: int


class SubscribeStripeRequest(BaseModel):
    plan_id: int
    success_url: str
    cancel_url: str


class SubscribeRazorpayRequest(BaseModel):
    plan_id: int


class AdminPlanCreate(BaseModel):
    name: str
    description: str | None = None
    currency: str = "USD"
    price_per_month: float
    included_minutes: int = 100
    included_messages: int = 1000
    price_per_extra_minute: float = 0.05
    price_per_extra_message: float = 0.001
    stripe_product_id: str | None = None
    stripe_price_id: str | None = None
    razorpay_plan_id: str | None = None
    is_active: bool = True


class AdminWalletUpdate(BaseModel):
    currency: str | None = None
    gateway: str | None = None
    exhaustion_policy: str | None = None
    billing_plan_id: int | None = None


def _require_org(user: UserModel) -> int:
    org_id = user.selected_organization_id
    if not org_id:
        raise HTTPException(400, "No organization selected")
    return org_id


def _wallet_response(wallet) -> WalletResponse:
    return WalletResponse(
        organization_id=wallet.organization_id,
        balance=float(wallet.balance),
        currency=wallet.currency,
        gateway=wallet.gateway,
        exhaustion_policy=wallet.exhaustion_policy,
        billing_plan_id=wallet.billing_plan_id,
        plan_expires_at=wallet.plan_expires_at.isoformat() if wallet.plan_expires_at else None,
    )


def _tx_response(t) -> TransactionResponse:
    return TransactionResponse(
        id=t.id, amount=float(t.amount), currency=t.currency,
        tx_type=t.tx_type, description=t.description,
        balance_after=float(t.balance_after),
        workflow_run_id=t.workflow_run_id,
        created_at=t.created_at.isoformat(),
    )


# ── Org-user endpoints ────────────────────────────────────────────────────────

@router.get("/public-plans", response_model=list[PlanResponse])
async def list_public_plans(currency: str | None = None):
    """Public endpoint to list active plans configured by admins in the database."""
    plans = await billing_service.list_plans(currency=currency)
    return [PlanResponse.model_validate(p) for p in plans]


@router.get("/plans", response_model=list[PlanResponse])
async def list_plans(
    currency: str | None = None,
    user: UserModel = Depends(get_user),
):
    """List active admin-configured plans for current currency."""
    plans = await billing_service.list_plans(currency=currency)
    return [PlanResponse.model_validate(p) for p in plans]


@router.get("/wallet", response_model=WalletResponse)
async def get_wallet(user: UserModel = Depends(get_user)):
    org_id = _require_org(user)
    wallet = await billing_service.get_wallet_view(
        org_id,
        country=getattr(user, "country", None),
        phone_number=getattr(user, "phone_number", None),
    )
    return _wallet_response(wallet)


@router.get("/transactions/count")
async def get_transactions_count(user: UserModel = Depends(get_user)):
    org_id = _require_org(user)
    cnt = await billing_service.count_wallet_transactions(org_id)
    return {"count": cnt}


@router.get("/transactions", response_model=list[TransactionResponse])
async def get_transactions(
    limit: int = 50,
    offset: int = 0,
    user: UserModel = Depends(get_user),
):
    org_id = _require_org(user)
    txs = await billing_service.get_wallet_transactions(org_id, limit=limit, offset=offset)
    return [_tx_response(t) for t in txs]


@router.post("/topup/stripe")
async def topup_stripe(body: TopupStripeRequest, user: UserModel = Depends(get_user)):
    org_id = _require_org(user)
    try:
        return await billing_service.create_stripe_topup_session(
            org_id=org_id,
            amount_cents=body.amount_cents,
            currency=body.currency,
            minutes=body.minutes,
            success_url=body.success_url,
            cancel_url=body.cancel_url,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except RuntimeError as e:
        raise HTTPException(502, str(e))


@router.post("/topup/razorpay")
async def topup_razorpay(body: TopupRazorpayRequest, user: UserModel = Depends(get_user)):
    org_id = _require_org(user)
    try:
        return await billing_service.create_razorpay_topup_order(
            org_id=org_id, amount_paise=body.amount_paise, minutes=body.minutes
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except RuntimeError as e:
        # Gateway rejected (bad keys, network) -> 502, not 500 traceback
        raise HTTPException(502, str(e))


@router.post("/subscribe/stripe")
async def subscribe_stripe(body: SubscribeStripeRequest, user: UserModel = Depends(get_user)):
    org_id = _require_org(user)
    plan = await billing_service.get_plan(body.plan_id)
    if not plan:
        raise HTTPException(404, "Plan not found")
    try:
        return await billing_service.create_stripe_subscription_session(
            org_id=org_id, plan=plan, success_url=body.success_url, cancel_url=body.cancel_url
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except RuntimeError as e:
        raise HTTPException(502, str(e))


@router.post("/subscribe/razorpay")
async def subscribe_razorpay(body: SubscribeRazorpayRequest, user: UserModel = Depends(get_user)):
    org_id = _require_org(user)
    plan = await billing_service.get_plan(body.plan_id)
    if not plan:
        raise HTTPException(404, "Plan not found")
    try:
        return await billing_service.create_razorpay_subscription(org_id=org_id, plan=plan)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except RuntimeError as e:
        raise HTTPException(502, str(e))


# ── Payment confirmation (called from frontend success redirect) ──────────────

class ConfirmStripeRequest(BaseModel):
    session_id: str


@router.post("/confirm/stripe")
async def confirm_stripe(body: ConfirmStripeRequest, user: UserModel = Depends(get_user)):
    org_id = _require_org(user)
    try:
        return await billing_service.confirm_stripe_session(body.session_id, org_id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except RuntimeError as e:
        raise HTTPException(502, str(e))


class ConfirmRazorpayRequest(BaseModel):
    razorpay_payment_id: str
    razorpay_order_id: str | None = None
    razorpay_signature: str | None = None
    razorpay_subscription_id: str | None = None


@router.post("/confirm/razorpay")
async def confirm_razorpay(body: ConfirmRazorpayRequest, user: UserModel = Depends(get_user)):
    org_id = _require_org(user)
    try:
        return await billing_service.confirm_razorpay_payment(
            org_id=org_id,
            razorpay_payment_id=body.razorpay_payment_id,
            razorpay_order_id=body.razorpay_order_id,
            razorpay_signature=body.razorpay_signature,
            razorpay_subscription_id=body.razorpay_subscription_id,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except RuntimeError as e:
        raise HTTPException(502, str(e))


# ── Subscription management (org user) ──────────────────────────────────────

@router.delete("/subscription", status_code=200)
async def cancel_subscription(user: UserModel = Depends(get_user)):
    """Org cancels current plan — clears wallet plan but keeps balance."""
    org_id = _require_org(user)
    ok = await billing_service.cancel_subscription(org_id)
    if not ok:
        raise HTTPException(400, "No active subscription to cancel")
    return {"ok": True, "message": "Subscription cancelled. Balance retained."}


# ── Webhook endpoints (no auth — signature-verified internally) ───────────────

@router.post("/webhooks/stripe", status_code=200)
async def stripe_webhook(
    request: Request,
    stripe_signature: str | None = Header(None, alias="Stripe-Signature"),
):
    payload = await request.body()
    if not stripe_signature:
        # Fail closed when a secret is configured; dev without secret still works
        import os

        if os.getenv("STRIPE_WEBHOOK_SECRET", ""):
            raise HTTPException(400, "Missing Stripe-Signature header")
    try:
        etype = await billing_service.handle_stripe_webhook(payload, stripe_signature or "")
        return {"received": True, "type": etype}
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/webhooks/razorpay", status_code=200)
async def razorpay_webhook(
    request: Request,
    razorpay_signature: str | None = Header(None, alias="X-Razorpay-Signature"),
):
    raw = await request.body()
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON payload")
    try:
        etype = await billing_service.handle_razorpay_webhook(
            payload, raw=raw, signature=razorpay_signature
        )
        return {"received": True, "event": etype}
    except ValueError as e:
        raise HTTPException(400, str(e))


# ── Admin billing endpoints (super-admin only) ────────────────────────────────

admin_billing_router = APIRouter(prefix="/admin/billing", tags=["admin-billing"])


@admin_billing_router.get("/plans", response_model=list[PlanResponse])
async def admin_list_plans(_: UserModel = Depends(get_superuser)):
    plans = await billing_service.list_plans(active_only=False)
    return [PlanResponse.model_validate(p) for p in plans]


@admin_billing_router.post("/plans", response_model=PlanResponse, status_code=201)
async def admin_create_plan(body: AdminPlanCreate, _: UserModel = Depends(get_superuser)):
    # Strip gateway IDs — they are auto-provisioned by the service
    data = body.model_dump()
    data.pop("stripe_product_id", None)
    data.pop("stripe_price_id", None)
    data.pop("razorpay_plan_id", None)
    plan = await billing_service.create_plan(data)
    return PlanResponse.model_validate(plan)


@admin_billing_router.patch("/plans/{plan_id}", response_model=PlanResponse)
async def admin_update_plan(plan_id: int, body: AdminPlanCreate, _: UserModel = Depends(get_superuser)):
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    plan = await billing_service.update_plan(plan_id, data)
    if not plan:
        raise HTTPException(404, "Plan not found")
    return PlanResponse.model_validate(plan)


@admin_billing_router.get("/orgs/{org_id}/wallet", response_model=WalletResponse)
async def admin_get_wallet(org_id: int, _: UserModel = Depends(get_superuser)):
    wallet = await billing_service.get_wallet(org_id)
    if not wallet:
        raise HTTPException(404, "No wallet for this org")
    return _wallet_response(wallet)


@admin_billing_router.put("/orgs/{org_id}/wallet")
async def admin_upsert_wallet(org_id: int, body: AdminWalletUpdate, _: UserModel = Depends(get_superuser)):
    org = await platform_client.get_organization_by_id(org_id)
    if not org:
        raise HTTPException(404, "Organization not found")

    updates = body.model_dump(exclude_unset=True)
    plan_id = updates.get("billing_plan_id")
    if plan_id is not None and not await billing_service.get_plan(plan_id):
        raise HTTPException(404, "Billing plan not found")

    await billing_service.get_or_create_wallet(org_id)
    wallet = await billing_service.update_wallet_admin(org_id, updates)
    if not wallet:
        raise HTTPException(404, "No wallet for this org")
    return {"ok": True}


@admin_billing_router.get("/orgs/{org_id}/transactions", response_model=list[TransactionResponse])
async def admin_get_transactions(
    org_id: int, limit: int = 50, offset: int = 0, _: UserModel = Depends(get_superuser)
):
    txs = await billing_service.get_wallet_transactions(org_id, limit=limit, offset=offset)
    return [_tx_response(t) for t in txs]


@admin_billing_router.get("/diag")
async def admin_billing_diag(_: UserModel = Depends(get_superuser)):
    """Gateway key diagnostics — mode + lengths only, never values.

    Use this to tell file-vs-running-backend apart: if you edited api/.env
    but this still shows secret_len=24, the backend was not restarted.
    """
    import os

    kid = os.getenv("RAZORPAY_KEY_ID", "").strip()
    sec = os.getenv("RAZORPAY_KEY_SECRET", "").strip()
    sk = os.getenv("STRIPE_SECRET_KEY", "").strip()
    mode = "test" if kid.startswith("rzp_test_") else ("live" if kid.startswith("rzp_live_") else "unknown")
    sk_mode = "test" if sk.startswith("sk_test_") else ("live" if sk.startswith("sk_live_") else "unknown")
    return {
        "razorpay": {
            "key_mode": mode,
            "key_id_len": len(kid),
            "secret_len": len(sec),
            "secret_ok": len(sec) >= 30,
            "webhook_secret_set": bool(os.getenv("RAZORPAY_WEBHOOK_SECRET", "")),
        },
        "stripe": {
            "key_mode": sk_mode,
            "key_set": bool(sk),
            "webhook_secret_set": bool(os.getenv("STRIPE_WEBHOOK_SECRET", "")),
        },
    }
