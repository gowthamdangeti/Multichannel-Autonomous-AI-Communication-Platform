"""Decide who may read provider pricing rules.

Org users on a platform-managed configuration inherit their provider from the
super admin and must not see it, and provider rates would reveal it. They get
no rules; what they pay is their plan rate.
"""

from __future__ import annotations

from api.db.model_pricing_client import ModelPricingClient
from api.db.models import ModelPricingRuleModel, UserModel
from api.services.configuration.ai_model_configuration import (
    get_resolved_ai_model_configuration,
)
from api.services.configuration.pricing.resolver import (
    ModelPrice,
    PriceStatus,
    get_model_price,
)


async def can_view_provider_pricing(*, user: UserModel) -> bool:
    if user.is_superuser:
        return True
    resolved = await get_resolved_ai_model_configuration(
        user_id=user.id,
        organization_id=user.selected_organization_id,
    )
    return not resolved.managed


async def list_visible_pricing_rules(*, user: UserModel) -> list[ModelPricingRuleModel]:
    if not await can_view_provider_pricing(user=user):
        return []
    return await ModelPricingClient().list_pricing_rules(active_only=True)


async def get_visible_model_price(
    *,
    user: UserModel,
    provider: str,
    capability: str,
    model: str | None,
    voice: str | None,
) -> ModelPrice:
    if not await can_view_provider_pricing(user=user):
        return ModelPrice(status=PriceStatus.HIDDEN, lines=[])
    return await get_model_price(
        provider=provider, capability=capability, model=model, voice=voice
    )
