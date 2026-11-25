"""Model price lookup for the selector, and admin review of price changes."""

from __future__ import annotations

from dataclasses import asdict
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException

from api.db.model_price_client import ModelPriceClient
from api.db.models import UserModel
from api.schemas.model_price import (
    ModelPriceResponse,
    ModelPriceSyncQueuedResponse,
    PendingModelPriceResponse,
)
from api.services.auth.depends import get_superuser, get_user
from api.services.configuration.model_pricing import get_visible_model_price
from api.tasks.function_names import FunctionNames

router = APIRouter(tags=["model-prices"])

PriceCapability = Literal["llm", "tts", "stt", "realtime"]


@router.get("/user/configurations/pricing/{provider}", response_model=ModelPriceResponse)
async def get_model_pricing(
    provider: str,
    capability: PriceCapability,
    model: str | None = None,
    voice: str | None = None,
    user: UserModel = Depends(get_user),
) -> ModelPriceResponse:
    """Price of the selected provider and model. Never a guess."""
    price = await get_visible_model_price(
        user=user, provider=provider, capability=capability, model=model, voice=voice
    )
    return ModelPriceResponse(provider=provider, capability=capability, model=model, **asdict(price))


@router.get("/admin/model-prices/pending", response_model=list[PendingModelPriceResponse])
async def list_pending_model_prices(_: UserModel = Depends(get_superuser)):
    return await ModelPriceClient().list_pending_prices()


@router.post("/admin/model-prices/{price_id}/approve", response_model=PendingModelPriceResponse)
async def approve_model_price(price_id: int, user: UserModel = Depends(get_superuser)):
    row = await ModelPriceClient().approve_price(price_id=price_id, reviewed_by=user.id)
    if row is None:
        raise HTTPException(status_code=404, detail="Pending price not found")
    return row


@router.post("/admin/model-prices/{price_id}/reject", response_model=PendingModelPriceResponse)
async def reject_model_price(price_id: int, user: UserModel = Depends(get_superuser)):
    row = await ModelPriceClient().reject_price(price_id=price_id, reviewed_by=user.id)
    if row is None:
        raise HTTPException(status_code=404, detail="Pending price not found")
    return row


@router.post("/admin/model-prices/sync", response_model=ModelPriceSyncQueuedResponse)
async def run_model_price_sync(_: UserModel = Depends(get_superuser)):
    from api.tasks.arq import enqueue_job

    job = await enqueue_job(FunctionNames.SYNC_MODEL_PRICES)
    return ModelPriceSyncQueuedResponse(job_id=getattr(job, "job_id", None))
