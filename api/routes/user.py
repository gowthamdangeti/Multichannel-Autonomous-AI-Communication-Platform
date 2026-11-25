from datetime import datetime, timedelta
from typing import List, Literal, Optional, TypedDict, Union

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ValidationError

from api.db import db_client
from api.db.models import (
    UserModel,
)
from api.schemas.onboarding_state import OnboardingState, OnboardingStateUpdate
from api.services.auth.depends import get_user
from api.services.configuration.ai_model_configuration import (
    get_resolved_ai_model_configuration,
)
from api.services.configuration.check_validity import (
    APIKeyStatusResponse,
    UserConfigurationValidator,
)
from api.services.configuration.defaults import DEFAULT_SERVICE_PROVIDERS
from api.services.configuration.masking import check_for_masked_keys, mask_user_config
from api.services.configuration.merge import merge_user_configurations
from api.services.configuration.registry import REGISTRY, ServiceType
from api.services.organization_preferences import (
    get_organization_preferences,
    upsert_organization_preferences,
)
from api.services.user_onboarding import (
    get_onboarding_state,
    update_onboarding_state,
)

router = APIRouter(prefix="/user")


class AuthUserResponse(TypedDict):
    id: int
    is_superuser: bool


class DefaultConfigurationsResponse(TypedDict):
    llm: dict[str, dict]
    tts: dict[str, dict]
    stt: dict[str, dict]
    embeddings: dict[str, dict]
    realtime: dict[str, dict]
    default_providers: dict[str, str]


@router.get("/configurations/defaults")
async def get_default_configurations() -> DefaultConfigurationsResponse:
    configurations = {
        "llm": {
            provider: model_cls.model_json_schema()
            for provider, model_cls in REGISTRY[ServiceType.LLM].items()
        },
        "tts": {
            provider: model_cls.model_json_schema()
            for provider, model_cls in REGISTRY[ServiceType.TTS].items()
        },
        "stt": {
            provider: model_cls.model_json_schema()
            for provider, model_cls in REGISTRY[ServiceType.STT].items()
        },
        "embeddings": {
            provider: model_cls.model_json_schema()
            for provider, model_cls in REGISTRY[ServiceType.EMBEDDINGS].items()
        },
        "realtime": {
            provider: model_cls.model_json_schema()
            for provider, model_cls in REGISTRY[ServiceType.REALTIME].items()
        },
        "default_providers": DEFAULT_SERVICE_PROVIDERS,
    }
    return configurations


@router.get("/auth/user")
async def get_auth_user(
    user: UserModel = Depends(get_user),
) -> AuthUserResponse:
    return {
        "id": user.id,
        "is_superuser": user.is_superuser,
    }


class UserConfigurationRequestResponseSchema(BaseModel):
    llm: dict[str, Union[str, float, list[str], None]] | None = None
    tts: dict[str, Union[str, float, list[str], None]] | None = None
    stt: dict[str, Union[str, float, list[str], None]] | None = None
    embeddings: dict[str, Union[str, float, list[str], None]] | None = None
    realtime: dict[str, Union[str, float, list[str], None]] | None = None
    is_realtime: bool | None = None
    test_phone_number: str | None = None
    timezone: str | None = None
    organization_pricing: dict[str, Union[float, str, bool]] | None = None


@router.get("/configurations/user")
async def get_user_configurations(
    user: UserModel = Depends(get_user),
) -> UserConfigurationRequestResponseSchema:
    resolved_config = await get_resolved_ai_model_configuration(
        user_id=user.id,
        organization_id=user.selected_organization_id,
    )
    masked_config = mask_user_config(resolved_config.effective)
    if user.selected_organization_id:
        preferences = await get_organization_preferences(user.selected_organization_id)
        if preferences.test_phone_number is not None:
            masked_config["test_phone_number"] = preferences.test_phone_number
        if preferences.timezone is not None:
            masked_config["timezone"] = preferences.timezone

    # Add organization pricing info if available
    if user.selected_organization_id:
        org = await db_client.get_organization_by_id(user.selected_organization_id)
        if org and org.price_per_second_usd is not None:
            masked_config["organization_pricing"] = {
                "price_per_second_usd": org.price_per_second_usd,
                "currency": "USD",
                "billing_enabled": True,
            }

    return masked_config


