"""Which providers can render a voice preview, and via which TTS engine.

Speech-to-speech (``realtime``) providers hold a session open instead of
exposing a REST synthesis call, so those voices are previewed through the
provider's TTS sibling. Providers without a sibling (xAI, Ultravox) stay
unsupported until a dedicated preview renderer exists.
"""

from __future__ import annotations

from dataclasses import dataclass

from api.services.audio_providers.registry import list_tts_providers
from api.services.configuration.registry import (
    REALTIME_PROVIDERS,
    REGISTRY,
    ServiceType,
)

SERVICE_TYPE_TTS = "tts"
SERVICE_TYPE_STS = "sts"

# realtime provider -> TTS provider whose voice ids it shares.
REALTIME_PREVIEW_PROVIDERS: dict[str, str] = {
    "openai_realtime": "openai",
    "google_realtime": "google",
    "google_vertex_realtime": "google",
    "azure_realtime": "azure_speech",
}

UNSUPPORTED_REASON = "Preview is not implemented for this provider yet."


@dataclass(frozen=True)
class PreviewCapability:
    """Whether a provider voice can be previewed, and through which engine."""

    supported: bool
    preview_provider: str | None = None
    reason: str | None = None


def normalize_provider(provider: str | None) -> str:
    return (provider or "").strip().lower()


def list_configurable_providers() -> dict[str, list[str]]:
    """Every provider the model-configuration UI can select, by service type."""
    tts_providers = [
        provider.value if hasattr(provider, "value") else str(provider)
        for provider in REGISTRY[ServiceType.TTS]
    ]
    return {
        SERVICE_TYPE_TTS: sorted(tts_providers),
        SERVICE_TYPE_STS: sorted(REALTIME_PROVIDERS),
    }


def get_preview_provider(*, service_type: str, provider: str | None) -> str | None:
    """Return the TTS provider that renders previews for this selection."""
    normalized = normalize_provider(provider)
    if not normalized:
        return None

    registered = set(list_tts_providers())
    if service_type == SERVICE_TYPE_STS:
        sibling = REALTIME_PREVIEW_PROVIDERS.get(normalized)
        return sibling if sibling in registered else None
    if service_type == SERVICE_TYPE_TTS:
        return normalized if normalized in registered else None
    return None


def get_preview_capability(
    *, service_type: str, provider: str | None
) -> PreviewCapability:
    preview_provider = get_preview_provider(
        service_type=service_type, provider=provider
    )
    if preview_provider is None:
        return PreviewCapability(supported=False, reason=UNSUPPORTED_REASON)
    return PreviewCapability(supported=True, preview_provider=preview_provider)


def list_preview_capabilities() -> dict[str, dict[str, PreviewCapability]]:
    """Capability map keyed by service type, then provider."""
    return {
        service_type: {
            provider: get_preview_capability(
                service_type=service_type, provider=provider
            )
            for provider in providers
        }
        for service_type, providers in list_configurable_providers().items()
    }
