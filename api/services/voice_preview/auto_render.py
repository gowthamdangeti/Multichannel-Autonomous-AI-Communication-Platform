"""Render voice previews for the voices of a just-saved model configuration.

Save endpoints enqueue an ARQ job carrying only *where* the configuration lives
(``source`` + id) — never the configuration itself, which holds API keys. The
worker reloads the saved row and renders any voice that has no stored preview
yet, so voice pickers (e.g. agent model overrides) can play it. Failures are
logged and never affect the save.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from loguru import logger
from pydantic import ValidationError

from api.db.platform_client import platform_client
from api.enums import OrganizationConfigurationKey
from api.schemas.ai_model_configuration import (
    OrganizationAIModelConfigurationV2,
    compile_ai_model_configuration_v2,
)
from api.schemas.voice_preview import VoicePreviewRequest, VoicePreviewScope
from api.services.configuration.ai_model_configuration import (
    get_organization_ai_model_configuration_v2,
)
from api.services.configuration.registry import BaseServiceConfiguration
from api.services.voice_preview.capabilities import (
    SERVICE_TYPE_STS,
    SERVICE_TYPE_TTS,
    get_preview_capability,
)
from api.services.voice_preview.exceptions import VoicePreviewError
from api.services.voice_preview.preview_service import render_voice_preview
from api.services.voice_preview.renderer import provider_name

# Where a saved model configuration lives. Every source except "organization"
# is superadmin-managed and renders shared platform previews.
ConfigurationSource = Literal[
    "platform_preset", "platform_global", "platform_org", "organization"
]


@dataclass(frozen=True)
class ConfiguredVoice:
    """A voice a model configuration speaks with (TTS or speech-to-speech)."""

    service_type: str
    provider: str
    voice: str
    service: BaseServiceConfiguration


def list_configured_voices(
    configuration: OrganizationAIModelConfigurationV2,
) -> list[ConfiguredVoice]:
    """Every voice the configuration uses, whether or not it can be previewed."""
    effective = compile_ai_model_configuration_v2(configuration)
    services: list[tuple[str, BaseServiceConfiguration | None]] = [
        (SERVICE_TYPE_TTS, effective.tts),
        (SERVICE_TYPE_STS, effective.realtime),
    ]
    voices: list[ConfiguredVoice] = []
    for service_type, service in services:
        voice = str(getattr(service, "voice", "") or "").strip() if service else ""
        if service is None or not voice:
            continue
        voices.append(
            ConfiguredVoice(
                service_type=service_type,
                provider=provider_name(service),
                voice=voice,
                service=service,
            )
        )
    return voices


def list_preview_requests(
    configuration: OrganizationAIModelConfigurationV2, scope: VoicePreviewScope
) -> list[VoicePreviewRequest]:
    """One request per configured voice whose provider can render a preview."""
    return [
        VoicePreviewRequest(
            service_type=item.service_type,
            provider=item.provider,
            voice=item.voice,
            model=str(getattr(item.service, "model", "") or ""),
            config=item.service.model_dump(mode="json", exclude_none=True),
            scope=scope,
        )
        for item in list_configured_voices(configuration)
        if get_preview_capability(
            service_type=item.service_type, provider=item.provider
        ).supported
    ]


async def get_saved_configuration(
    *, source: ConfigurationSource, source_id: int | None
) -> OrganizationAIModelConfigurationV2 | None:
    """Reload a saved configuration (with plaintext keys) from its source."""
    if source == "organization":
        return await get_organization_ai_model_configuration_v2(source_id)

    blob: dict | None = None
    if source == "platform_preset" and source_id is not None:
        preset = await platform_client.get_model_configuration(source_id)
        blob = preset.config if preset else None
    elif source == "platform_org" and source_id is not None:
        blob = await platform_client.get_org_model_configuration_v2(source_id)
    elif source == "platform_global":
        blob = await platform_client.get_platform_config_value(
            OrganizationConfigurationKey.MODEL_CONFIGURATION_V2.value
        )
    if not blob:
        return None
    return OrganizationAIModelConfigurationV2.model_validate(blob)


async def render_previews_for_saved_configuration(
    configuration: OrganizationAIModelConfigurationV2,
    *,
    scope: VoicePreviewScope,
    organization_id: int | None,
    user_id: int | None,
) -> None:
    """Make sure every voice in `configuration` has a stored preview."""
    try:
        requests = list_preview_requests(configuration, scope)
    except (ValidationError, ValueError) as exc:
        logger.warning(f"Auto voice preview skipped: config did not compile ({exc})")
        return

    for request in requests:
        try:
            result = await render_voice_preview(
                request=request,
                organization_id=organization_id if scope == "organization" else None,
                user_id=user_id,
            )
            logger.info(
                f"Auto voice preview ready provider={result.provider} "
                f"voice={result.voice_id} scope={scope} cached={result.cached}"
            )
        except VoicePreviewError as exc:
            # One voice failing (bad key, provider down) must not stop others.
            logger.warning(
                f"Auto voice preview failed provider={request.provider} "
                f"voice={request.voice} scope={scope}: {exc}"
            )


async def render_previews_for_saved_source(
    *, source: ConfigurationSource, source_id: int | None, user_id: int | None
) -> None:
    """Worker entry: reload the saved configuration, then render its previews."""
    try:
        configuration = await get_saved_configuration(
            source=source, source_id=source_id
        )
    except (ValidationError, ValueError) as exc:
        logger.warning(
            f"Auto voice preview skipped: {source}:{source_id} invalid ({exc})"
        )
        return
    if configuration is None:
        logger.info(f"Auto voice preview skipped: {source}:{source_id} has no config")
        return

    is_tenant = source == "organization"
    await render_previews_for_saved_configuration(
        configuration,
        scope="organization" if is_tenant else "global",
        organization_id=source_id if is_tenant else None,
        user_id=user_id,
    )
