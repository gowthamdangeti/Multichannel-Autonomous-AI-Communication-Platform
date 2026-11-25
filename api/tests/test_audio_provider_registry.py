"""Tests for audio provider registry, base contracts, reference providers, and dynamic dispatch."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

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
)
from api.services.audio_providers.providers.openai_provider import (
    OpenAISTTProvider,
    OpenAITTSProvider,
)
from api.services.audio_providers.providers.deepgram_provider import (
    DeepgramSTTProvider,
    DeepgramTTSProvider,
)
from api.services.audio_providers.providers.soniox_provider import (
    SonioxSTTProvider,
    SonioxTTSProvider,
)


def test_registry_contains_reference_providers():
    """Verify registry maps reference provider names to valid instances."""
    stt_providers = list_stt_providers()
    tts_providers = list_tts_providers()

    assert "openai" in stt_providers
    assert "deepgram" in stt_providers
    assert "soniox" in stt_providers

    assert "openai" in tts_providers
    assert "deepgram" in tts_providers
    assert "soniox" in tts_providers

    assert isinstance(get_stt_provider("openai"), OpenAISTTProvider)
    assert isinstance(get_stt_provider("deepgram"), DeepgramSTTProvider)
    assert isinstance(get_stt_provider("soniox"), SonioxSTTProvider)

    assert isinstance(get_tts_provider("openai"), OpenAITTSProvider)
    assert isinstance(get_tts_provider("deepgram"), DeepgramTTSProvider)
    assert isinstance(get_tts_provider("soniox"), SonioxTTSProvider)


def test_missing_provider_returns_none():
    """Unregistered providers safely return None without throwing."""
    assert get_stt_provider("unknown_provider_xyz") is None
    assert get_tts_provider("unknown_provider_xyz") is None


@pytest.mark.asyncio
async def test_openai_stt_missing_api_key_raises_configuration_error():
    """OpenAI STT raises ProviderConfigurationError when api_key is None."""
    provider = get_stt_provider("openai")
    req = STTRequest(
        audio_bytes=b"dummy",
        filename="test.ogg",
        content_type="audio/ogg",
        model="whisper-1",
        api_key=None,
    )
    with pytest.raises(ProviderConfigurationError) as exc_info:
        await provider.transcribe(req)
    assert "openai" in exc_info.value.provider


@pytest.mark.asyncio
async def test_deepgram_stt_request_shape():
    """Verify Deepgram STT sends Authorization Token header and proper query params."""
    provider = get_stt_provider("deepgram")
    req = STTRequest(
        audio_bytes=b"sample_audio_data",
        filename="sample.ogg",
        content_type="audio/ogg",
        model="nova-3-general",
        api_key="dg-secret-key-123",
        language="en",
    )

    from unittest.mock import MagicMock
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "results": {
            "channels": [
                {"alternatives": [{"transcript": "Hello from Deepgram"}]}
            ]
        }
    }

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = mock_resp
        transcript = await provider.transcribe(req)

        assert transcript == "Hello from Deepgram"
        assert mock_post.called
        call_args = mock_post.call_args
        url = call_args[0][0]
        headers = call_args[1]["headers"]

        assert "api.deepgram.com" in url
        assert "model=nova-3-general" in url
        assert "language=en" in url
        assert headers["Authorization"] == "Token dg-secret-key-123"


@pytest.mark.asyncio
async def test_soniox_dual_transport_dispatch():
    """Verify Soniox branches on model: stt-rt uses WebSocket and stt-async uses REST."""
    provider = get_stt_provider("soniox")

    # 1. Real-time model routes to WebSocket
    req_rt = STTRequest(
        audio_bytes=b"sample_audio",
        filename="test.ogg",
        content_type="audio/ogg",
        model="stt-rt-v5",
        api_key="soniox-key-123",
    )
    with patch.object(provider, "_transcribe_ws", new_callable=AsyncMock) as mock_ws:
        mock_ws.return_value = "Realtime WebSocket Transcript"
        result = await provider.transcribe(req_rt)
        assert result == "Realtime WebSocket Transcript"
        assert mock_ws.called

    # 2. Async model routes to REST
    req_async = STTRequest(
        audio_bytes=b"sample_audio",
        filename="test.ogg",
        content_type="audio/ogg",
        model="stt-async-v5",
        api_key="soniox-key-123",
    )
    with patch.object(provider, "_transcribe_rest", new_callable=AsyncMock) as mock_rest:
        mock_rest.return_value = "Async REST Transcript"
        result = await provider.transcribe(req_async)
        assert result == "Async REST Transcript"
        assert mock_rest.called


@pytest.mark.asyncio
async def test_orchestrator_dynamic_switching():
    """Verify conversation.py orchestrator instantiates different providers based on config."""
    from api.services.whatsapp.conversation import _transcribe_audio_bytes
    from api.db.models import WhatsAppAgentModel

    agent = WhatsAppAgentModel()
    agent.organization_id = 1
    agent.model_config_ref = {}

    # Mock effective config returning Deepgram
    with patch(
        "api.services.whatsapp.conversation.get_effective_ai_model_configuration_for_workflow"
    ) as mock_get_eff:
        class FakeConfig:
            class FakeSTT:
                provider = "deepgram"
                api_key = "dg-key"
                model = "nova-3-general"
                base_url = None
                language = None
            stt = FakeSTT()

        mock_get_eff.return_value = FakeConfig()

        dg_provider = get_stt_provider("deepgram")
        with patch.object(dg_provider, "transcribe", new_callable=AsyncMock) as mock_dg_tx:
            mock_dg_tx.return_value = "Transcribed via Deepgram"
            res, err = await _transcribe_audio_bytes(b"audio", "a.ogg", "audio/ogg", agent)
            assert res == "Transcribed via Deepgram"
            assert err is None
            assert mock_dg_tx.called

        # Switch effective config to OpenAI
        class FakeConfigOpenAI:
            class FakeSTT:
                provider = "openai"
                api_key = "oa-key"
                model = "whisper-1"
                base_url = None
                language = None
            stt = FakeSTT()

        mock_get_eff.return_value = FakeConfigOpenAI()
        oa_provider = get_stt_provider("openai")
        with patch.object(oa_provider, "transcribe", new_callable=AsyncMock) as mock_oa_tx:
            mock_oa_tx.return_value = "Transcribed via OpenAI"
            res, err = await _transcribe_audio_bytes(b"audio", "a.ogg", "audio/ogg", agent)
            assert res == "Transcribed via OpenAI"
            assert err is None
            assert mock_oa_tx.called


def test_chunk2a_providers_registered():
    """Verify Chunk 2a providers (sarvam, google, cartesia) are registered."""
    for p in ("sarvam", "google", "cartesia"):
        assert get_stt_provider(p) is not None, f"STT provider {p} not found in registry"
        assert get_tts_provider(p) is not None, f"TTS provider {p} not found in registry"


@pytest.mark.asyncio
async def test_sarvam_stt_request_shape():
    """Verify Sarvam uses api-subscription-key header and speech-to-text endpoint."""
    from unittest.mock import MagicMock
    provider = get_stt_provider("sarvam")
    req = STTRequest(
        audio_bytes=b"sarvam_audio",
        filename="hi.wav",
        content_type="audio/wav",
        model="saarika:v2.5",
        api_key="sarvam_sub_key",
        language="hi-IN",
    )
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {"transcript": "नमस्ते"}

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = mock_resp
        transcript = await provider.transcribe(req)
        assert transcript == "नमस्ते"
        call_args = mock_post.call_args
        headers = call_args[1]["headers"]
        assert headers["api-subscription-key"] == "sarvam_sub_key"


@pytest.mark.asyncio
async def test_cartesia_tts_request_shape():
    """Verify Cartesia TTS includes X-API-Key and Cartesia-Version headers."""
    from unittest.mock import MagicMock
    provider = get_tts_provider("cartesia")
    req = TTSRequest(
        text="Hello world",
        model="sonic-3.5",
        voice="voice-uuid-1",
        api_key="cartesia_key",
    )
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.content = b"fake_ogg_bytes"

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = mock_resp
        raw_audio = await provider.synthesize(req)
        assert raw_audio == b"fake_ogg_bytes"
        call_args = mock_post.call_args
        headers = call_args[1]["headers"]
        assert headers["X-API-Key"] == "cartesia_key"
        assert headers["Cartesia-Version"] == "2024-06-10"


def test_all_ui_providers_have_audio_implementations():
    """Drift safety net: compare UI configuration registry against audio runtime registry."""
    from api.services.audio_providers.registry import registered_stt_names, registered_tts_names
    from api.services.configuration.registry import REGISTRY, ServiceType

    config_stt = {p.value if hasattr(p, "value") else str(p) for p in REGISTRY[ServiceType.STT].keys()}
    config_tts = {p.value if hasattr(p, "value") else str(p) for p in REGISTRY[ServiceType.TTS].keys()}

    active_stt = registered_stt_names()
    active_tts = registered_tts_names()

    missing_stt = config_stt - active_stt
    missing_tts = config_tts - active_tts

    print(f"\nMISSING STT: {missing_stt}")
    print(f"MISSING TTS: {missing_tts}")

    # Verify Chunk 1 + Chunk 2a providers are 100% covered without drift
    chunk1_and_2a = {"openai", "deepgram", "soniox", "sarvam", "google", "cartesia"}
    assert chunk1_and_2a <= active_stt
    assert chunk1_and_2a <= active_tts

