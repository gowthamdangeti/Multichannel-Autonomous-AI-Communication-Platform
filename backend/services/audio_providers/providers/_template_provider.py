"""_template_provider.py - Structural reference template for all audio provider implementations.

Documentation:
- Provider Docs URL: https://example-provider.com/docs/api-reference
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
class TemplateSTTProvider(BaseSTTProvider):
    """Template showing standard implementation patterns for an STT provider."""

    @property
    def provider_name(self) -> str:
        return "template_provider"

    def validate_config(self, model: str | None) -> tuple[bool, str | None]:
        """Validate whether the specified model is supported by this provider."""
        if not model:
            return True, None
        # Example validation against known models:
        # valid_models = {"model-v1", "model-v2"}
        # if model not in valid_models:
        #     return False, f"Model '{model}' is not supported. Choose from: {sorted(valid_models)}"
        return True, None

    async def transcribe(self, request: STTRequest) -> str:
        """Transcribe audio bytes to text strictly using this provider.

        Never returns None: returns a normalized string or raises a typed error.
        """
        # 1. Validate API Key / Credentials
        if not request.api_key:
            self.log_stt_error(None, "Missing API key")
            raise ProviderConfigurationError(self.provider_name, "API key is required.")

        model = request.model or "default-model"
        base_url = (request.base_url or "https://api.example-provider.com").rstrip("/")
        url = f"{base_url}/v1/transcribe"

        # 2. Structured Start Logging
        start_time = self.log_stt_start(model, "rest", len(request.audio_bytes))

        # 3. Request Preparation
        headers = {
            "Authorization": f"Bearer {request.api_key}",
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

        # 4. HTTP Execution with Timeout
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(url, headers=headers, data=data, files=files)
        except Exception as exc:
            self.log_stt_error(None, str(exc))
            raise ProviderExecutionError(self.provider_name, None, f"Network error: {exc}") from exc

        # 5. Non-2xx Response Handling with Truncated Error Message
        if resp.status_code < 200 or resp.status_code >= 300:
            err_msg = (resp.text or "")[:200]
            self.log_stt_error(resp.status_code, err_msg)
            raise ProviderExecutionError(self.provider_name, resp.status_code, err_msg)

        # 6. Response Parsing and Normalization into Plain String
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
class TemplateTTSProvider(BaseTTSProvider):
    """Template showing standard implementation patterns for a TTS provider."""

    @property
    def provider_name(self) -> str:
        return "template_provider"

    def validate_config(self, model: str | None) -> tuple[bool, str | None]:
        """Validate whether the specified model is supported by this provider."""
        return True, None

    async def synthesize(self, request: TTSRequest) -> bytes:
        """Synthesize text into raw audio bytes strictly using this provider.

        Returns raw audio bytes (mp3/wav/pcm/opus). Normalization to .ogg opus
        is handled centrally by the orchestrator.
        """
        if not request.api_key:
            self.log_tts_error(None, "Missing API key")
            raise ProviderConfigurationError(self.provider_name, "API key is required.")

        model = request.model or "default-model"
        voice = request.voice or "default-voice"
        base_url = (request.base_url or "https://api.example-provider.com").rstrip("/")
        url = f"{base_url}/v1/speak"

        start_time = self.log_tts_start(model, voice, request.text)

        headers = {
            "Authorization": f"Bearer {request.api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": model,
            "voice": voice,
            "text": request.text,
        }
        if request.speed:
            payload["speed"] = request.speed

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(url, headers=headers, json=payload)
        except Exception as exc:
            self.log_tts_error(None, str(exc))
            raise ProviderExecutionError(self.provider_name, None, f"Network error: {exc}") from exc

        if resp.status_code < 200 or resp.status_code >= 300:
            err_msg = (resp.text or "")[:200]
            self.log_tts_error(resp.status_code, err_msg)
            raise ProviderExecutionError(self.provider_name, resp.status_code, err_msg)

        audio_bytes = resp.content
        self.log_tts_success(audio_bytes, start_time)
        return audio_bytes
