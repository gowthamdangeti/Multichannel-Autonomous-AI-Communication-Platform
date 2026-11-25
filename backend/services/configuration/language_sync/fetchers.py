"""Fetch the languages a provider supports from the provider's own API.

Each fetcher returns plain data (model -> language codes) and never touches
the database; ``sync`` decides what to store. Fetchers take an
``httpx.AsyncClient`` so tests can replay recorded responses.

Only providers with a documented listing endpoint are here. Everything else
keeps the static list in ``options/`` and ``registry``.
"""

from __future__ import annotations

import asyncio
import json
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from typing import Any

import httpx

from api.services.configuration.locales import base_codes, canonical_code

ALL_MODELS = ""  # row key when one list applies to every model


class FetchError(Exception):
    """The provider could not be reached or returned something unusable."""


@dataclass
class FetchResult:
    # model -> language codes ("" = all models)
    models: dict[str, list[str]]
    # model -> code -> number of voices for that language (TTS only)
    voice_counts: dict[str, dict[str, int]] = field(default_factory=dict)


class LanguageFetcher:
    provider: str
    capability: str
    # Providers whose runtime only takes a plain language ("en", not "en-US").
    base_only: bool = False
    # Credential fields the fetcher needs; one of them must be present.
    needs: tuple[str, ...] = ("api_key",)
    # False when the listing endpoint is public.
    requires_key: bool = True
    docs_url: str = ""

    @property
    def id(self) -> str:
        return f"{self.provider}:{self.capability}"

    async def fetch(self, creds: dict[str, Any], client: httpx.AsyncClient) -> FetchResult:
        raise NotImplementedError

    def normalize(self, codes) -> list[str]:
        cleaned = [c for c in (str(c).strip() for c in codes) if c]
        if self.base_only:
            return sorted(base_codes(cleaned))
        return sorted(dict.fromkeys(canonical_code(c) for c in cleaned))


async def _get_json(client: httpx.AsyncClient, url: str, **kwargs) -> Any:
    """GET with two retries on network errors and 5xx/429; raise FetchError otherwise."""
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            response = await client.get(url, **kwargs)
        except httpx.HTTPError as exc:
            last_error = exc
        else:
            if response.status_code < 400:
                try:
                    return response.json()
                except ValueError as exc:
                    raise FetchError(f"{url}: response is not JSON") from exc
            if response.status_code in (401, 403):
                raise FetchError(f"{url}: credentials rejected ({response.status_code})")
            if response.status_code not in (429, 500, 502, 503, 504):
                raise FetchError(f"{url}: HTTP {response.status_code}")
            last_error = FetchError(f"{url}: HTTP {response.status_code}")
        if attempt < 2:
            await asyncio.sleep(0.5 * (attempt + 1))
    raise FetchError(f"{url}: {last_error}")


def _first_key(value: Any) -> str | None:
    if isinstance(value, list):
        value = next((v for v in value if v), None)
    return value.strip() if isinstance(value, str) and value.strip() else None


def _counts(pairs) -> dict[str, dict[str, int]]:
    by_model: dict[str, Counter] = defaultdict(Counter)
    for model, code in pairs:
        by_model[model][code] += 1
    return {model: dict(counter) for model, counter in by_model.items()}


# ---------------------------------------------------------------------------
# Google Cloud Text-to-Speech
# ---------------------------------------------------------------------------

# Voice name -> our model id, e.g. "en-US-Chirp3-HD-Charon" -> "chirp_3_hd".
_GOOGLE_VOICE_TIERS = (
    ("Chirp3-HD", "chirp_3_hd"),
    ("Journey", "journey"),
    ("Neural2", "neural2"),
    ("Wavenet", "wavenet"),
    ("Standard", "standard"),
)


def _google_access_token(credentials_json: str) -> str:
    from google.auth.transport.requests import Request
    from google.oauth2 import service_account

    info = json.loads(credentials_json)
    creds = service_account.Credentials.from_service_account_info(
        info, scopes=["https://www.googleapis.com/auth/cloud-platform"]
    )
    creds.refresh(Request())
    return creds.token


