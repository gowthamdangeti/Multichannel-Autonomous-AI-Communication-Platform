from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from api.services.configuration import model_pricing

RULES = [SimpleNamespace(pattern="gpt-4o")]


def _user(*, is_superuser: bool = False) -> SimpleNamespace:
    return SimpleNamespace(id=1, selected_organization_id=2, is_superuser=is_superuser)


def _patched(*, managed: bool):
    resolve = AsyncMock(return_value=SimpleNamespace(managed=managed))
    client = SimpleNamespace(list_pricing_rules=AsyncMock(return_value=RULES))
    return (
        resolve,
        patch.object(model_pricing, "get_resolved_ai_model_configuration", resolve),
        patch.object(model_pricing, "ModelPricingClient", return_value=client),
    )


@pytest.mark.asyncio
async def test_managed_org_user_gets_no_rules():
    _, resolve_patch, client_patch = _patched(managed=True)
    with resolve_patch, client_patch:
        assert await model_pricing.list_visible_pricing_rules(user=_user()) == []


@pytest.mark.asyncio
async def test_own_key_org_user_gets_rules():
    _, resolve_patch, client_patch = _patched(managed=False)
    with resolve_patch, client_patch:
        assert await model_pricing.list_visible_pricing_rules(user=_user()) == RULES


@pytest.mark.asyncio
async def test_superuser_gets_rules_without_config_lookup():
    resolve, resolve_patch, client_patch = _patched(managed=True)
    with resolve_patch, client_patch:
        rules = await model_pricing.list_visible_pricing_rules(user=_user(is_superuser=True))
    assert rules == RULES
    resolve.assert_not_called()
