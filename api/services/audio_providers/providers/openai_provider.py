"""OpenAI audio provider for STT and TTS.

Documentation:
- STT: https://platform.openai.com/docs/api-reference/audio/createTranscription
- TTS: https://platform.openai.com/docs/api-reference/audio/createSpeech
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
class OpenAISTTProvider(BaseSTTProvider):
    @property
    def provider_name(self) -> str:
        return "openai"

    async def transcribe(self, request: STTRequest) -> str:
        if not request.api_key:
            self.log_stt_error(None, "Missing API key")
            raise ProviderConfigurationError(self.provider_name, "API key is required.")

        model = request.model or "whisper-1"
        base_url = (request.base_url or "https://api.openai.com/v1").rstrip("/")
        url = f"{base_url}/audio/transcriptions"

        start_time = self.log_stt_start(model, "rest", len(request.audio_bytes))

        headers = {"Authorization": f"Bearer {request.api_key}"}
        data = {"model": model, "response_format": "json"}
        if request.language:
            data["language"] = request.language

        files = {
            "file": (
                request.filename or "audio.ogg",
                request.audio_bytes,
                request.content_type or "audio/ogg",
            )
        }

        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                resp = await client.post(url, headers=headers, data=data, files=files)
        except Exception as exc:
            self.log_stt_error(None, str(exc))
            raise ProviderExecutionError(self.provider_name, None, f"Network error: {exc}") from exc

        if resp.status_code != 200:
            err_msg = resp.text
            self.log_stt_error(resp.status_code, err_msg)
            raise ProviderExecutionError(self.provider_name, resp.status_code, err_msg)

        try:
            result = resp.json()
            transcript = (result.get("text") or "").strip()
            self.log_stt_success(transcript, start_time)
            return transcript
        except Exception as exc:
            self.log_stt_error(resp.status_code, f"Failed to parse response: {exc}")
            raise ProviderExecutionError(
                self.provider_name, resp.status_code, f"Invalid JSON response: {exc}"
            ) from exc


@register_tts_provider
class OpenAITTSProvider(BaseTTSProvider):
    @property
    def provider_name(self) -> str:
        return "openai"

    async def synthesize(self, request: TTSRequest) -> bytes:
        if not request.api_key:
            self.log_tts_error(None, "Missing API key")
            raise ProviderConfigurationError(self.provider_name, "API key is required.")

        model = request.model or "tts-1"
        voice = request.voice or "alloy"
        base_url = (request.base_url or "https://api.openai.com/v1").rstrip("/")
        url = f"{base_url}/audio/speech"

        start_time = self.log_tts_start(model, voice, request.text)

        headers = {
            "Authorization": f"Bearer {request.api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": model,
            "input": request.text,
            "voice": voice,
            "response_format": "opus",
        }
        if request.speed:
            payload["speed"] = request.speed

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(url, headers=headers, json=payload)
        except Exception as exc:
            self.log_tts_error(None, str(exc))
            raise ProviderExecutionError(self.provider_name, None, f"Network error: {exc}") from exc

        if resp.status_code != 200:
            err_msg = resp.text
            self.log_tts_error(resp.status_code, err_msg)
            raise ProviderExecutionError(self.provider_name, resp.status_code, err_msg)

        audio_bytes = resp.content
        self.log_tts_success(audio_bytes, start_time)
        return audio_bytes
