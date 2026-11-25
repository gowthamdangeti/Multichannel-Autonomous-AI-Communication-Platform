"""Fetch prices from OpenRouter's API and LiteLLM's public price file.

Both take an ``httpx.AsyncClient`` so tests can replay recorded responses, and
both return plain ``PriceEntry`` lists: ``sync`` decides what to store.

The LiteLLM file is maintained by hand and can lag a provider, so it ranks
below the official prices. Values are parsed, never trusted: anything that
isn't a finite, non-negative number is skipped.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any

import httpx

from api.services.configuration.pricing.entries import (
    PER_MILLION,
    PER_MINUTE,
    PriceComponent,
    PriceEntry,
    PriceSource,
)

OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"
LITELLM_PRICES_URL = (
    "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json"
)
HTTP_TIMEOUT = httpx.Timeout(30.0, connect=10.0)
MAX_MODEL_ID_LENGTH = 256
RATE_PLACES = Decimal("0.0000000001")

_C = PriceComponent


class PriceFetchError(Exception):
    """The source could not be reached or returned something unusable."""


@dataclass(frozen=True)
class FeedMapping:
    provider: str
    capability: str
    feed_provider: str
    modes: frozenset[str]
    prefix: str = ""


_CHAT = frozenset({"chat", "responses"})
_STT = frozenset({"audio_transcription"})
_TTS = frozenset({"audio_speech"})
_REALTIME = frozenset({"realtime"})

FEED_MAPPINGS: tuple[FeedMapping, ...] = (
    FeedMapping("openai", "llm", "openai", _CHAT),
    FeedMapping("google", "llm", "gemini", _CHAT, "gemini/"),
    FeedMapping("google_vertex", "llm", "vertex_ai-language-models", _CHAT),
    FeedMapping("azure", "llm", "azure", _CHAT, "azure/"),
    FeedMapping("aws_bedrock", "llm", "bedrock_converse", _CHAT),
    FeedMapping("aws_bedrock", "llm", "bedrock", _CHAT),
    FeedMapping("groq", "llm", "groq", _CHAT, "groq/"),
    FeedMapping("minimax", "llm", "minimax", _CHAT, "minimax/"),
    FeedMapping("openai", "stt", "openai", _STT),
    FeedMapping("openai", "tts", "openai", _TTS),
    FeedMapping("deepgram", "stt", "deepgram", _STT, "deepgram/"),
    FeedMapping("elevenlabs", "tts", "elevenlabs", _TTS, "elevenlabs/"),
    FeedMapping("openai_realtime", "realtime", "openai", _REALTIME),
    FeedMapping("azure_realtime", "realtime", "azure", _REALTIME, "azure/"),
    FeedMapping("google_realtime", "realtime", "gemini", _CHAT | _REALTIME, "gemini/"),
)

# Our option name -> the feed's entry, where the two don't share a name.
FEED_ALIASES: tuple[tuple[str, str, str, str], ...] = (
    ("azure_speech", "tts", "neural", "azure/speech/azure-tts"),
    ("azure_speech", "stt", "latest_long", "azure/speech/azure-stt"),
    ("azure_speech", "stt", "latest_short", "azure/speech/azure-stt"),
)

# Feed field -> (component, unit the stored rate is priced in)
_FEED_FIELDS: dict[str, tuple[PriceComponent, int]] = {
    "input_cost_per_token": (_C.INPUT_TOKEN, PER_MILLION),
    "output_cost_per_token": (_C.OUTPUT_TOKEN, PER_MILLION),
    "cache_read_input_token_cost": (_C.CACHED_INPUT_TOKEN, PER_MILLION),
    "cache_creation_input_token_cost": (_C.CACHE_WRITE_TOKEN, PER_MILLION),
    "input_cost_per_audio_token": (_C.INPUT_AUDIO_TOKEN, PER_MILLION),
    "output_cost_per_audio_token": (_C.OUTPUT_AUDIO_TOKEN, PER_MILLION),
    "input_cost_per_character": (_C.CHARACTER, PER_MILLION),
    "input_cost_per_second": (_C.AUDIO_SECOND, PER_MINUTE),
    "output_cost_per_second": (_C.OUTPUT_AUDIO_SECOND, PER_MINUTE),
}


def _to_rate(value: Any, multiplier: int) -> Decimal | None:
    """Per-unit feed value -> rate per ``multiplier`` units, or None if unusable."""
    if isinstance(value, bool):
        return None
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    if not number.is_finite() or number < 0:
        return None
    return (number * multiplier).quantize(RATE_PLACES)


def _feed_entries_for(
    *, values: dict[str, Any], provider: str, capability: str, model_id: str
) -> list[PriceEntry]:
    source_url = values.get("source") if isinstance(values.get("source"), str) else None
    entries: list[PriceEntry] = []
    for field, (component, unit) in _FEED_FIELDS.items():
        # A transcription's "output" field repeats its audio price.
        if capability == "stt" and component is _C.OUTPUT_AUDIO_SECOND:
            continue
        rate = _to_rate(values.get(field), unit)
        if rate is None or rate == 0:
            continue
        entries.append(
            PriceEntry(
                provider=provider,
                capability=capability,
                model_id=model_id,
                component=component,
                rate=rate,
                unit_quantity=unit,
                source=PriceSource.FEED,
                source_url=source_url[:512] if source_url else LITELLM_PRICES_URL,
            )
        )
    return entries


def parse_litellm_prices(data: Any) -> list[PriceEntry]:
    if not isinstance(data, dict):
        raise PriceFetchError("LiteLLM price file is not an object")
    entries: dict[tuple[str, str, str, str], PriceEntry] = {}
    for name, values in data.items():
        if not isinstance(values, dict):
            continue
        for mapping in FEED_MAPPINGS:
            if values.get("litellm_provider") != mapping.feed_provider:
                continue
            if values.get("mode") not in mapping.modes:
                continue
            model_id = name.removeprefix(mapping.prefix)
            if not model_id or len(model_id) > MAX_MODEL_ID_LENGTH:
                continue
            for entry in _feed_entries_for(
                values=values,
                provider=mapping.provider,
                capability=mapping.capability,
                model_id=model_id,
            ):
                entries.setdefault(entry.key, entry)
    for provider, capability, model_id, feed_name in FEED_ALIASES:
        values = data.get(feed_name)
        if isinstance(values, dict):
            for entry in _feed_entries_for(
                values=values, provider=provider, capability=capability, model_id=model_id
            ):
                entries.setdefault(entry.key, entry)
    return list(entries.values())


def parse_openrouter_prices(data: Any) -> list[PriceEntry]:
    models = data.get("data") if isinstance(data, dict) else None
    if not isinstance(models, list):
        raise PriceFetchError("OpenRouter returned no model list")
    fields = (
        ("prompt", _C.INPUT_TOKEN),
        ("completion", _C.OUTPUT_TOKEN),
        ("input_cache_read", _C.CACHED_INPUT_TOKEN),
        ("input_cache_write", _C.CACHE_WRITE_TOKEN),
    )
    entries: list[PriceEntry] = []
    for model in models:
        if not isinstance(model, dict):
            continue
        model_id = model.get("id")
        pricing = model.get("pricing")
        if not isinstance(model_id, str) or not isinstance(pricing, dict):
            continue
        if not model_id or len(model_id) > MAX_MODEL_ID_LENGTH:
            continue
        for field, component in fields:
            rate = _to_rate(pricing.get(field), PER_MILLION)
            if rate is None:
                continue
            entries.append(
                PriceEntry(
                    provider="openrouter",
                    capability="llm",
                    model_id=model_id,
                    component=component,
                    rate=rate,
                    unit_quantity=PER_MILLION,
                    source=PriceSource.PROVIDER_API,
                    source_url=OPENROUTER_MODELS_URL,
                )
            )
    return entries


async def _get_json(client: httpx.AsyncClient, url: str) -> Any:
    try:
        response = await client.get(url)
    except httpx.HTTPError as exc:
        raise PriceFetchError(f"{url}: {type(exc).__name__}") from exc
    if response.status_code != 200:
        raise PriceFetchError(f"{url}: HTTP {response.status_code}")
    try:
        return response.json()
    except ValueError as exc:
        raise PriceFetchError(f"{url}: response is not JSON") from exc


async def fetch_openrouter_prices(client: httpx.AsyncClient) -> list[PriceEntry]:
    return parse_openrouter_prices(await _get_json(client, OPENROUTER_MODELS_URL))


async def fetch_litellm_prices(client: httpx.AsyncClient) -> list[PriceEntry]:
    return parse_litellm_prices(await _get_json(client, LITELLM_PRICES_URL))