class GoogleTTSFetcher(LanguageFetcher):
    provider = "google"
    capability = "tts"
    needs = ("credentials", "api_key")
    docs_url = "https://cloud.google.com/text-to-speech/docs/reference/rest/v1/voices/list"
    url = "https://texttospeech.googleapis.com/v1/voices"

    async def fetch(self, creds, client):
        api_key = _first_key(creds.get("api_key"))
        if api_key:
            data = await _get_json(client, self.url, params={"key": api_key})
        elif creds.get("credentials"):
            try:
                token = await asyncio.to_thread(_google_access_token, creds["credentials"])
            except Exception as exc:  # bad JSON, revoked key, no network
                raise FetchError(f"Google credentials could not be used: {exc}") from exc
            data = await _get_json(
                client, self.url, headers={"Authorization": f"Bearer {token}"}
            )
        else:
            raise FetchError("Google needs service-account credentials or an API key")

        pairs = []
        for voice in data.get("voices") or []:
            name = voice.get("name") or ""
            model = next((m for tag, m in _GOOGLE_VOICE_TIERS if f"-{tag}-" in name), None)
            if not model:
                continue  # Studio, Polyglot, News... aren't models we offer
            for code in voice.get("languageCodes") or []:
                pairs.append((model, canonical_code(code)))
        if not pairs:
            raise FetchError("Google returned no voices for the supported models")
        models: dict[str, set[str]] = defaultdict(set)
        for model, code in pairs:
            models[model].add(code)
        return FetchResult(
            models={m: self.normalize(c) for m, c in models.items()},
            voice_counts=_counts(pairs),
        )


# ---------------------------------------------------------------------------
# Azure Speech
# ---------------------------------------------------------------------------


class AzureSpeechTTSFetcher(LanguageFetcher):
    provider = "azure_speech"
    capability = "tts"
    docs_url = "https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech#get-a-list-of-voices"

    async def fetch(self, creds, client):
        api_key = _first_key(creds.get("api_key"))
        region = (creds.get("region") or "").strip()
        if not api_key or not region:
            raise FetchError("Azure Speech needs an API key and a region")
        if not re.fullmatch(r"[a-z0-9]+", region):
            raise FetchError(f"Invalid Azure region {region!r}")
        data = await _get_json(
            client,
            f"https://{region}.tts.speech.microsoft.com/cognitiveservices/voices/list",
            headers={"Ocp-Apim-Subscription-Key": api_key},
        )
        if not isinstance(data, list):
            raise FetchError("Azure returned an unexpected voice list")
        pairs = [(ALL_MODELS, canonical_code(v["Locale"])) for v in data if v.get("Locale")]
        if not pairs:
            raise FetchError("Azure returned no voices")
        return FetchResult(
            models={ALL_MODELS: self.normalize(code for _, code in pairs)},
            voice_counts=_counts(pairs),
        )


# ---------------------------------------------------------------------------
# ElevenLabs
# ---------------------------------------------------------------------------


class ElevenLabsTTSFetcher(LanguageFetcher):
    provider = "elevenlabs"
    capability = "tts"
    base_only = True
    docs_url = "https://elevenlabs.io/docs/api-reference/models/list"

    async def fetch(self, creds, client):
        api_key = _first_key(creds.get("api_key"))
        if not api_key:
            raise FetchError("ElevenLabs needs an API key")
        data = await _get_json(
            client, "https://api.elevenlabs.io/v1/models", headers={"xi-api-key": api_key}
        )
        models = {}
        for model in data if isinstance(data, list) else []:
            if not model.get("can_do_text_to_speech", True) or not model.get("model_id"):
                continue
            codes = [l.get("language_id") for l in model.get("languages") or [] if l.get("language_id")]
            if codes:
                models[model["model_id"]] = self.normalize(codes)
        if not models:
            raise FetchError("ElevenLabs returned no text-to-speech models")
        return FetchResult(models=models)


