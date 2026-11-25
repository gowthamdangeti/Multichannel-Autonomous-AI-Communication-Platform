"""Deepgram audio provider for STT and TTS.

Documentation:
- STT: https://developers.deepgram.com/docs/pre-recorded-audio
- TTS: https://developers.deepgram.com/docs/text-to-speech-rest
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
class DeepgramSTTProvider(BaseSTTProvider):
    @property
    def provider_name(self) -> str:
        return "deepgram"

    async def transcribe(self, request: STTRequest) -> str:
        if not request.api_key:
            self.log_stt_error(None, "Missing API key")
            raise ProviderConfigurationError(self.provider_name, "API key is required.")

        model = request.model or "nova-3-general"
        base_url = (request.base_url or "https://api.deepgram.com").rstrip("/")
        query_params = f"model={model}&smart_format=true"
        if request.language and request.language != "multi":
            query_params += f"&language={request.language}"

        url = f"{base_url}/v1/listen?{query_params}"
        start_time = self.log_stt_start(model, "rest", len(request.audio_bytes))

        headers = {
            "Authorization": f"Token {request.api_key}",
            "Content-Type": request.content_type or "audio/ogg",
        }

        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                resp = await client.post(url, headers=headers, content=request.audio_bytes)
        except Exception as exc:
            self.log_stt_error(None, str(exc))
            raise ProviderExecutionError(self.provider_name, None, f"Network error: {exc}") from exc

        if resp.status_code != 200:
            err_msg = resp.text
            self.log_stt_error(resp.status_code, err_msg)
            raise ProviderExecutionError(self.provider_name, resp.status_code, err_msg)

        try:
            r = resp.json()
            channels = r.get("results", {}).get("channels", [{}])
            alts = channels[0].get("alternatives", [{}]) if channels else [{}]
            transcript = (alts[0].get("transcript") or "").strip()
            self.log_stt_success(transcript, start_time)
            return transcript
        except Exception as exc:
            self.log_stt_error(resp.status_code, f"Failed to parse response: {exc}")
            raise ProviderExecutionError(
                self.provider_name, resp.status_code, f"Invalid JSON response: {exc}"
            ) from exc


@register_tts_provider
class DeepgramTTSProvider(BaseTTSProvider):
    @property
    def provider_name(self) -> str:
        return "deepgram"

    async def synthesize(self, request: TTSRequest) -> bytes:
        if not request.api_key:
            self.log_tts_error(None, "Missing API key")
            raise ProviderConfigurationError(self.provider_name, "API key is required.")

        # Deepgram TTS voice ID / model
        model = request.model or "aura-asteria-en"
        base_url = (request.base_url or "https://api.deepgram.com").rstrip("/")
        url = f"{base_url}/v1/speak?model={model}&container=ogg"

        start_time = self.log_tts_start(model, request.voice, request.text)

        headers = {
            "Authorization": f"Token {request.api_key}",
            "Content-Type": "application/json",
        }
        payload = {"text": request.text}

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