@router.put("/configurations/user")
async def update_user_configurations(
    request: UserConfigurationRequestResponseSchema,
    user: UserModel = Depends(get_user),
) -> UserConfigurationRequestResponseSchema:
    existing_config = await db_client.get_user_configurations(user.id)

    incoming_dict = request.model_dump(exclude_none=True)

    # Remove organization_pricing from incoming dict as it's read-only
    incoming_dict.pop("organization_pricing", None)
    preferences_update = {
        key: incoming_dict.pop(key)
        for key in ("test_phone_number", "timezone")
        if key in incoming_dict
    }

    if incoming_dict:
        # Merge via helper
        try:
            user_configurations = merge_user_configurations(
                existing_config, incoming_dict
            )
        except ValidationError as e:
            raise HTTPException(status_code=422, detail=str(e))

        try:
            check_for_masked_keys(user_configurations)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

        try:
            validator = UserConfigurationValidator()
            await validator.validate(
                user_configurations,
                organization_id=user.selected_organization_id,
                created_by=user.provider_id,
            )
        except ValueError as e:
            raise HTTPException(status_code=422, detail=e.args[0])

        user_configurations = await db_client.update_user_configuration(
            user.id, user_configurations
        )
    else:
        user_configurations = existing_config

    if user.selected_organization_id and preferences_update:
        preferences = await get_organization_preferences(user.selected_organization_id)
        if "test_phone_number" in preferences_update:
            preferences.test_phone_number = preferences_update["test_phone_number"]
        if "timezone" in preferences_update:
            preferences.timezone = preferences_update["timezone"]
        await upsert_organization_preferences(
            user.selected_organization_id,
            preferences,
        )

    # Return masked version of updated config
    masked_config = mask_user_config(user_configurations)
    if user.selected_organization_id:
        preferences = await get_organization_preferences(user.selected_organization_id)
        if preferences.test_phone_number is not None:
            masked_config["test_phone_number"] = preferences.test_phone_number
        if preferences.timezone is not None:
            masked_config["timezone"] = preferences.timezone

    # Add organization pricing info if available
    if user.selected_organization_id:
        org = await db_client.get_organization_by_id(user.selected_organization_id)
        if org and org.price_per_second_usd is not None:
            masked_config["organization_pricing"] = {
                "price_per_second_usd": org.price_per_second_usd,
                "currency": "USD",
                "billing_enabled": True,
            }

    return masked_config


@router.get("/onboarding-state")
async def get_user_onboarding_state(
    user: UserModel = Depends(get_user),
) -> OnboardingState:
    return await get_onboarding_state(user.id)


@router.put("/onboarding-state")
async def update_user_onboarding_state(
    request: OnboardingStateUpdate,
    user: UserModel = Depends(get_user),
) -> OnboardingState:
    return await update_onboarding_state(user.id, request)


@router.get("/configurations/user/validate")
async def validate_user_configurations(
    validity_ttl_seconds: int = Query(default=60, ge=0, le=86400),
    user: UserModel = Depends(get_user),
) -> APIKeyStatusResponse:
    resolved_config = await get_resolved_ai_model_configuration(
        user_id=user.id,
        organization_id=user.selected_organization_id,
    )
    configurations = resolved_config.effective

    if (
        configurations.last_validated_at
        and configurations.last_validated_at
        < datetime.now() - timedelta(seconds=validity_ttl_seconds)
    ):
        validator = UserConfigurationValidator()
        try:
            status = await validator.validate(
                configurations,
                organization_id=user.selected_organization_id,
                created_by=user.provider_id,
            )
            await db_client.update_user_configuration_last_validated_at(user.id)
            return status
        except ValueError as e:
            raise HTTPException(status_code=422, detail=e.args[0])
    else:
        return {"status": []}


# API Key Management Endpoints
class APIKeyResponse(BaseModel):
    id: int
    name: str
    key_prefix: str
    is_active: bool
    created_at: datetime
    last_used_at: Optional[datetime] = None
    archived_at: Optional[datetime] = None


class CreateAPIKeyRequest(BaseModel):
    name: str


class CreateAPIKeyResponse(BaseModel):
    id: int
    name: str
    key_prefix: str
    api_key: str  # Only returned when creating a new key
    created_at: datetime