# ---------------------------------------------------------------------------
# Deepgram Aura
# ---------------------------------------------------------------------------


class DeepgramTTSFetcher(LanguageFetcher):
    provider = "deepgram"
    capability = "tts"
    docs_url = "https://developers.deepgram.com/reference/manage/models/list"

    async def fetch(self, creds, client):
        api_key = _first_key(creds.get("api_key"))
        headers = {"Authorization": f"Token {api_key}"} if api_key else {}
        data = await _get_json(client, "https://api.deepgram.com/v1/models", headers=headers)
        pairs = []
        for voice in (data or {}).get("tts") or []:
            languages = [canonical_code(l) for l in voice.get("languages") or [] if l]
            # Prefer regional codes; keep a plain one only if it has no region listed.
            regional = [l for l in languages if "-" in l]
            plain = [l for l in languages if "-" not in l and not any(r.startswith(f"{l}-") for r in regional)]
            for code in dict.fromkeys(regional + plain):
                pairs.append((ALL_MODELS, code))
        if not pairs:
            raise FetchError("Deepgram returned no TTS voices")
        return FetchResult(
            models={ALL_MODELS: self.normalize(code for _, code in pairs)},
            voice_counts=_counts(pairs),
        )


# ---------------------------------------------------------------------------
# Cartesia
# ---------------------------------------------------------------------------


class CartesiaTTSFetcher(LanguageFetcher):
    provider = "cartesia"
    capability = "tts"
    base_only = True
    docs_url = "https://docs.cartesia.ai/api-reference/voices/list"
    api_version = "2026-08-14"
    max_pages = 50

    async def fetch(self, creds, client):
        api_key = _first_key(creds.get("api_key"))
        if not api_key:
            raise FetchError("Cartesia needs an API key")
        headers = {"Authorization": f"Bearer {api_key}", "Cartesia-Version": self.api_version}
        pairs, cursor = [], None
        for _ in range(self.max_pages):
            params = {"limit": 100, **({"starting_after": cursor} if cursor else {})}
            data = await _get_json(client, "https://api.cartesia.ai/voices", headers=headers, params=params)
            for voice in data.get("data") or []:
                language = voice.get("language")
                if not language:
                    locale = next((a.get("locale") for a in voice.get("accents") or [] if a.get("locale")), None)
                    language = locale
                if language:
                    pairs.append((ALL_MODELS, base_codes([language])[0]))
            cursor = data.get("next_page")
            if not data.get("has_more") or not cursor:
                break
        if not pairs:
            raise FetchError("Cartesia returned no voices")
        return FetchResult(
            models={ALL_MODELS: self.normalize(code for _, code in pairs)},
            voice_counts=_counts(pairs),
        )


# ---------------------------------------------------------------------------
# Soniox (TTS and STT use the same response shape)
# ---------------------------------------------------------------------------


class SonioxFetcher(LanguageFetcher):
    provider = "soniox"
    base_only = True

    def __init__(self, capability: str):
        self.capability = capability
        if capability == "tts":
            self.url = "https://api.soniox.com/v1/tts-models"
            self.docs_url = "https://docs.soniox.com/api-reference/tts/get_tts_models"
        else:
            self.url = "https://api.soniox.com/v1/models"
            self.docs_url = "https://docs.soniox.com/api-reference/stt/get_models"

    async def fetch(self, creds, client):
        api_key = _first_key(creds.get("api_key"))
        if not api_key:
            raise FetchError("Soniox needs an API key")
        data = await _get_json(client, self.url, headers={"Authorization": f"Bearer {api_key}"})
        models = {}
        for model in (data or {}).get("models") or []:
            codes = [l.get("code") for l in model.get("languages") or [] if l.get("code")]
            if model.get("id") and codes:
                models[model["id"]] = self.normalize(codes)
        if not models:
            raise FetchError(f"Soniox returned no {self.capability.upper()} models")
        return FetchResult(models=models)


# Kept for callers/tests that use the Phase 2 name.
def SonioxTTSFetcher() -> SonioxFetcher:  # noqa: N802
    return SonioxFetcher("tts")


