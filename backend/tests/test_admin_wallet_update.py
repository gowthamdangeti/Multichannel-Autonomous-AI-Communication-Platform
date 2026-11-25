from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from api.routes import billing


@pytest.mark.asyncio
async def test_admin_wallet_update_clears_an_explicit_null_plan(monkeypatch):
    wallet = SimpleNamespace(organization_id=1, billing_plan_id=None)
    monkeypatch.setattr(
        billing.platform_client,
        "get_organization_by_id",
        AsyncMock(return_value=SimpleNamespace(id=1)),
    )
    monkeypatch.setattr(
        billing.billing_service,
        "get_or_create_wallet",
        AsyncMock(return_value=wallet),
    )
    update_mock = AsyncMock(return_value=wallet)
    monkeypatch.setattr(billing.billing_service, "update_wallet_admin", update_mock)

    result = await billing.admin_upsert_wallet(
        1,
        billing.AdminWalletUpdate(billing_plan_id=None),
        SimpleNamespace(),
    )

    assert result == {"ok": True}
    update_mock.assert_awaited_once()
    assert update_mock.call_args[0][1] == {"billing_plan_id": None}


@pytest.mark.asyncio
async def test_admin_wallet_update_assigns_a_valid_plan(monkeypatch):
    wallet = SimpleNamespace(organization_id=1, billing_plan_id=7)
    monkeypatch.setattr(
        billing.platform_client,
        "get_organization_by_id",
        AsyncMock(return_value=SimpleNamespace(id=1)),
    )
    monkeypatch.setattr(
        billing.billing_service,
        "get_plan",
        AsyncMock(return_value=SimpleNamespace(id=7)),
    )
    monkeypatch.setattr(
        billing.billing_service,
        "get_or_create_wallet",
        AsyncMock(return_value=wallet),
    )
    update_mock = AsyncMock(return_value=wallet)
    monkeypatch.setattr(billing.billing_service, "update_wallet_admin", update_mock)

    result = await billing.admin_upsert_wallet(
        1,
        billing.AdminWalletUpdate(billing_plan_id=7),
        SimpleNamespace(),
    )

    assert result == {"ok": True}
    update_mock.assert_awaited_once()
    assert update_mock.call_args[0][1] == {"billing_plan_id": 7}


@pytest.mark.asyncio
async def test_admin_wallet_update_rejects_a_missing_organization(monkeypatch):
    monkeypatch.setattr(
        billing.platform_client,
        "get_organization_by_id",
        AsyncMock(return_value=None),
    )

    with pytest.raises(HTTPException) as exc_info:
        await billing.admin_upsert_wallet(
            999,
            billing.AdminWalletUpdate(billing_plan_id=None),
            SimpleNamespace(),
        )

    assert exc_info.value.status_code == 404
    assert exc_info.value.detail == "Organization not found"


@pytest.mark.asyncio
async def test_admin_wallet_update_rejects_a_missing_billing_plan(monkeypatch):
    monkeypatch.setattr(
        billing.platform_client,
        "get_organization_by_id",
        AsyncMock(return_value=SimpleNamespace(id=1)),
    )
    monkeypatch.setattr(
        billing.billing_service,
        "get_plan",
        AsyncMock(return_value=None),
    )

    with pytest.raises(HTTPException) as exc_info:
        await billing.admin_upsert_wallet(
            1,
            billing.AdminWalletUpdate(billing_plan_id=999),
            SimpleNamespace(),
        )

    assert exc_info.value.status_code == 404
    assert exc_info.value.detail == "Billing plan not found"
