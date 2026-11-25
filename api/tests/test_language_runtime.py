"""The selected language reaches each provider's pipecat service."""

from unittest.mock import MagicMock

import pytest

from api.services.configuration.registry import ServiceProviders
from api.services.pipecat.audio_config import AudioConfig
from api.services.pipecat.service_factory import create_stt_service, create_tts_service
from pipecat.transcriptions.language import Language

AUDIO = AudioConfig(transport_in_sample_rate=16000, transport_out_sample_rate=16000)


def _stt(provider, model, language, **extra):
    config = MagicMock()
    config.stt.provider = provider
    config.stt.model = model
    config.stt.api_key = "test-key"
    config.stt.language = language
    config.stt.base_url = extra.get("base_url")
    config.stt.bill_to = None
    config.stt.return_timestamps = False
    return config


@pytest.mark.parametrize("language,expected", [("hi", Language.HI), ("es-MX", Language.ES), (None, Language.EN)])
def test_openai_stt_sends_language(language, expected):
    service = create_stt_service(_stt(ServiceProviders.OPENAI.value, "gpt-4o-transcribe", language), AUDIO)
    assert service._settings.language == expected


@pytest.mark.parametrize("language,expected", [("ta", "ta"), ("fr-FR", "fr"), (None, "en")])
def test_cartesia_stt_sends_language(language, expected):
    service = create_stt_service(_stt(ServiceProviders.CARTESIA.value, "ink-whisper", language), AUDIO)
    assert service._settings.language == expected


@pytest.mark.parametrize("language,expected", [("de", Language.DE), ("auto", None)])
def test_huggingface_stt_sends_language_or_auto_detects(language, expected):
    service = create_stt_service(
        _stt(ServiceProviders.HUGGINGFACE.value, "openai/whisper-large-v3-turbo", language), AUDIO
    )
    assert service._settings.language == expected


@pytest.mark.parametrize("language,expected", [("hi", "Hindi"), ("yue", "Chinese,Yue"), ("auto", "auto")])
async def test_minimax_sends_language_boost(language, expected):
    config = MagicMock()
    config.tts.provider = ServiceProviders.MINIMAX.value
    config.tts.model = "speech-2.8-hd"
    config.tts.api_key = "test-key"
    config.tts.group_id = "group"
    config.tts.voice = "English_Graceful_Lady"
    config.tts.speed = 1.0
    config.tts.base_url = None
    config.tts.language = language
    service = create_tts_service(config, AUDIO)
    try:
        assert service._settings.language_boost == expected
    finally:
        await service._session.close()