# ---------------------------------------------------------------------------
# Deepgram STT
# ---------------------------------------------------------------------------


class DeepgramSTTFetcher(LanguageFetcher):
    """Languages per streaming STT model from ``GET /v1/models`` (``stt[]``).

    Deepgram lists a model by ``name``/``canonical_name`` (e.g. "nova-3"),
    while our model ids add the variant ("nova-3-general"), so entries are
    matched to the ids we offer where possible.
    """

    provider = "deepgram"
    capability = "stt"
    docs_url = "https://developers.deepgram.com/reference/manage/models/list"

    def _our_model_id(self, entry: dict) -> str | None:
        from api.services.configuration.options import DEEPGRAM_STT_MODELS

        known = set(DEEPGRAM_STT_MODELS)
        name = entry.get("name") or ""
        canonical = entry.get("canonical_name") or name
        architecture = entry.get("architecture") or ""
        candidates = [canonical, name, f"{name}-general"]
        if architecture and architecture != "base":
            candidates.append(f"{name}-{architecture}")
        return next((c for c in candidates if c in known), canonical or None)

    async def fetch(self, creds, client):
        api_key = _first_key(creds.get("api_key"))
        headers = {"Authorization": f"Token {api_key}"} if api_key else {}
        data = await _get_json(client, "https://api.deepgram.com/v1/models", headers=headers)
        models: dict[str, set[str]] = defaultdict(set)
        for entry in (data or {}).get("stt") or []:
            if entry.get("streaming") is False:
                continue  # batch-only models can't be used for calls
            model = self._our_model_id(entry)
            if model:
                models[model].update(l for l in entry.get("languages") or [] if l)
        models = {m: codes for m, codes in models.items() if codes}
        if not models:
            raise FetchError("Deepgram returned no streaming STT models")
        return FetchResult(models={m: self.normalize(c) for m, c in models.items()})


# ---------------------------------------------------------------------------
# Speechmatics
# ---------------------------------------------------------------------------


class SpeechmaticsSTTFetcher(LanguageFetcher):
    """Language packs from the public discovery endpoint (no key needed).

    The endpoint lists language packs under ``batch``; real-time uses the same
    packs (our built-in list was taken from this response and matches it).
    Mixed-language packs such as ``ar_en`` or ``cmn_en`` are kept as they are.
    """

    provider = "speechmatics"
    capability = "stt"
    requires_key = False
    docs_url = "https://docs.speechmatics.com/speech-to-text/features/feature-discovery"
    url = "https://eu1.asr.api.speechmatics.com/v1/discovery/features"

    async def fetch(self, creds, client):
        data = await _get_json(client, self.url)
        transcription = ((data or {}).get("batch") or {}).get("transcription") or []
        latest = next((t for t in transcription if t.get("version") == "latest"), None)
        latest = latest or (transcription[0] if transcription else {})
        codes = [c for c in latest.get("languages") or [] if c]
        if not codes:
            raise FetchError("Speechmatics returned no language packs")
        return FetchResult(models={ALL_MODELS: self.normalize(codes)})


# Keyed by "provider:capability", e.g. "soniox:stt".
FETCHERS: dict[str, LanguageFetcher] = {
    f.id: f
    for f in (
        # Text-to-speech
        GoogleTTSFetcher(),
        AzureSpeechTTSFetcher(),
        ElevenLabsTTSFetcher(),
        DeepgramTTSFetcher(),
        CartesiaTTSFetcher(),
        SonioxFetcher("tts"),
        # Speech-to-text (Azure STT has no real-time listing API: built-in list)
        SonioxFetcher("stt"),
        DeepgramSTTFetcher(),
        SpeechmaticsSTTFetcher(),
    )
}


def get_fetcher(fetcher_id: str) -> LanguageFetcher | None:
    """Look up by "provider:capability"; a bare provider means its TTS fetcher."""
    if ":" not in fetcher_id:
        fetcher_id = f"{fetcher_id}:tts"
    return FETCHERS.get(fetcher_id)
