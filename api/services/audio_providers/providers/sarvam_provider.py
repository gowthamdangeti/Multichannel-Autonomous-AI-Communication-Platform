"""Sarvam AI audio provider for STT (saarika/saaras) and TTS (bulbul).

Documentation:
- STT: https://docs.sarvam.ai/api-reference/speech-to-text
- TTS: https://docs.sarvam.ai/api-reference/text-to-speech
"""
from __future__ import annotations

import base64
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
class SarvamSTTProvider(BaseSTTProvider):
    @property
    def provider_name(self) -> str:
        return "sarvam"

    def validate_config(self, model: str | None) -> tuple[bool, str | None]:
        supported_models = {"saarika:v2.5", "saaras:v3"}
        if model and model not in supported_models:
            return False, f"Model '{model}' is not supported by Sarvam STT. Choose from: {sorted(supported_models)}"
        return True, None

    async def transcribe(self, request: STTRequest) -> str:
        if not request.api_key:
            self.log_stt_error(None, "Missing API key")
            raise ProviderConfigurationError(self.provider_name, "API key is required.")

        model = request.model or "saarika:v2.5"
        base_url = (request.base_url or "https://api.sarvam.ai").rstrip("/")
        url = f"{base_url}/speech-to-text"

        start_time = self.log_stt_start(model, "rest", len(request.audio_bytes))

        audio_data = request.audio_bytes
        filename = request.filename or "audio.wav"
        content_type = request.content_type or "audio/wav"

        # Sarvam speech-to-text API only supports audio/wav, audio/mp3, audio/mpeg with a strict 30s limit.
        # Transcode via ffmpeg to standard 16kHz mono WAV and cap at 30 seconds (-t 30).
        try:
            import asyncio
            proc = await asyncio.create_subprocess_exec(
                "ffmpeg",
                "-hide_banner",
                "-loglevel", "error",
                "-i", "pipe:0",
                "-t", "30",
                "-ar", "16000",
                "-ac", "1",
                "-f", "wav",
                "pipe:1",
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate(input=audio_data)
            if proc.returncode == 0 and stdout:
                audio_data = stdout
                filename = "audio.wav"
                content_type = "audio/wav"
            else:
                self.log_stt_error(None, f"ffmpeg conversion to wav failed: {stderr.decode(errors='replace')}")
        except Exception as ffmpeg_err:
            self.log_stt_error(None, f"ffmpeg conversion error: {ffmpeg_err}")

        headers = {
            "api-subscription-key": request.api_key,
        }
        data = {
            "model": model,
            "language": request.language or "unknown",
        }
        files = {
            "file": (
                filename,
                audio_data,
                content_type,
            )
        }

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(url, headers=headers, data=data, files=files)
        except httpx.TimeoutException:
            self.log_stt_error(None, "request timeout after 60s")
            raise ProviderExecutionError(self.provider_name, None, "request timeout after 60s")
        except Exception as exc:
            self.log_stt_error(None, str(exc))
            raise ProviderExecutionError(self.provider_name, None, f"Network error: {exc}") from exc

        if resp.status_code >= 400:
            err_msg = (resp.text or "")[:200]
            prefix = "upstream error: " if resp.status_code >= 500 else ""
            self.log_stt_error(resp.status_code, err_msg)
            raise ProviderExecutionError(self.provider_name, resp.status_code, f"{prefix}{err_msg}")

        try:
            result = resp.json()
            transcript = (result.get("transcript") or result.get("text") or "").strip()
            self.log_stt_success(transcript, start_time)
            return transcript
        except Exception as exc:
            self.log_stt_error(resp.status_code, f"Failed to parse response: {exc}")
            raise ProviderExecutionError(
                self.provider_name, resp.status_code, f"Invalid JSON response: {exc}"
            ) from exc


@register_tts_provider
class SarvamTTSProvider(BaseTTSProvider):
    @property
    def provider_name(self) -> str:
        return "sarvam"

    def validate_config(self, model: str | None) -> tuple[bool, str | None]:
        supported_models = {"bulbul:v2", "bulbul:v3"}
        if model and model not in supported_models:
            return False, f"Model '{model}' is not supported by Sarvam TTS. Choose from: {sorted(supported_models)}"
        return True, None

    async def synthesize(self, request: TTSRequest) -> bytes:
        if not request.api_key:
            self.log_tts_error(None, "Missing API key")
            raise ProviderConfigurationError(self.provider_name, "API key is required.")

        model = request.model or "bulbul:v3"
        if model == "bulbul:v2":
            model = "bulbul:v3"
        voice = request.voice or "anushka"
        base_url = (request.base_url or "https://api.sarvam.ai").rstrip("/")
        url = f"{base_url}/text-to-speech"

        start_time = self.log_tts_start(model, voice, request.text)

        headers = {
            "api-subscription-key": request.api_key,
            "Content-Type": "application/json",
        }
        payload = {
            "inputs": [request.text],
            "target_language_code": request.language or "hi-IN",
            "speaker": voice,
            "model": model,
        }
        if request.speed and request.speed != 1.0:
            payload["pace"] = request.speed

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

        try:
            result = resp.json()
            audios = result.get("audios", [])
            if not audios or not audios[0]:
                raise ValueError("No audio returned in response payload")
            audio_bytes = base64.b64decode(audios[0])
            self.log_tts_success(audio_bytes, start_time)
            return audio_bytes
        except Exception as exc:
            self.log_tts_error(resp.status_code, f"Failed to decode audio: {exc}")
            raise ProviderExecutionError(
                self.provider_name, resp.status_code, f"Invalid audio response: {exc}"
            ) from exc
