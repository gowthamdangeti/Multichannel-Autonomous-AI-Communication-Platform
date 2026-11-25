"""Audio providers package exports."""
from api.services.audio_providers.base import (
    BaseSTTProvider,
    BaseTTSProvider,
    ProviderConfigurationError,
    ProviderExecutionError,
    STTRequest,
    TTSRequest,
)
from api.services.audio_providers.registry import (
    get_stt_provider,
    get_tts_provider,
    list_stt_providers,
    list_tts_providers,
    register_stt_provider,
    register_tts_provider,
)

# Import provider modules to trigger self-registration
from api.services.audio_providers.providers import openai_provider  # noqa: F401
from api.services.audio_providers.providers import deepgram_provider  # noqa: F401
from api.services.audio_providers.providers import soniox_provider  # noqa: F401
from api.services.audio_providers.providers import sarvam_provider  # noqa: F401
from api.services.audio_providers.providers import google_provider  # noqa: F401
from api.services.audio_providers.providers import cartesia_provider  # noqa: F401

__all__ = [
    "BaseSTTProvider",
    "BaseTTSProvider",
    "ProviderConfigurationError",
    "ProviderExecutionError",
    "STTRequest",
    "TTSRequest",
    "get_stt_provider",
    "get_tts_provider",
    "list_stt_providers",
    "list_tts_providers",
    "register_stt_provider",
    "register_tts_provider",
]
