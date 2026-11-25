from unittest.mock import MagicMock

from api.services.configuration.check_validity import UserConfigurationValidator
from api.services.configuration.registry import ServiceProviders
from api.services.pipecat.audio_config import AudioConfig
from api.services.pipecat.service_factory import create_stt_service, create_tts_service
from pipecat.services.soniox.stt import SonioxSTTService
from pipecat.services.soniox.tts import SonioxTTSService


def test_create_soniox_stt_service():
    user_config = MagicMock()
    user_config.stt.provider = ServiceProviders.SONIOX.value
    user_config.stt.model = "stt-rt-v2"
    user_config.stt.api_key = "test-soniox-stt-key"

    audio_config = AudioConfig(transport_in_sample_rate=16000, transport_out_sample_rate=16000)

    stt_service = create_stt_service(user_config, audio_config)
    assert stt_service is not None
    assert isinstance(stt_service, SonioxSTTService)


def test_create_soniox_tts_service():
    user_config = MagicMock()
    user_config.tts.provider = ServiceProviders.SONIOX.value
    user_config.tts.model = "tts-rt-v2"
    user_config.tts.voice = "Bryce"
    user_config.tts.api_key = "test-soniox-tts-key"
    user_config.tts.url = "wss://tts-rt.soniox.com/tts-websocket"
    user_config.tts.speed = 1.0

    audio_config = AudioConfig(transport_in_sample_rate=16000, transport_out_sample_rate=16000)

    tts_service = create_tts_service(user_config, audio_config)
    assert tts_service is not None
    assert isinstance(tts_service, SonioxTTSService)


def test_validate_soniox_api_key():
    validator = UserConfigurationValidator()
    assert validator._check_soniox_api_key("stt-rt-v2", "valid-soniox-key") is True


def _soniox_stt_config(language):
    user_config = MagicMock()
    user_config.stt.provider = ServiceProviders.SONIOX.value
    user_config.stt.model = "stt-rt-v5"
    user_config.stt.api_key = "test-soniox-stt-key"
    user_config.stt.language = language
    return user_config


def test_soniox_stt_sends_selected_language_as_hint():
    from pipecat.transcriptions.language import Language

    audio_config = AudioConfig(transport_in_sample_rate=16000, transport_out_sample_rate=16000)
    stt_service = create_stt_service(_soniox_stt_config("hi"), audio_config)
    assert stt_service._settings.language_hints == [Language.HI]


def test_soniox_stt_regional_code_becomes_plain_hint():
    from pipecat.transcriptions.language import Language

    audio_config = AudioConfig(transport_in_sample_rate=16000, transport_out_sample_rate=16000)
    stt_service = create_stt_service(_soniox_stt_config("en-IN"), audio_config)
    assert stt_service._settings.language_hints == [Language.EN]


def test_soniox_stt_auto_sends_no_hint():
    audio_config = AudioConfig(transport_in_sample_rate=16000, transport_out_sample_rate=16000)
    stt_service = create_stt_service(_soniox_stt_config("auto"), audio_config)
    assert not stt_service._settings.language_hints
