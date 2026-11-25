"""Fetch the models a provider offers from the provider's own API.

Each fetcher returns plain data and never touches the database. The filters
matter as much as the fetch: a raw list also holds embedding, image and dated
snapshot models that must not reach the picker. Filters are pure so they can
be tested without a network.

Azure and Bedrock aren't here because their models depend on the customer's
own deployments. Providers without a list API keep the list in ``registry``.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

import httpx

from api.services.configuration.language_sync.fetchers import (
    DeepgramSTTFetcher,
    FetchError,
    _first_key,
    _get_json,
)

MAX_MODEL_ID_LENGTH = 256
GOOGLE_MAX_PAGES = 5
CARTESIA_API_VERSION = "2026-08-14"

# Snapshot suffixes: "-2024-08-06", "-0125". The undated alias stays listed.
_DATED_SUFFIX = re.compile(r"-(\d{4}-\d{2}-\d{2}|\d{4})$")
_OPENAI_CHAT_PREFIX = re.compile(r"^(gpt-|chatgpt-|o\d)")
_OPENAI_CHAT_EXCLUDED = (
    "audio", "realtime", "transcribe", "tts", "image", "search", "embedding",
    "instruct", "moderation", "codex", "deep-research", "diarize",
)
_GROQ_EXCLUDED = ("whisper", "orpheus", "guard", "tts")
_GOOGLE_CHAT_EXCLUDED = (
    "tts", "image", "embedding", "native-audio", "live", "robotics", "computer-use",
    "banana", "transcribe", "customtools",
)
_GOOGLE_LIVE_EXCLUDED = ("robotics", "translate", "transcribe")


@dataclass(frozen=True)
class ModelListing:
    model_id: str
    display_name: str | None = None


FetchModels = Callable[[dict[str, Any], httpx.AsyncClient], Awaitable[list[ModelListing]]]


@dataclass(frozen=True)
class ModelFetcher:
    provider: str
    capability: str
    fetch: FetchModels
    # Realtime providers share their parent provider's key.
    credential_provider: str | None = None
    requires_key: bool = True

    @property
    def id(self) -> str:
        return f"{self.provider}:{self.capability}"


def _has_any(model_id: str, words: tuple[str, ...]) -> bool:
    return any(word in model_id for word in words)


def is_dated_snapshot(model_id: str) -> bool:
    return bool(_DATED_SUFFIX.search(model_id))


def is_openai_chat_model(model_id: str) -> bool:
    return (
        bool(_OPENAI_CHAT_PREFIX.match(model_id))
        and not _has_any(model_id, _OPENAI_CHAT_EXCLUDED)
        and not is_dated_snapshot(model_id)
    )


def is_openai_stt_model(model_id: str) -> bool:
    is_speech_to_text = "transcribe" in model_id or model_id.startswith("whisper")
    return is_speech_to_text and "diarize" not in model_id and not is_dated_snapshot(model_id)


def is_openai_tts_model(model_id: str) -> bool:
    return "tts" in model_id and not is_dated_snapshot(model_id)


def is_openai_realtime_model(model_id: str) -> bool:
    return "realtime" in model_id and not is_dated_snapshot(model_id)


def is_groq_chat_model(entry: dict[str, Any]) -> bool:
    return entry.get("active", True) is not False and not _has_any(
        str(entry.get("id", "")), _GROQ_EXCLUDED
    )


def is_google_chat_model(entry: dict[str, Any]) -> bool:
    model_id = to_google_model_id(entry)
    return (
        model_id.startswith("gemini-")
        and "generateContent" in (entry.get("supportedGenerationMethods") or [])
        and not _has_any(model_id, _GOOGLE_CHAT_EXCLUDED)
    )


def is_google_live_model(entry: dict[str, Any]) -> bool:
    return "bidiGenerateContent" in (
        entry.get("supportedGenerationMethods") or []
    ) and not _has_any(to_google_model_id(entry), _GOOGLE_LIVE_EXCLUDED)


def to_google_model_id(entry: dict[str, Any]) -> str:
    return str(entry.get("name", "")).removeprefix("models/")


def to_listings(pairs) -> list[ModelListing]:
    """Drop blanks, oversized ids and repeats, and keep a stable order."""
    listings: dict[str, ModelListing] = {}
    for model_id, name in pairs:
        if not isinstance(model_id, str):
            continue
        model_id = model_id.strip()
        if model_id and len(model_id) <= MAX_MODEL_ID_LENGTH:
            display_name = name.strip() if isinstance(name, str) and name.strip() else None
            listings.setdefault(model_id, ModelListing(model_id, display_name))
    return [listings[key] for key in sorted(listings)]


def _require_key(creds: dict[str, Any], provider: str) -> str:
    api_key = _first_key(creds.get("api_key"))
    if not api_key:
        raise FetchError(f"{provider} needs an API key")
    return api_key


def _entries(data: Any, key: str = "data") -> list[dict[str, Any]]:
    values = data.get(key) if isinstance(data, dict) else None
    return [entry for entry in values or [] if isinstance(entry, dict)]


def _openai_fetcher(keep: Callable[[str], bool]) -> FetchModels:
    async def fetch(creds, client):
        api_key = _require_key(creds, "OpenAI")
        data = await _get_json(
            client, "https://api.openai.com/v1/models", headers={"Authorization": f"Bearer {api_key}"}
        )
        return to_listings(
            (entry.get("id"), None) for entry in _entries(data) if keep(str(entry.get("id", "")))
        )

    return fetch


async def _fetch_groq(creds, client):
    api_key = _require_key(creds, "Groq")
    data = await _get_json(
        client, "https://api.groq.com/openai/v1/models", headers={"Authorization": f"Bearer {api_key}"}
    )
    return to_listings((e.get("id"), None) for e in _entries(data) if is_groq_chat_model(e))


async def _fetch_openrouter(creds, client):
    data = await _get_json(client, "https://openrouter.ai/api/v1/models")
    listings = []
    for entry in _entries(data):
        outputs = (entry.get("architecture") or {}).get("output_modalities")
        if not outputs or "text" in outputs:
            listings.append((entry.get("id"), entry.get("name")))
    return to_listings(listings)


async def _list_google_models(creds, client) -> list[dict[str, Any]]:
    api_key = _require_key(creds, "Google")
    entries: list[dict[str, Any]] = []
    params: dict[str, Any] = {"pageSize": 1000}
    for _ in range(GOOGLE_MAX_PAGES):
        data = await _get_json(
            client,
            "https://generativelanguage.googleapis.com/v1beta/models",
            headers={"x-goog-api-key": api_key},
            params=params,
        )
        entries.extend(_entries(data, "models"))
        token = data.get("nextPageToken") if isinstance(data, dict) else None
        if not token:
            break
        params = {**params, "pageToken": token}
    return entries


def _google_fetcher(keep: Callable[[dict[str, Any]], bool]) -> FetchModels:
    async def fetch(creds, client):
        return to_listings(
            (to_google_model_id(e), e.get("displayName"))
            for e in await _list_google_models(creds, client)
            if keep(e)
        )

    return fetch


async def _fetch_sarvam(creds, client):
    api_key = _require_key(creds, "Sarvam")
    data = await _get_json(
        client, "https://api.sarvam.ai/v1/models", headers={"api-subscription-key": api_key}
    )
    return to_listings((e.get("id"), None) for e in _entries(data))


def _soniox_fetcher(capability: str) -> FetchModels:
    url = "https://api.soniox.com/v1/tts-models" if capability == "tts" else "https://api.soniox.com/v1/models"

    async def fetch(creds, client):
        api_key = _require_key(creds, "Soniox")
        data = await _get_json(client, url, headers={"Authorization": f"Bearer {api_key}"})
        entries = _entries(data, "models")
        if capability == "stt":
            entries = [e for e in entries if str(e.get("id", "")).startswith("stt-rt")]
        return to_listings((e.get("id"), e.get("name")) for e in entries)

    return fetch


async def _fetch_deepgram_stt(creds, client):
    api_key = _require_key(creds, "Deepgram")
    data = await _get_json(
        client, "https://api.deepgram.com/v1/models", headers={"Authorization": f"Token {api_key}"}
    )
    naming = DeepgramSTTFetcher()
    return to_listings(
        (naming._our_model_id(entry), None)
        for entry in _entries(data, "stt")
        if entry.get("streaming") is not False
    )


async def _fetch_elevenlabs(creds, client):
    api_key = _require_key(creds, "ElevenLabs")
    data = await _get_json(client, "https://api.elevenlabs.io/v1/models", headers={"xi-api-key": api_key})
    entries = [e for e in data if isinstance(e, dict)] if isinstance(data, list) else []
    return to_listings(
        (e.get("model_id"), e.get("name")) for e in entries if e.get("can_do_text_to_speech", True)
    )


def _cartesia_fetcher(capability: str) -> FetchModels:
    async def fetch(creds, client):
        api_key = _require_key(creds, "Cartesia")
        data = await _get_json(
            client,
            "https://api.cartesia.ai/models",
            headers={"Authorization": f"Bearer {api_key}", "Cartesia-Version": CARTESIA_API_VERSION},
            params={"capability": capability},
        )
        entries = _entries(data)
        if capability == "stt":
            entries = [e for e in entries if "stream" in (e.get("modes") or ["stream"])]
        return to_listings((e.get("id"), None) for e in entries)

    return fetch


FETCHERS: tuple[ModelFetcher, ...] = (
    ModelFetcher("openai", "llm", _openai_fetcher(is_openai_chat_model)),
    ModelFetcher("openai", "stt", _openai_fetcher(is_openai_stt_model)),
    ModelFetcher("openai", "tts", _openai_fetcher(is_openai_tts_model)),
    ModelFetcher(
        "openai_realtime", "realtime", _openai_fetcher(is_openai_realtime_model), credential_provider="openai"
    ),
    ModelFetcher("groq", "llm", _fetch_groq),
    ModelFetcher("openrouter", "llm", _fetch_openrouter, requires_key=False),
    ModelFetcher("google", "llm", _google_fetcher(is_google_chat_model)),
    ModelFetcher(
        "google_realtime", "realtime", _google_fetcher(is_google_live_model), credential_provider="google"
    ),
    ModelFetcher("sarvam", "llm", _fetch_sarvam),
    ModelFetcher("soniox", "stt", _soniox_fetcher("stt")),
    ModelFetcher("soniox", "tts", _soniox_fetcher("tts")),
    ModelFetcher("deepgram", "stt", _fetch_deepgram_stt),
    ModelFetcher("elevenlabs", "tts", _fetch_elevenlabs),
    ModelFetcher("cartesia", "tts", _cartesia_fetcher("tts")),
    ModelFetcher("cartesia", "stt", _cartesia_fetcher("stt")),
)
