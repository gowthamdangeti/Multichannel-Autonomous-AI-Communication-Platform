"""Plaintext credential resolution for voice preview rendering.

A preview may be requested before the form is saved, so the submitted API key
is used when it is a real value and restored from the saved configuration when
it is only a mask of one. "Saved configuration" is the admin model preset being
edited when one is named, then the organization's effective configuration.
"""

from __future__ import annotations

from pydantic import ValidationError

from api.db.platform_client import platform_client
from api.schemas.ai_model_configuration import (
    EffectiveAIModelConfiguration,
    OrganizationAIModelConfigurationV2,
    compile_ai_model_configuration_v2,
)
from api.services.configuration.ai_model_configuration import (
    get_resolved_ai_model_configuration,
)
from api.services.configuration.masking import (
    contains_masked_key,
    resolve_masked_api_keys,
)
from api.services.configuration.registry import BaseServiceConfiguration
from api.services.voice_preview.capabilities import (
    SERVICE_TYPE_STS,
    normalize_provider,
)
from api.services.voice_preview.exceptions import VoicePreviewRequestError
from api.services.voice_preview.renderer import (
    extract_api_key,
    has_masked_api_key,
    provider_name,
)


async def _preset_effective(
    model_configuration_id: int,
) -> EffectiveAIModelConfiguration | None:
    """Compile the stored admin preset, or None when it has no usable config."""
    row = await platform_client.get_model_configuration(model_configuration_id)
    if row is None:
        raise VoicePreviewRequestError("Model configuration not found.")
    if not row.config:
        return None
    try:
        return compile_ai_model_configuration_v2(
            OrganizationAIModelConfigurationV2.model_validate(row.config)
        )
    except (ValidationError, ValueError):
        return None


def _stored_key_for(
    effective: EffectiveAIModelConfiguration | None,
    *,
    service_type: str,
    requested: set[str],
) -> str | None:
    """Saved key of the matching TTS / realtime service in `effective`."""
    if effective is None:
        return None
    candidates: list[BaseServiceConfiguration | None] = []
    if service_type == SERVICE_TYPE_STS:
        candidates.append(effective.realtime)
    candidates.append(effective.tts)
    for candidate in candidates:
        if candidate is not None and provider_name(candidate) in requested:
            key = extract_api_key(candidate)
            if key:
                return key
    return None


async def resolve_api_key(
    *,
    service_type: str,
    provider: str,
    preview_provider: str,
    config: BaseServiceConfiguration,
    organization_id: int | None,
    user_id: int | None,
    model_configuration_id: int | None = None,
) -> str:
    """Return a usable plaintext key, or raise when none can be resolved."""
    submitted = extract_api_key(config)
    if submitted and not has_masked_api_key(config):
        return submitted

    requested = {normalize_provider(provider), normalize_provider(preview_provider)}

    stored_key: str | None = None
    if model_configuration_id is not None:
        stored_key = _stored_key_for(
            await _preset_effective(model_configuration_id),
            service_type=service_type,
            requested=requested,
        )
    if not stored_key:
        resolved = await get_resolved_ai_model_configuration(
            user_id=user_id, organization_id=organization_id
        )
        stored_key = _stored_key_for(
            resolved.effective, service_type=service_type, requested=requested
        )

    if not stored_key:
        raise VoicePreviewRequestError(
            "No saved API key for this provider. Enter the API key, or save the "
            "configuration with it, before generating a preview."
        )
    if not submitted:
        return stored_key

    merged = resolve_masked_api_keys(submitted, stored_key)
    if isinstance(merged, list):
        merged = merged[0] if merged else ""
    if contains_masked_key(merged):
        raise VoicePreviewRequestError(
            "The API key looks masked. Save the configuration before generating "
            "a preview."
        )
    return merged
