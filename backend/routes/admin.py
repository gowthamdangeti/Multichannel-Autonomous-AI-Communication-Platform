"""Convozent super-admin routes.

All endpoints require is_superuser=True. Regular org users never reach these.

Mounted at /api/v1/admin/ via main.py.

Endpoints:
  Voice Catalog
    GET    /admin/voices               list all voices
    POST   /admin/voices               create voice
    PATCH  /admin/voices/{id}          update voice
    DELETE /admin/voices/{id}          delete voice

  Org Platform Config  (which models/keys/voices an org gets)
    GET    /admin/orgs                 list orgs with their config + subscription
    GET    /admin/orgs/{org_id}/config get org platform config
    PUT    /admin/orgs/{org_id}/config upsert org platform config

  Org Subscriptions
    GET    /admin/orgs/{org_id}/subscription
    PUT    /admin/orgs/{org_id}/subscription

  Model Pricing Rules  (dynamic LLM/TTS/STT pricing)
    GET    /admin/pricing-rules        list all rules
    POST   /admin/pricing-rules        create rule
    PATCH  /admin/pricing-rules/{id}   update rule
    DELETE /admin/pricing-rules/{id}   delete rule
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from loguru import logger
from pydantic import BaseModel, field_validator

from api.db.models import UserModel
from api.db.platform_client import platform_client
from api.enums import OrganizationConfigurationKey
from api.schemas.ai_model_configuration import (
    OrganizationAIModelConfigurationResponse,
    OrganizationAIModelConfigurationV2,
    compile_ai_model_configuration_v2,
)
from api.services.auth.depends import get_superuser
from api.services.configuration.ai_model_configuration import (
    check_for_masked_keys_in_ai_model_configuration_v2,
    mask_ai_model_configuration_v2,
    merge_ai_model_configuration_v2_secrets,
)
from api.services.configuration.check_validity import UserConfigurationValidator
from api.services.configuration.masking import mask_user_config
from api.services.voice_preview.auto_render import ConfigurationSource
from api.tasks.arq import enqueue_job
from api.tasks.function_names import FunctionNames

router = APIRouter(prefix="/admin", tags=["admin"])

_GLOBAL_MODEL_CONFIG_KEY = OrganizationConfigurationKey.MODEL_CONFIGURATION_V2.value


async def _validate_and_merge_model_config(
    *,
    request: OrganizationAIModelConfigurationV2,
    existing: OrganizationAIModelConfigurationV2 | None,
    created_by: str | None,
    organization_id: int | None,
) -> OrganizationAIModelConfigurationV2:
    """Reuse the org-settings validation pipeline for super-admin saves.

    Merges masked secrets onto the existing stored config, rejects fully-masked
    keys, compiles to an effective config, and runs UserConfigurationValidator.
    """
    configuration = merge_ai_model_configuration_v2_secrets(request, existing)
    try:
        check_for_masked_keys_in_ai_model_configuration_v2(configuration)
        effective = compile_ai_model_configuration_v2(configuration)
        await UserConfigurationValidator().validate(
            effective,
            organization_id=organization_id,
            created_by=created_by,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=exc.args[0])
    return configuration


def _model_config_response(
    configuration: OrganizationAIModelConfigurationV2 | None,
    *,
    source: str = "platform_global",
) -> OrganizationAIModelConfigurationResponse:
    if configuration is None:
        return OrganizationAIModelConfigurationResponse(
            configuration=None,
            effective_configuration={},
            source="empty",
            managed=True,
        )
    return OrganizationAIModelConfigurationResponse(
        configuration=mask_ai_model_configuration_v2(configuration),
        effective_configuration=mask_user_config(
            compile_ai_model_configuration_v2(configuration)
        ),
        source=source,
        managed=True,
    )


# ─────────────────────────── Schemas ────────────────────────────────────────

_GENDER_ALIASES = {
    "male": "male", "m": "male", "man": "male",
    "female": "female", "f": "female", "woman": "female",
    "neutral": "neutral", "n": "neutral",
}


def _normalize_gender(value: str | None) -> str | None:
    """Store gender as male / female / neutral so voice gender filters match it."""
    if value is None or not value.strip():
        return None
    normalized = _GENDER_ALIASES.get(value.strip().lower())
    if normalized is None:
        raise ValueError("gender must be one of: male, female, neutral")
    return normalized


class VoiceCreate(BaseModel):
    name: str
    provider: str
    voice_id: str
    language: str = "en"
    gender: str | None = None
    accent: str | None = None
    preview_audio_url: str | None = None
    is_active: bool = True

    @field_validator("gender")
    @classmethod
    def validate_gender(cls, value: str | None) -> str | None:
        return _normalize_gender(value)


class VoiceUpdate(BaseModel):
    name: str | None = None
    provider: str | None = None
    voice_id: str | None = None
    language: str | None = None
    gender: str | None = None
    accent: str | None = None
    preview_audio_url: str | None = None
    is_active: bool | None = None

    @field_validator("gender")
    @classmethod
    def validate_gender(cls, value: str | None) -> str | None:
        return _normalize_gender(value)


class VoiceResponse(BaseModel):
    id: int
    name: str
    provider: str
    voice_id: str
    language: str
    gender: str | None
    accent: str | None
    preview_audio_url: str | None
    is_active: bool

    class Config:
        from_attributes = True


class OrgPlatformConfigPayload(BaseModel):
    llm_config: dict[str, Any] | None = None
    stt_config: dict[str, Any] | None = None
    tts_config: dict[str, Any] | None = None
    allowed_voice_ids: list[int] | None = None
    channels_enabled: list[str] | None = None


class OrgPlatformConfigResponse(BaseModel):
    organization_id: int
    llm_config: dict[str, Any]
    stt_config: dict[str, Any]
    tts_config: dict[str, Any]
    allowed_voice_ids: list[int]
    channels_enabled: list[str]

    class Config:
        from_attributes = True


class OrgSubscriptionPayload(BaseModel):
    plan_name: str | None = None
    status: str | None = None
    included_minutes: int | None = None
    included_messages: int | None = None
    price_per_extra_minute: float | str | None = None
    price_per_extra_message: float | str | None = None


class OrgSubscriptionResponse(BaseModel):
    organization_id: int
    plan_name: str
    status: str
    included_minutes: int
    included_messages: int
    price_per_extra_minute: float | str
    price_per_extra_message: float | str

    class Config:
        from_attributes = True


class OrgListItem(BaseModel):
    id: int
    provider_id: str
    email: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    country: str | None = None
    phone_number: str | None = None
    created_at: datetime | None = None
    platform_config: OrgPlatformConfigResponse | None = None
    subscription: OrgSubscriptionResponse | None = None


# ─────────────────────────── Voice Catalog ──────────────────────────────────

@router.get("/voices", response_model=list[VoiceResponse])
async def list_voices(
    active_only: bool = True,
    _: UserModel = Depends(get_superuser),
):
    voices = await platform_client.list_voices(active_only=active_only)
    return [VoiceResponse.model_validate(v) for v in voices]


@router.post("/voices", response_model=VoiceResponse, status_code=status.HTTP_201_CREATED)
async def create_voice(
    payload: VoiceCreate,
    _: UserModel = Depends(get_superuser),
):
    voice = await platform_client.create_voice(payload.model_dump())
    return VoiceResponse.model_validate(voice)


@router.patch("/voices/{voice_id}", response_model=VoiceResponse)
async def update_voice(
    voice_id: int,
    payload: VoiceUpdate,
    _: UserModel = Depends(get_superuser),
):
    data = {k: v for k, v in payload.model_dump().items() if v is not None}
    voice = await platform_client.update_voice(voice_id, data)
    if not voice:
        raise HTTPException(status_code=404, detail="Voice not found")
    return VoiceResponse.model_validate(voice)


@router.delete("/voices/{voice_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_voice(
    voice_id: int,
    _: UserModel = Depends(get_superuser),
):
    deleted = await platform_client.delete_voice(voice_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Voice not found")


# ─────────────────────────── Orgs overview ──────────────────────────────────

@router.get("/orgs", response_model=list[OrgListItem])
async def list_orgs(_: UserModel = Depends(get_superuser)):
    """List all organizations with platform config, subscription, and owner profile details."""
    orgs = await platform_client.get_all_organizations()
    result = []
    for org in orgs:
        cfg = await platform_client.get_org_platform_config(org.id)
        sub = await platform_client.get_org_subscription(org.id)
        user = await platform_client.get_org_primary_user(org.id)
        result.append(
            OrgListItem(
                id=org.id,
                provider_id=org.provider_id,
                email=user.email if user else None,
                first_name=user.first_name if user else None,
                last_name=user.last_name if user else None,
                country=user.country if user else None,
                phone_number=user.phone_number if user else None,
                created_at=org.created_at,
                platform_config=OrgPlatformConfigResponse.model_validate(cfg) if cfg else None,
                subscription=OrgSubscriptionResponse.model_validate(sub) if sub else None,
            )
        )
    return result


# ─────────────────────────── Org Platform Config ────────────────────────────

@router.get("/orgs/{org_id}/config", response_model=OrgPlatformConfigResponse)
async def get_org_config(
    org_id: int,
    _: UserModel = Depends(get_superuser),
):
    cfg = await platform_client.get_org_platform_config(org_id)
    if not cfg:
        raise HTTPException(status_code=404, detail="No platform config for this org yet")
    return OrgPlatformConfigResponse.model_validate(cfg)


@router.put("/orgs/{org_id}/config", response_model=OrgPlatformConfigResponse)
async def upsert_org_config(
    org_id: int,
    payload: OrgPlatformConfigPayload,
    _: UserModel = Depends(get_superuser),
):
    # Verify org exists
    org = await platform_client.get_organization_by_id(org_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    data = {k: v for k, v in payload.model_dump().items() if v is not None}
    cfg = await platform_client.upsert_org_platform_config(org_id, data)
    return OrgPlatformConfigResponse.model_validate(cfg)


# ─────────────────────────── Org Subscription ───────────────────────────────

@router.get("/orgs/{org_id}/subscription", response_model=OrgSubscriptionResponse)
async def get_org_subscription(
    org_id: int,
    _: UserModel = Depends(get_superuser),
):
    sub = await platform_client.get_org_subscription(org_id)
    if not sub:
        raise HTTPException(status_code=404, detail="No subscription for this org yet")
    return OrgSubscriptionResponse.model_validate(sub)


@router.put("/orgs/{org_id}/subscription", response_model=OrgSubscriptionResponse)
async def upsert_org_subscription(
    org_id: int,
    payload: OrgSubscriptionPayload,
    _: UserModel = Depends(get_superuser),
):
    org = await platform_client.get_organization_by_id(org_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    data = {k: v for k, v in payload.model_dump().items() if v is not None}
    sub = await platform_client.upsert_org_subscription(org_id, data)
    return OrgSubscriptionResponse.model_validate(sub)


# ─────────────────────────── Org Voices (user-facing) ───────────────────────

@router.get("/orgs/{org_id}/voices", response_model=list[VoiceResponse])
async def get_org_voices(
    org_id: int,
    _: UserModel = Depends(get_superuser),
):
    """Preview which voices are enabled for an org (as admin)."""
    voices = await platform_client.list_voices_for_org(org_id=org_id)
    return [VoiceResponse.model_validate(v) for v in voices]


# ─────────────────────── Platform Model Configuration ───────────────────────
# Global default (every org inherits) and per-org overrides. Stored as
# OrganizationAIModelConfigurationV2 so the org settings validation/masking/
# secret-merge pipeline is reused verbatim.


def _load_v2(value: dict | None) -> OrganizationAIModelConfigurationV2 | None:
    if not value:
        return None
    return OrganizationAIModelConfigurationV2.model_validate(value)


@router.get(
    "/platform-config/model",
    response_model=OrganizationAIModelConfigurationResponse,
)
async def get_global_model_config(_: UserModel = Depends(get_superuser)):
    existing = _load_v2(
        await platform_client.get_platform_config_value(_GLOBAL_MODEL_CONFIG_KEY)
    )
    return _model_config_response(existing)


async def _enqueue_voice_previews(
    *, source: ConfigurationSource, source_id: int | None, admin: UserModel
) -> None:
    """After an admin save, render platform previews for the configured voices.

    Only the source id is queued — the worker reloads the config (and its keys)
    from the database, so no secret ever lands in Redis.
    """
    await enqueue_job(
        FunctionNames.RENDER_SAVED_CONFIGURATION_VOICE_PREVIEWS,
        source,
        source_id,
        int(admin.id),
    )


@router.put(
    "/platform-config/model",
    response_model=OrganizationAIModelConfigurationResponse,
)
async def save_global_model_config(
    request: OrganizationAIModelConfigurationV2,
    admin: UserModel = Depends(get_superuser),
):
    existing = _load_v2(
        await platform_client.get_platform_config_value(_GLOBAL_MODEL_CONFIG_KEY)
    )
    configuration = await _validate_and_merge_model_config(
        request=request,
        existing=existing,
        created_by=admin.provider_id,
        organization_id=None,
    )
    await platform_client.upsert_platform_config(
        _GLOBAL_MODEL_CONFIG_KEY,
        configuration.model_dump(mode="json", exclude_none=True),
    )
    await _enqueue_voice_previews(source="platform_global", source_id=None, admin=admin)
    return _model_config_response(configuration)


@router.get(
    "/orgs/{org_id}/model-config",
    response_model=OrganizationAIModelConfigurationResponse,
)
async def get_org_model_config(
    org_id: int,
    _: UserModel = Depends(get_superuser),
):
    existing = _load_v2(await platform_client.get_org_model_configuration_v2(org_id))
    return _model_config_response(existing, source="platform_org")


@router.put(
    "/orgs/{org_id}/model-config",
    response_model=OrganizationAIModelConfigurationResponse,
)
async def save_org_model_config(
    org_id: int,
    request: OrganizationAIModelConfigurationV2,
    admin: UserModel = Depends(get_superuser),
):
    org = await platform_client.get_organization_by_id(org_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    existing = _load_v2(await platform_client.get_org_model_configuration_v2(org_id))
    configuration = await _validate_and_merge_model_config(
        request=request,
        existing=existing,
        created_by=admin.provider_id,
        organization_id=org_id,
    )
    await platform_client.upsert_org_model_configuration_v2(
        org_id,
        configuration.model_dump(mode="json", exclude_none=True),
    )
    await _enqueue_voice_previews(source="platform_org", source_id=org_id, admin=admin)
    return _model_config_response(configuration, source="platform_org")


# ──────────────── Model Configuration Presets (admin-curated) ────────────────
# Named presets org users pick from by display name. Each `config` is an
# OrganizationAIModelConfigurationV2 blob (with keys); masked on read.


class ModelConfigPresetCreate(BaseModel):
    name: str
    description: str | None = None
    config: OrganizationAIModelConfigurationV2
    is_active: bool = True
    is_default: bool = False
    sort_order: int = 0


class ModelConfigPresetUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    config: OrganizationAIModelConfigurationV2 | None = None
    is_active: bool | None = None
    is_default: bool | None = None
    sort_order: int | None = None


class ModelConfigPresetResponse(BaseModel):
    id: int
    name: str
    description: str | None
    config: dict | None
    is_active: bool
    is_default: bool
    sort_order: int


def _preset_response(row) -> ModelConfigPresetResponse:
    masked = None
    if row.config:
        try:
            masked = mask_ai_model_configuration_v2(
                OrganizationAIModelConfigurationV2.model_validate(row.config)
            )
        except Exception as e:
            logger.error(f"Failed to parse preset config ID {getattr(row, 'id', None)}: {e}")
            masked = row.config if isinstance(row.config, dict) else None
    return ModelConfigPresetResponse(
        id=row.id,
        name=row.name,
        description=row.description,
        config=masked,
        is_active=row.is_active,
        is_default=row.is_default,
        sort_order=row.sort_order,
    )



@router.get("/model-configurations", response_model=list[ModelConfigPresetResponse])
async def list_model_config_presets(_: UserModel = Depends(get_superuser)):
    rows = await platform_client.list_model_configurations(active_only=False)
    return [_preset_response(r) for r in rows]


@router.post(
    "/model-configurations",
    response_model=ModelConfigPresetResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_model_config_preset(
    payload: ModelConfigPresetCreate,
    admin: UserModel = Depends(get_superuser),
):
    configuration = await _validate_and_merge_model_config(
        request=payload.config,
        existing=None,
        created_by=admin.provider_id,
        organization_id=None,
    )
    row = await platform_client.create_model_configuration(
        {
            "name": payload.name,
            "description": payload.description,
            "config": configuration.model_dump(mode="json", exclude_none=True),
            "is_active": payload.is_active,
            "is_default": payload.is_default,
            "sort_order": payload.sort_order,
        }
    )
    await _enqueue_voice_previews(source="platform_preset", source_id=row.id, admin=admin)
    return _preset_response(row)


@router.patch(
    "/model-configurations/{config_id}",
    response_model=ModelConfigPresetResponse,
)
async def update_model_config_preset(
    config_id: int,
    payload: ModelConfigPresetUpdate,
    admin: UserModel = Depends(get_superuser),
):
    existing_row = await platform_client.get_model_configuration(config_id)
    if not existing_row:
        raise HTTPException(status_code=404, detail="Model configuration not found")

    data: dict[str, Any] = {}
    for field in ("name", "description", "is_active", "is_default", "sort_order"):
        value = getattr(payload, field)
        if value is not None:
            data[field] = value

    if payload.config is not None:
        existing_cfg = (
            OrganizationAIModelConfigurationV2.model_validate(existing_row.config)
            if existing_row.config
            else None
        )
        configuration = await _validate_and_merge_model_config(
            request=payload.config,
            existing=existing_cfg,
            created_by=admin.provider_id,
            organization_id=None,
        )
        data["config"] = configuration.model_dump(mode="json", exclude_none=True)

    row = await platform_client.update_model_configuration(config_id, data)
    if payload.config is not None:
        await _enqueue_voice_previews(
            source="platform_preset", source_id=config_id, admin=admin
        )
    return _preset_response(row)


@router.delete(
    "/model-configurations/{config_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_model_config_preset(
    config_id: int,
    _: UserModel = Depends(get_superuser),
):
    deleted = await platform_client.delete_model_configuration(config_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Model configuration not found")


# ─────────────────────── Model Pricing Rules ──────────────────────────────────

from api.db.model_pricing_client import ModelPricingClient  # noqa: E402

_pricing_client = ModelPricingClient()


class PricingRuleCreate(BaseModel):
    service_type: str
    label: str
    pattern: str
    input_rate: float = 0
    output_rate: float = 0
    unit_rate: float = 0
    sort_order: int = 0
    is_active: bool = True


class PricingRuleUpdate(BaseModel):
    label: str | None = None
    pattern: str | None = None
    input_rate: float | None = None
    output_rate: float | None = None
    unit_rate: float | None = None
    sort_order: int | None = None
    is_active: bool | None = None


class PricingRuleResponse(BaseModel):
    id: int
    service_type: str
    label: str
    pattern: str
    input_rate: float
    output_rate: float
    unit_rate: float
    sort_order: int
    is_active: bool


def _pricing_response(row) -> PricingRuleResponse:
    return PricingRuleResponse(
        id=row.id,
        service_type=row.service_type,
        label=row.label,
        pattern=row.pattern,
        input_rate=float(row.input_rate),
        output_rate=float(row.output_rate),
        unit_rate=float(row.unit_rate),
        sort_order=row.sort_order,
        is_active=row.is_active,
    )


@router.get("/pricing-rules", response_model=list[PricingRuleResponse])
async def list_pricing_rules(
    service_type: str | None = None,
    _: UserModel = Depends(get_superuser),
):
    rows = await _pricing_client.list_pricing_rules(
        active_only=False, service_type=service_type
    )
    return [_pricing_response(r) for r in rows]


@router.post(
    "/pricing-rules",
    response_model=PricingRuleResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_pricing_rule(
    payload: PricingRuleCreate,
    _: UserModel = Depends(get_superuser),
):
    import re
    try:
        re.compile(payload.pattern)
    except re.error as e:
        raise HTTPException(status_code=422, detail=f"Invalid regex pattern: {e}")
    if payload.service_type not in ("llm", "tts", "stt"):
        raise HTTPException(status_code=422, detail="service_type must be llm, tts, or stt")
    row = await _pricing_client.create_pricing_rule(payload.model_dump())
    return _pricing_response(row)


@router.patch("/pricing-rules/{rule_id}", response_model=PricingRuleResponse)
async def update_pricing_rule(
    rule_id: int,
    payload: PricingRuleUpdate,
    _: UserModel = Depends(get_superuser),
):
    import re
    data = payload.model_dump(exclude_none=True)
    if "pattern" in data:
        try:
            re.compile(data["pattern"])
        except re.error as e:
            raise HTTPException(status_code=422, detail=f"Invalid regex pattern: {e}")
    row = await _pricing_client.update_pricing_rule(rule_id, data)
    if not row:
        raise HTTPException(status_code=404, detail="Pricing rule not found")
    return _pricing_response(row)


@router.delete("/pricing-rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_pricing_rule(
    rule_id: int,
    _: UserModel = Depends(get_superuser),
):
    deleted = await _pricing_client.delete_pricing_rule(rule_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Pricing rule not found")


# ─────────────────────────── Admin Stats ────────────────────────────────────

@router.get("/stats")
async def get_admin_stats(_: UserModel = Depends(get_superuser)):
    """Platform-wide stats for the super-admin dashboard."""
    return await platform_client.get_platform_stats(days=7)


# ─────────────────────────── Container Monitor ──────────────────────────────

@router.get("/monitor")
async def get_monitor(_: UserModel = Depends(get_superuser)):
    """Return container stats for all configured DOCKER_HOSTS instances."""
    import asyncio

    from api.services.monitor.docker_monitor import get_all_instances
    return await asyncio.get_event_loop().run_in_executor(None, get_all_instances)


@router.get("/monitor/{instance_label}/{container_id}/logs")
async def get_container_logs(
    instance_label: str,
    container_id: str,
    tail: int = 200,
    _: UserModel = Depends(get_superuser),
):
    """Return the last N log lines for a specific container."""
    import asyncio

    from api.services.monitor.docker_monitor import get_container_logs
    return await asyncio.get_event_loop().run_in_executor(
        None, lambda: get_container_logs(instance_label, container_id, tail)
    )


# ─────────────────────────── Enterprise Leads (in-house) ─────────────────────
# Strategy-call submissions stored in Postgres for data residency.
# Superuser-only. Public writes go through POST /api/v1/leads/enterprise.


class LeadStatusPayload(BaseModel):
    status: str


@router.get("/leads")
async def list_enterprise_leads(
    page: int = 1,
    limit: int = 50,
    status: str | None = None,
    search: str | None = None,
    _: UserModel = Depends(get_superuser),
):
    from api.schemas.leads import EnterpriseLeadResponse
    from api.services.leads.service import list_leads

    try:
        rows, total = await list_leads(page=page, limit=limit, status=status, search=search)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return {
        "items": [EnterpriseLeadResponse.model_validate(r).model_dump() for r in rows],
        "total": total,
        "page": page,
        "limit": limit,
    }


@router.patch("/leads/{lead_id}")
async def update_lead_status(
    lead_id: int,
    payload: LeadStatusPayload,
    admin: UserModel = Depends(get_superuser),
):
    from api.schemas.leads import EnterpriseLeadResponse
    from api.services.leads.service import set_lead_status

    try:
        row = await set_lead_status(lead_id, payload.status, contacted_by=admin.id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    if not row:
        raise HTTPException(status_code=404, detail="Lead not found")
    return EnterpriseLeadResponse.model_validate(row)


@router.get("/orgs/{org_id}/onboarding")
async def get_org_onboarding_admin(
    org_id: int,
    _: UserModel = Depends(get_superuser),
):
    """Superuser read of one org's Welcome-popup answers + owner identity."""
    from api.schemas.leads import OnboardingProfileResponse

    org = await platform_client.get_organization_by_id(org_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    from api.services.leads.service import get_org_onboarding_profile

    row = await get_org_onboarding_profile(org_id)
    user = await platform_client.get_org_primary_user(org_id)
    return {
        "organization_id": org_id,
        "profile": OnboardingProfileResponse.model_validate(row).model_dump() if row else None,
        "owner": {
            "email": user.email if user else None,
            "first_name": user.first_name if user else None,
            "last_name": user.last_name if user else None,
            "country": user.country if user else None,
            "phone_number": user.phone_number if user else None,
        } if user else None,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Provider language lists (live sync from provider APIs)
# ─────────────────────────────────────────────────────────────────────────────


class LanguageCatalogEntryResponse(BaseModel):
    id: int
    provider: str
    capability: str
    model: str
    language_count: int
    codes: list[str]
    pending_count: int | None = None
    pending_codes: list[str] | None = None
    pending_reason: str | None = None
    fetched_at: Any = None


class LanguageSyncProviderResponse(BaseModel):
    id: str  # "provider:capability"
    provider: str
    capability: str
    docs_url: str
    has_credentials: bool
    status: str | None = None
    message: str | None = None
    last_attempt_at: str | None = None
    last_success_at: str | None = None
    unknown_codes: list[str] = []
    entries: list[LanguageCatalogEntryResponse] = []


def _language_entry_response(row) -> LanguageCatalogEntryResponse:
    return LanguageCatalogEntryResponse(
        id=row.id,
        provider=row.provider,
        capability=row.capability,
        model=row.model,
        language_count=len(row.codes or []),
        codes=list(row.codes or []),
        pending_count=len(row.pending_codes) if row.pending_codes is not None else None,
        pending_codes=row.pending_codes,
        pending_reason=row.pending_reason,
        fetched_at=row.fetched_at,
    )


@router.get("/language-sync", response_model=list[LanguageSyncProviderResponse])
async def get_language_sync_status(_: UserModel = Depends(get_superuser)):
    """Every provider with a language-listing API, its last sync and stored lists."""
    from api.services.configuration.language_sync.credentials import resolve_credentials
    from api.services.configuration.language_sync.fetchers import FETCHERS
    from api.services.configuration.language_sync.sync import STATUS_KEY

    status_by_id = await platform_client.get_platform_config_value(STATUS_KEY) or {}
    rows = await platform_client.list_language_catalog()
    response = []
    for fetcher_id, fetcher in FETCHERS.items():
        provider = fetcher.provider
        state = status_by_id.get(fetcher_id) or {}
        has_key = (
            not fetcher.requires_key
            or bool(await resolve_credentials(provider, fetcher.capability))
        )
        response.append(
            LanguageSyncProviderResponse(
                id=fetcher_id,
                provider=provider,
                capability=fetcher.capability,
                docs_url=fetcher.docs_url,
                has_credentials=has_key,
                status=state.get("status"),
                message=state.get("message"),
                last_attempt_at=state.get("last_attempt_at"),
                last_success_at=state.get("last_success_at"),
                unknown_codes=state.get("unknown_codes") or [],
                entries=[
                    _language_entry_response(r)
                    for r in rows
                    if r.provider == provider and r.capability == fetcher.capability
                ],
            )
        )
    return response


@router.post("/language-sync/run")
async def run_language_sync(
    provider: str | None = None,
    _: UserModel = Depends(get_superuser),
):
    """Refresh now: one list ("provider:capability"), or all when ``provider`` is omitted."""
    from api.services.configuration.language_sync.fetchers import get_fetcher
    from api.services.configuration.language_sync.sync import (
        record_status,
        result_dict,
        sync_all,
        sync_provider,
    )

    if provider and get_fetcher(provider) is None:
        raise HTTPException(status_code=404, detail=f"{provider} has no language-listing API")
    results = [await sync_provider(provider)] if provider else await sync_all()
    await record_status(results)
    return {"results": [result_dict(r) for r in results]}


@router.post(
    "/language-sync/entries/{entry_id}/{action}",
    response_model=LanguageCatalogEntryResponse,
)
async def resolve_language_sync_entry(
    entry_id: int,
    action: str,
    _: UserModel = Depends(get_superuser),
):
    """Approve or reject a refresh that was parked because the list shrank a lot."""
    from api.services.configuration.language_sync import store

    if action not in ("approve", "reject"):
        raise HTTPException(status_code=400, detail="action must be 'approve' or 'reject'")
    row = await platform_client.resolve_language_catalog_pending(
        entry_id, approve=action == "approve"
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Entry not found")
    store.invalidate(row.provider)
    return _language_entry_response(row)


@router.delete("/language-sync/{fetcher_id}", status_code=status.HTTP_204_NO_CONTENT)
async def reset_language_sync(
    fetcher_id: str,
    _: UserModel = Depends(get_superuser),
):
    """Forget live lists ("provider:capability") so the built-in list is used again."""
    from api.services.configuration.language_sync import store
    from api.services.configuration.language_sync.fetchers import get_fetcher

    fetcher = get_fetcher(fetcher_id)
    if fetcher is None:
        raise HTTPException(status_code=404, detail=f"{fetcher_id} has no language-listing API")
    await platform_client.delete_language_catalog(
        provider=fetcher.provider, capability=fetcher.capability
    )
    store.invalidate(fetcher.provider)
