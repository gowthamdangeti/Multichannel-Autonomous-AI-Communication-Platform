from decimal import Decimal
from types import SimpleNamespace

import pytest

from api.services.billing.metering import (
    calc_usage_charge,
    quantize_minutes,
    subscription_credit_amount,
)


def test_quantize_minutes_rounds_up():
    assert quantize_minutes(0) == Decimal("0")
    assert quantize_minutes(-5) == Decimal("0")
    assert quantize_minutes(60) == Decimal("1.00")
    # 61s -> 1.0166.. -> 1.02 (never under-bills)
    assert quantize_minutes(61) == Decimal("1.02")


def test_calc_usage_charge_math():
    c = calc_usage_charge(
        duration_sec=120, rate=Decimal("0.05"), currency="usd", workflow_run_id=9
    )
    assert c.minutes_billed == Decimal("2.00")
    assert c.amount == Decimal("0.1000")
    assert c.currency == "USD"
    assert "run 9" in c.description


def test_calc_usage_charge_floor_for_tiny_calls():
    c = calc_usage_charge(
        duration_sec=0.5, rate=Decimal("0.05"), currency="INR", workflow_run_id=1
    )
    assert c.amount > 0


def test_subscription_credit_amount():
    assert subscription_credit_amount(included_minutes=100, rate_per_minute="0.05") == Decimal(
        "5.0000"
    )


@pytest.mark.asyncio
async def test_complete_payment_returns_already_processed_for_succeeded_intent():
    """Second complete for the same gateway id must not credit twice."""
    from unittest.mock import AsyncMock

    from api.services.billing.wallet import WalletLedger

    ledger = WalletLedger()
    session = AsyncMock()
    intent = SimpleNamespace(
        status="succeeded",
        organization_id=1,
        purpose="topup",
        minutes_to_credit=50,
        amount=Decimal("2.5"),
        currency="INR",
    )
    result = SimpleNamespace(scalar_one_or_none=lambda: intent)
    session.execute.return_value = result

    class Ctx:
        async def __aenter__(self):
            return session

        async def __aexit__(self, *a):
            return False

    ledger.async_session = lambda: Ctx()
    out = await ledger.complete_payment_atomically(
        gateway_payment_id="order_1",
        gateway="razorpay",
        org_id=1,
        amount=Decimal("2.5"),
        currency="INR",
        purpose="topup",
        minutes=50,
    )
    assert out == {"status": "already_processed"}
    session.add.assert_not_called()
    session.commit.assert_not_called()


def test_clean_gateway_error_maps_auth():
    from api.services.billing.gateways.razorpay_gateway import _clean_gateway_error

    assert "authentication failed" in _clean_gateway_error(Exception("Authentication failed")).lower()
    assert "Razorpay request failed" in _clean_gateway_error(Exception("boom"))


@pytest.mark.asyncio
async def test_create_razorpay_topup_validates_amount():
    from api.services.billing.service import billing_service

    with pytest.raises(ValueError):
        await billing_service.create_razorpay_topup_order(org_id=1, amount_paise=50, minutes=10)
    with pytest.raises(ValueError):
        await billing_service.create_razorpay_topup_order(org_id=1, amount_paise=500, minutes=0)


@pytest.mark.asyncio
async def test_create_razorpay_topup_auth_error_becomes_runtime(monkeypatch):
    from api.services.billing import service as svc

    class BoomOrder:
        def create(self, *a, **k):
            raise Exception("Authentication failed")

    class BoomClient:
        order = BoomOrder()

    monkeypatch.setattr(svc, "_razorpay_client", lambda: BoomClient())
    with pytest.raises(RuntimeError, match="authentication failed"):
        await svc.billing_service.create_razorpay_topup_order(
            org_id=1, amount_paise=500, minutes=10
        )
