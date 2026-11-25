"""Domain exceptions for voice preview rendering."""

from __future__ import annotations

from api.services.audio_providers.base import ProviderExecutionError


class VoicePreviewError(Exception):
    """Base class for voice preview failures."""


class VoicePreviewUnsupportedError(VoicePreviewError):
    """Raised when a provider has no preview implementation yet."""

    def __init__(self, provider: str, service_type: str):
        self.provider = provider
        self.service_type = service_type
        super().__init__(
            f"Voice preview is not implemented for {service_type} provider '{provider}'."
        )


class VoicePreviewRequestError(VoicePreviewError):
    """Raised when the preview request itself is invalid (text, keys, provider)."""

    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


class VoicePreviewRateLimitError(VoicePreviewError):
    """Raised when an organization exceeds its hourly preview render budget."""

    def __init__(self, retry_after_seconds: int):
        self.retry_after_seconds = retry_after_seconds
        self.message = (
            "Voice preview limit reached for your organization. "
            f"Try again in {max(1, retry_after_seconds // 60)} minute(s)."
        )
        super().__init__(self.message)


class VoicePreviewRenderError(VoicePreviewError):
    """Raised when the provider failed to synthesize or the audio could not be stored."""

    def __init__(self, provider: str, message: str):
        self.provider = provider
        self.message = message
        super().__init__(f"Voice preview synthesis failed for '{provider}': {message}")

    @classmethod
    def from_provider_error(
        cls, provider: str, error: ProviderExecutionError
    ) -> VoicePreviewRenderError:
        return cls(provider, error.message)
