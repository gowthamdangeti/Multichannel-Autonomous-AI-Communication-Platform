"""Cartesia audio provider for STT (ink-whisper) and TTS (Sonic).

Documentation:
- STT: https://docs.cartesia.ai/api-reference/stt
- TTS: https://docs.cartesia.ai/api-reference/tts/bytes
"""
from __future__ import annotations

import httpx

from api.services.audio_providers.base import (
    BaseSTTProvider,
    BaseTTSProvider,
    ProviderConfigurationError,
    ProviderExecutionError,
    STTRequest,
    TTSRequest,
)
from api.services.audio_providers.registry import register_stt_provider, register_tts_provider


@register_stt_provider
class CartesiaSTTProvider(BaseSTTProvider):
    @property
    def provider_name(self) -> str:
        return "cartesia"

    def validate_config(self, model: str | None) -> tuple[bool, str | None]:
        supported_models = {"ink-whisper"}
        if model and model not in supported_models:
            return False, f"Model '{model}' is not supported by Cartesia STT. Choose from: {sorted(supported_models)}"
        return True, None

    async def transcribe(self, request: STTRequest) -> str:
        if not request.api_key:
            self.log_stt_error(None, "Missing API key")
            raise ProviderConfigurationError(self.provider_name, "API key is required.")

        model = request.model or "ink-whisper"
        base_url = (request.base_url or "https://api.cartesia.ai").rstrip("/")
        url = f"{base_url}/stt"

        start_time = self.log_stt_start(model, "rest", len(request.audio_bytes))

        headers = {
            "X-API-Key": request.api_key,
            "Cartesia-Version": "2024-06-10",
        }
        files = {
            "file": (
                request.filename or "audio.ogg",
                request.audio_bytes,
                request.content_type or "audio/ogg",
            )
        }
        data = {"model": model}
        if request.language:
            data["language"] = request.language

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(url, headers=headers, data=data, files=files)
        except Exception as exc:
            self.log_stt_error(None, str(exc))
            raise ProviderExecutionError(self.provider_name, None, f"Network error: {exc}") from exc

        if resp.status_code < 200 or resp.status_code >= 300:
            err_msg = (resp.text or "")[:200]
            self.log_stt_error(resp.status_code, err_msg)
            raise ProviderExecutionError(self.provider_name, resp.status_code, err_msg)

        try:
            result = resp.json()
            transcript = (result.get("text") or result.get("transcript") or "").strip()
            self.log_stt_success(transcript, start_time)
            return transcript
        except Exception as exc:
            self.log_stt_error(resp.status_code, f"Failed to parse response: {exc}")
            raise ProviderExecutionError(
                self.provider_name, resp.status_code, f"Invalid JSON response: {exc}"
            ) from exc


@register_tts_provider
class CartesiaTTSProvider(BaseTTSProvider):
    @property
    def provider_name(self) -> str:
        return "cartesia"

    def validate_config(self, model: str | None) -> tuple[bool, str | None]:
        supported_models = {"sonic-3.5", "sonic-3", "sonic-english"}
        if model and model not in supported_models:
            return False, f"Model '{model}' is not supported by Cartesia TTS. Choose from: {sorted(supported_models)}"
        return True, None

    async def synthesize(self, request: TTSRequest) -> bytes:
        if not request.api_key:
            self.log_tts_error(None, "Missing API key")
            raise ProviderConfigurationError(self.provider_name, "API key not configured")

        model = request.model or "sonic-3.5"
        voice_id = request.voice or "3faa81ae-d3d8-4ab1-9e44-e50e46d33c30"
        base_url = (request.base_url or "https://api.cartesia.ai").rstrip("/")
        url = f"{base_url}/tts/bytes"

        start_time = self.log_tts_start(model, voice_id, request.text)

        headers = {
            "X-API-Key": request.api_key,
            "Cartesia-Version": "2024-06-10",
            "Content-Type": "application/json",
        }
        # Cartesia /tts/bytes supports mp3, wav, raw. Container mp3 is converted to Ogg Opus by the orchestrator.
        payload = {
            "model_id": model,
            "transcript": request.text,
            "voice": {"mode": "id", "id": voice_id},
            "output_format": {
                "container": "mp3",
                "sample_rate": 44100,
            },
        }
        if request.language:
            payload["language"] = request.language

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(url, headers=headers, json=payload)
        except httpx.TimeoutException:
            self.log_tts_error(None, "request timeout after 60s")
            raise ProviderExecutionError(self.provider_name, None, "request timeout after 60s")
        except Exception as exc:
            self.log_tts_error(None, str(exc))
            raise ProviderExecutionError(self.provider_name, None, f"Network error: {exc}") from exc

        if resp.status_code >= 400:
            err_msg = (resp.text or "")[:200]
            prefix = "upstream error: " if resp.status_code >= 500 else ""
            self.log_tts_error(resp.status_code, err_msg)
            raise ProviderExecutionError(self.provider_name, resp.status_code, f"{prefix}{err_msg}")

        audio_bytes = resp.content
        self.log_tts_success(audio_bytes, start_time)
        return audio_bytes
