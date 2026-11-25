"""Dynamic model lists for the picker, and admin control of the sync."""

from __future__ import annotations

from dataclasses import asdict
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.db.models import UserModel
from api.services.auth.depends import get_superuser, get_user
from api.services.configuration.model_sync.catalog import list_provider_models
from api.services.configuration.model_sync.sync import get_model_sync_status
from api.tasks.function_names import FunctionNames

router = APIRouter(tags=["provider-models"])

ModelCapability = Literal["llm", "tts", "stt", "realtime"]


class ModelOptionSchema(BaseModel):
    model_id: str
    name: str
    is_deprecated: bool = False


class ProviderModelsResponse(BaseModel):
    provider: str
    capability: str
    source: str  # "live" = from the provider's API, "static" = the list in code
    default: str | None = None
    models: list[ModelOptionSchema]


class ModelSyncQueuedResponse(BaseModel):
    job_id: str | None = None


@router.get("/user/configurations/models/{provider}", response_model=ProviderModelsResponse)
async def get_provider_models(
    provider: str,
    capability: ModelCapability,
    _: UserModel = Depends(get_user),
) -> ProviderModelsResponse:
    try:
        result = await list_provider_models(provider=provider, capability=capability)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ProviderModelsResponse(provider=provider, capability=capability, **asdict(result))


@router.get("/admin/model-sync")
async def read_model_sync_status(_: UserModel = Depends(get_superuser)) -> dict:
    return await get_model_sync_status()


@router.post("/admin/model-sync/run", response_model=ModelSyncQueuedResponse)
async def run_model_sync(force: bool = False, _: UserModel = Depends(get_superuser)):
    from api.tasks.arq import enqueue_job

    job = await enqueue_job(FunctionNames.SYNC_PROVIDER_MODELS, force)
    return ModelSyncQueuedResponse(job_id=getattr(job, "job_id", None))