@router.get("/api-keys")
async def get_api_keys(
    include_archived: bool = Query(default=False),
    user: UserModel = Depends(get_user),
) -> List[APIKeyResponse]:
    """Get all API keys for the user's selected organization."""
    if not user.selected_organization_id:
        raise HTTPException(status_code=400, detail="No organization selected")

    api_keys = await db_client.get_api_keys_by_organization(
        user.selected_organization_id, include_archived=include_archived
    )

    return [
        APIKeyResponse(
            id=key.id,
            name=key.name,
            key_prefix=key.key_prefix,
            is_active=key.is_active,
            created_at=key.created_at,
            last_used_at=key.last_used_at,
            archived_at=key.archived_at,
        )
        for key in api_keys
    ]


@router.post("/api-keys")
async def create_api_key(
    request: CreateAPIKeyRequest,
    user: UserModel = Depends(get_user),
) -> CreateAPIKeyResponse:
    """Create a new API key for the user's selected organization."""
    if not user.selected_organization_id:
        raise HTTPException(status_code=400, detail="No organization selected")

    api_key, raw_key = await db_client.create_api_key(
        organization_id=user.selected_organization_id,
        name=request.name,
        created_by=user.id,
    )

    return CreateAPIKeyResponse(
        id=api_key.id,
        name=api_key.name,
        key_prefix=api_key.key_prefix,
        api_key=raw_key,
        created_at=api_key.created_at,
    )


@router.delete("/api-keys/{api_key_id}")
async def archive_api_key(
    api_key_id: int,
    user: UserModel = Depends(get_user),
) -> dict:
    """Archive an API key (soft delete)."""
    if not user.selected_organization_id:
        raise HTTPException(status_code=400, detail="No organization selected")

    # Verify the API key belongs to the user's organization
    api_keys = await db_client.get_api_keys_by_organization(
        user.selected_organization_id, include_archived=True
    )
    if not any(key.id == api_key_id for key in api_keys):
        raise HTTPException(status_code=404, detail="API key not found")

    success = await db_client.archive_api_key(api_key_id)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to archive API key")

    return {"success": True, "message": "API key archived successfully"}


@router.put("/api-keys/{api_key_id}/reactivate")
async def reactivate_api_key(
    api_key_id: int,
    user: UserModel = Depends(get_user),
) -> dict:
    """Reactivate an archived API key."""
    if not user.selected_organization_id:
        raise HTTPException(status_code=400, detail="No organization selected")

    # Verify the API key belongs to the user's organization
    api_keys = await db_client.get_api_keys_by_organization(
        user.selected_organization_id, include_archived=True
    )
    if not any(key.id == api_key_id for key in api_keys):
        raise HTTPException(status_code=404, detail="API key not found")

    success = await db_client.reactivate_api_key(api_key_id)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to reactivate API key")

    return {"success": True, "message": "API key reactivated successfully"}


# Voice Configuration Endpoints
TTSProvider = str


class VoiceInfo(BaseModel):
    voice_id: str
    name: str
    description: Optional[str] = None
    accent: Optional[str] = None
    gender: Optional[str] = None
    language: Optional[str] = None
    preview_url: Optional[str] = None


class VoicesResponse(BaseModel):
    provider: str
    voices: List[VoiceInfo]


def _catalog_lookup(fetch, provider: str, capability: Optional[str], **kwargs) -> list:
    """Run a provider-catalog lookup, guessing the capability when not given.

    With no ``capability``, realtime providers are tried as realtime first and
    everything else as TTS; if that gives nothing, the other one is tried.
    Raises 404 when the provider doesn't support the capability at all.
    Unexpected errors are not swallowed, so they surface as a 500.
    """
    from api.services.configuration.registry import REALTIME_PROVIDERS

    if capability:
        candidates = [capability]
    elif provider in REALTIME_PROVIDERS or "realtime" in provider.lower():
        candidates = ["realtime", "tts"]
    else:
        candidates = ["tts", "realtime"]

    errors: list[str] = []
    for cap in candidates:
        try:
            result = fetch(provider=provider, capability=cap, **kwargs)
        except ValueError as exc:
            errors.append(str(exc))
            continue
        if result:
            return result
    if len(errors) == len(candidates):
        raise HTTPException(status_code=404, detail="; ".join(errors))
    return []


