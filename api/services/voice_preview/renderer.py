"""Turn a UI service configuration into a TTS provider request.

Mirrors the mapping used by the WhatsApp voice-note path (see
``api/services/whatsapp/conversation.py::_synthesize_voice_reply``) so previews
render through exactly the same provider implementations as live calls.
"""

from __future__ import annotations

from typing import Any

from api.services.audio_providers.base import TTSRequest
from api.services.configuration.masking import contains_masked_key
from api.services.configuration.registry import (
    REGISTRY,
    BaseServiceConfiguration,
    ServiceType,
)
from api.services.voice_preview.capabilities import (
    SERVICE_TYPE_STS,
    normalize_provider,
)
from api.services.voice_preview.exceptions import VoicePreviewRequestError


def _service_type_enum(service_type: str) -> ServiceType:
    return ServiceType.REALTIME if service_type == SERVICE_TYPE_STS else ServiceType.TTS


def compile_preview_config(
    *,
    service_type: str,
    provider: str,
    raw_config: dict[str, Any] | None,
) -> BaseServiceConfiguration:
    """Validate the UI config blob into the provider's typed configuration."""
    normalized = normalize_provider(provider)
    model_class = REGISTRY[_service_type_enum(service_type)].get(normalized)
    if model_class is None:
        raise VoicePreviewRequestError(f"Unknown {service_type} provider '{provider}'.")

    payload = dict(raw_config or {})
    payload["provider"] = normalized
    try:
        return model_class.model_validate(payload)
    except Exception as exc:
        raise VoicePreviewRequestError(
            f"Invalid {normalized} configuration for preview: {exc}"
        ) from exc


def extract_api_key(config: BaseServiceConfiguration) -> str | None:
    """Return the first configured key, or None when the field is empty."""
    value = config.get_all_api_keys() if hasattr(config, "get_all_api_keys") else None
    if not value:
        raw = getattr(config, "api_key", None)
        value = [raw] if isinstance(raw, str) else list(raw or [])
    return value[0] if value else None


def has_masked_api_key(config: BaseServiceConfiguration) -> bool:
    value = config.get_all_api_keys() if hasattr(config, "get_all_api_keys") else None
    if value is None:
        value = getattr(config, "api_key", None)
    return contains_masked_key(value)


def provider_name(config: BaseServiceConfiguration) -> str:
    """Normalized provider string for a typed service configuration."""
    provider = getattr(config, "provider", None)
    return normalize_provider(getattr(provider, "value", provider))


def build_tts_request(
    *, config: BaseServiceConfiguration, api_key: str, text: str
) -> TTSRequest:
    """Map a typed TTS/realtime configuration onto a provider request."""
    model = getattr(config, "model", None) or ""
    return TTSRequest(
        text=text,
        model=model,
        voice=getattr(config, "voice", None) or None,
        api_key=api_key,
        language=getattr(config, "language", None) or None,
        base_url=getattr(config, "base_url", None) or None,
        speed=getattr(config, "speed", 1.0) or 1.0,
        credentials=getattr(config, "credentials", None),
        location=getattr(config, "location", None),
    )
