"""Google Cloud audio provider for STT (Speech-to-Text V1/V2) and TTS (Text-to-Speech).

Documentation:
- STT: https://cloud.google.com/speech-to-text/docs/reference/rest/v1/speech/recognize
- TTS: https://cloud.google.com/text-to-speech/docs/reference/rest/v1/text/synthesize
"""
from __future__ import annotations

import base64
import json
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


def _get_google_auth(api_key: str | None, credentials_json: str | None) -> tuple[dict[str, str], dict[str, str]]:
    """Determine headers and query params for Google Cloud REST API.

    Supports:
    1. Direct API Key via `key` query parameter or Authorization Bearer.
    2. Service Account JSON credentials via Google OAuth2 token.
    3. Application Default Credentials (ADC) fallback.
    """
    headers: dict[str, str] = {}
    params: dict[str, str] = {}

    if api_key:
        # Standard API Key query param
        params["key"] = api_key
        return headers, params

    if credentials_json:
        try:
            import google.auth
            from google.oauth2 import service_account
            import google.auth.transport.requests

            creds_data = json.loads(credentials_json) if isinstance(credentials_json, str) else credentials_json
            creds = service_account.Credentials.from_service_account_info(
                creds_data,
                scopes=["https://www.googleapis.com/auth/cloud-platform"],
            )
            req = google.auth.transport.requests.Request()
            creds.refresh(req)
            headers["Authorization"] = f"Bearer {creds.token}"
            return headers, params
        except Exception:
            pass

    # Try Application Default Credentials (ADC)
    try:
        import google.auth
        import google.auth.transport.requests

        creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
        req = google.auth.transport.requests.Request()
        creds.refresh(req)
        headers["Authorization"] = f"Bearer {creds.token}"
        return headers, params
    except Exception:
        pass

    return headers, params


@register_stt_provider
class GoogleSTTProvider(BaseSTTProvider):
    @property
    def provider_name(self) -> str:
        return "google"

    def validate_config(self, model: str | None) -> tuple[bool, str | None]:
        supported_models = {"latest_long", "latest_short", "chirp_3", "default"}
        if model and model not in supported_models:
            return False, f"Model '{model}' is not supported by Google STT. Choose from: {sorted(supported_models)}"
        return True, None

    async def transcribe(self, request: STTRequest) -> str:
        headers, params = _get_google_auth(request.api_key, request.credentials)
        if not headers.get("Authorization") and not params.get("key"):
            self.log_stt_error(None, "Missing API key or service account credentials")
            raise ProviderConfigurationError(
                self.provider_name, "Either Google API key or service account credentials JSON is required."
            )

        model = request.model or "latest_short"
        base_url = (request.base_url or "https://speech.googleapis.com").rstrip("/")
        url = f"{base_url}/v1/speech:recognize"

        start_time = self.log_stt_start(model, "rest", len(request.audio_bytes))

        # Check audio encoding
        encoding = "OGG_OPUS" if ("opus" in request.content_type or "ogg" in request.content_type) else "LINEAR16"
        payload = {
            "config": {
                "encoding": encoding,
                "model": model if model != "default" else "latest_short",
                "languageCode": request.language or "en-US",
                "enableAutomaticPunctuation": True,
            },
            "audio": {
                "content": base64.b64encode(request.audio_bytes).decode("ascii"),
            },
        }

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(url, headers=headers, params=params, json=payload)
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
            r = resp.json()
            results = r.get("results", [])
            if not results:
                # Silent audio returns empty transcript string
                self.log_stt_success("", start_time)
                return ""
            transcripts = [
                alt.get("transcript", "")
                for res in results
                for alt in res.get("alternatives", [{}])
            ]
            transcript = " ".join(transcripts).strip()
            self.log_stt_success(transcript, start_time)
            return transcript
        except Exception as exc:
            self.log_stt_error(resp.status_code, f"Failed to parse response: {exc}")
            raise ProviderExecutionError(
                self.provider_name, resp.status_code, f"Invalid JSON response: {exc}"
            ) from exc


@register_tts_provider
class GoogleTTSProvider(BaseTTSProvider):
    @property
    def provider_name(self) -> str:
        return "google"

    def validate_config(self, model: str | None) -> tuple[bool, str | None]:
        return True, None

    async def synthesize(self, request: TTSRequest) -> bytes:
        headers, params = _get_google_auth(request.api_key, request.credentials)
        if not headers.get("Authorization") and not params.get("key"):
            self.log_tts_error(None, "Missing API key or service account credentials")
            raise ProviderConfigurationError(
                self.provider_name, "Either Google API key or service account credentials JSON is required."
            )

        voice_name = request.voice or "en-US-Journey-F"
        lang_code = request.language or "en-US"
        base_url = (request.base_url or "https://texttospeech.googleapis.com").rstrip("/")
        url = f"{base_url}/v1/text:synthesize"

        start_time = self.log_tts_start(request.model or "chirp_3_hd", voice_name, request.text)

        payload = {
            "input": {"text": request.text},
            "voice": {
                "languageCode": lang_code,
                "name": voice_name,
            },
            "audioConfig": {
                "audioEncoding": "OGG_OPUS",
                "speakingRate": request.speed or 1.0,
            },
        }

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(url, headers=headers, params=params, json=payload)
        except Exception as exc:
            self.log_tts_error(None, str(exc))
            raise ProviderExecutionError(self.provider_name, None, f"Network error: {exc}") from exc

        if resp.status_code < 200 or resp.status_code >= 300:
            err_msg = (resp.text or "")[:200]
            self.log_tts_error(resp.status_code, err_msg)
            raise ProviderExecutionError(self.provider_name, resp.status_code, err_msg)

        try:
            r = resp.json()
            audio_content = r.get("audioContent", "")
            if not audio_content:
                raise ValueError("audioContent was empty in response")
            audio_bytes = base64.b64decode(audio_content)
            self.log_tts_success(audio_bytes, start_time)
            return audio_bytes
        except Exception as exc:
            self.log_tts_error(resp.status_code, f"Failed to parse/decode audioContent: {exc}")
            raise ProviderExecutionError(
                self.provider_name, resp.status_code, f"Invalid audio response: {exc}"
            ) from exc