@router.get("/configurations/voices/{provider}")
async def get_voices(
    provider: str,
    capability: Optional[str] = None,
    model: Optional[str] = None,
    language: Optional[str] = None,
    user: UserModel = Depends(get_user),
) -> VoicesResponse:
    """Get voices for a TTS or realtime provider from the static catalog.

    When ``language`` is given, only voices that can speak it are returned
    (or all voices, if none match).
    """
    from api.services.configuration.provider_catalog import list_voices
    from api.services.voice_preview.listing import get_voice_preview_urls

    catalog_voices = _catalog_lookup(
        list_voices, provider, capability, model=model, language=language
    )
    preview_urls = await get_voice_preview_urls(
        provider=provider, organization_id=user.selected_organization_id
    )
    voices = [
        VoiceInfo(
            voice_id=v.voice_id,
            name=v.name,
            gender=v.gender,
            language=v.language,
            accent=v.accent,
            preview_url=preview_urls.get(v.voice_id),
        )
        for v in catalog_voices
    ]
    return VoicesResponse(provider=provider, voices=voices)


class LanguageInfo(BaseModel):
    code: str  # the value to store and send to the provider, unchanged
    display_code: str  # canonical spelling for display, e.g. "en-US"
    name: str  # full label, e.g. "English (India)"
    language_name: str  # "English"
    region: Optional[str] = None  # "IN"
    region_name: Optional[str] = None  # "India"
    native_name: Optional[str] = None
    flag: Optional[str] = None
    group: str
    base_language: str
    direction: str = "ltr"
    is_auto_detect: bool = False
    voice_count: Optional[int] = None  # from the provider's live voice list


class LanguageGroupInfo(BaseModel):
    id: str
    label: str
    count: int
    languages: List[LanguageInfo]


class LanguagesResponse(BaseModel):
    provider: str
    capability: str
    model: Optional[str] = None
    default: Optional[str] = None
    auto_detect: bool = False
    allow_custom_input: bool = False
    total_languages: int  # distinct languages, e.g. English counts once
    total_options: int  # selectable entries, e.g. en-US, en-GB, en-IN count three times
    source: str = "static"  # "live" = fetched from the provider's API
    fetched_at: Optional[datetime] = None
    # Shown under the picker when the setting doesn't change the audio.
    note: Optional[str] = None
    groups: List[LanguageGroupInfo]
    languages: List[LanguageInfo]  # flat list in display order


def _language_info(locale, voice_counts: Optional[dict] = None) -> LanguageInfo:
    return LanguageInfo(
        voice_count=(voice_counts or {}).get(locale.code),
        code=locale.code,
        display_code=locale.display_code,
        name=locale.label,
        language_name=locale.language_name,
        region=locale.region,
        region_name=locale.region_name,
        native_name=locale.native_name,
        flag=locale.flag,
        group=locale.group,
        base_language=locale.language,
        direction=locale.direction,
        is_auto_detect=locale.is_auto_detect,
    )


@router.get("/configurations/languages/{provider}")
async def get_languages(
    provider: str,
    capability: Optional[str] = None,
    model: Optional[str] = None,
    user: UserModel = Depends(get_user),
) -> LanguagesResponse:
    """Languages a provider supports, for one model when ``model`` is given.

    ``capability`` is ``stt``, ``tts`` or ``realtime`` (``sts`` also works).
    Results are grouped for display and counted, so the picker can show
    "60 languages" for Soniox or "113 languages · 170 options" for Google STT.
    """
    from api.services.configuration.language_sync.store import get_live_languages
    from api.services.configuration.provider_catalog import language_catalog
    from api.services.configuration.registry import REALTIME_PROVIDERS

    if capability:
        live_capability = capability
    elif provider in REALTIME_PROVIDERS or "realtime" in provider.lower():
        live_capability = "realtime"
    else:
        live_capability = "tts"
    live = await get_live_languages(provider, "realtime" if live_capability == "sts" else live_capability)
    catalog = _catalog_lookup(language_catalog, provider, capability, model=model, live=live)
    if not catalog:
        raise HTTPException(status_code=404, detail=f"No languages for provider {provider!r}")
    groups = [
        LanguageGroupInfo(
            id=group.id,
            label=group.label,
            count=group.count,
            languages=[_language_info(l, catalog.voice_counts) for l in group.locales],
        )
        for group in catalog.groups
    ]
    return LanguagesResponse(
        provider=provider,
        capability=catalog.capability,
        model=catalog.model,
        default=catalog.default,
        auto_detect=catalog.auto_detect,
        allow_custom_input=catalog.allow_custom_input,
        total_languages=catalog.total_languages,
        total_options=catalog.total_options,
        source=catalog.source,
        fetched_at=catalog.fetched_at,
        note=catalog.note,
        groups=groups,
        languages=[lang for group in groups for lang in group.languages],
    )
