from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from api.services.configuration.language_sync.fetchers import FetchError
from api.services.configuration.model_sync import fetchers, sync
from api.services.configuration.model_sync import catalog
from api.services.configuration.model_sync.catalog import merge_models
from api.services.configuration.model_sync.fetchers import (
    ModelFetcher,
    ModelListing,
    is_google_chat_model,
    is_google_live_model,
    is_groq_chat_model,
    is_openai_chat_model,
    is_openai_realtime_model,
    is_openai_stt_model,
    is_openai_tts_model,
    to_listings,
)
from api.services.configuration.model_sync.store import LiveModel


@pytest.mark.parametrize("model", ["gpt-4.1", "gpt-4o", "o3", "chatgpt-4o-latest"])
def test_openai_chat_keeps_chat_models(model):
    assert is_openai_chat_model(model)


@pytest.mark.parametrize(
    "model",
    [
        "text-embedding-3-small",
        "gpt-4o-realtime-preview",
        "gpt-4o-transcribe",
        "gpt-4o-mini-tts",
        "gpt-image-1",
        "gpt-4o-audio-preview",
        "gpt-4o-2024-08-06",
        "gpt-3.5-turbo-0125",
        "whisper-1",
    ],
)
def test_openai_chat_drops_everything_else(model):
    assert not is_openai_chat_model(model)


def test_openai_speech_filters():
    assert is_openai_stt_model("gpt-4o-transcribe") and is_openai_stt_model("whisper-1")
    assert not is_openai_stt_model("gpt-4o-transcribe-diarize")
    assert is_openai_tts_model("tts-1") and not is_openai_tts_model("gpt-4o")
    assert is_openai_realtime_model("gpt-realtime")
    assert not is_openai_realtime_model("gpt-4o-realtime-preview-2024-12-17")


def test_groq_drops_speech_guard_and_inactive_models():
    assert is_groq_chat_model({"id": "openai/gpt-oss-20b"})
    assert not is_groq_chat_model({"id": "whisper-large-v3"})
    assert not is_groq_chat_model({"id": "meta-llama/llama-prompt-guard-2-22m"})
    assert not is_groq_chat_model({"id": "old-model", "active": False})


def test_google_filters_by_what_the_model_supports():
    chat = {"name": "models/gemini-2.5-flash", "supportedGenerationMethods": ["generateContent"]}
    tts = {"name": "models/gemini-2.5-flash-tts", "supportedGenerationMethods": ["generateContent"]}
    live = {"name": "models/gemini-live", "supportedGenerationMethods": ["bidiGenerateContent"]}
    assert is_google_chat_model(chat)
    assert not is_google_chat_model(tts)
    assert is_google_live_model(live) and not is_google_live_model(chat)


def test_to_listings_cleans_and_sorts():
    listings = to_listings([("b", " B "), ("a", ""), ("b", "dup"), ("", "x"), (None, "y"), ("z" * 300, "z")])
    assert listings == [ModelListing("a"), ModelListing("b", "B")]


@pytest.mark.asyncio
async def test_soniox_stt_keeps_only_real_time_models():
    def respond(request):
        return httpx.Response(200, json={"models": [{"id": "stt-rt-v5", "name": "RT"}, {"id": "stt-async-v5"}]})

    fetch = fetchers._soniox_fetcher("stt")
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        assert await fetch({"api_key": "key"}, client) == [ModelListing("stt-rt-v5", "RT")]


@pytest.mark.asyncio
async def test_cartesia_stt_needs_streaming():
    def respond(request):
        assert request.headers["Cartesia-Version"]
        return httpx.Response(
            200,
            json={"data": [{"id": "live", "capability": "stt", "modes": ["stream"]}, {"id": "batch", "capability": "stt", "modes": ["batch"]}]},
        )

    fetch = fetchers._cartesia_fetcher("stt")
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        assert await fetch({"api_key": "key"}, client) == [ModelListing("live")]


@pytest.mark.asyncio
async def test_rejected_key_raises_fetch_error():
    fetch = fetchers._openai_fetcher(is_openai_chat_model)
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(401))) as client:
        with pytest.raises(FetchError):
            await fetch({"api_key": "key"}, client)


def test_merge_uses_the_code_list_without_live_models():
    result = merge_models(live=[], static_ids=["a", "b"], default="a")
    assert result.source == "static"
    assert [m.model_id for m in result.models] == ["a", "b"]


def test_merge_live_list_replaces_the_code_list_and_keeps_the_default():
    live = [LiveModel("new", "New", True)]
    result = merge_models(live=live, static_ids=["old"], default="old")
    assert result.source == "live"
    assert [(m.model_id, m.name) for m in result.models] == [("new", "New"), ("old", "old")]


def test_merge_keeps_deprecated_models_flagged():
    live = [LiveModel("new", None, True), LiveModel("gone", None, False)]
    result = merge_models(live=live, static_ids=[], default=None)
    assert [(m.model_id, m.is_deprecated) for m in result.models] == [("new", False), ("gone", True)]


def test_merge_with_only_deprecated_models_falls_back_to_code():
    live = [LiveModel("gone", None, False)]
    assert merge_models(live=live, static_ids=["a"], default=None).source == "static"


@pytest.mark.parametrize(
    ("current", "new", "expected"),
    [(0, 1, False), (10, 7, False), (10, 6, True), (10, 20, False)],
)
def test_large_shrink(current, new, expected):
    assert sync.is_large_shrink(current=current, new=new) is expected


def _client(active: int = 0):
    rows = [SimpleNamespace(status="active") for _ in range(active)]
    return SimpleNamespace(
        list_provider_models=AsyncMock(return_value=rows), replace_provider_models=AsyncMock()
    )


def _fetcher(fetch, **kwargs) -> ModelFetcher:
    return ModelFetcher("openai", "llm", fetch, **kwargs)


async def _run(fetcher, model_client, *, force=False, creds=None):
    with patch.object(sync, "resolve_credentials", AsyncMock(return_value=creds)):
        return await sync._sync_fetcher(
            fetcher=fetcher, client=None, model_client=model_client, force=force
        )


@pytest.mark.asyncio
async def test_sync_without_a_key_changes_nothing():
    model_client = _client()
    result = await _run(_fetcher(AsyncMock()), model_client)
    assert result.status == "skipped"
    model_client.replace_provider_models.assert_not_called()


@pytest.mark.asyncio
async def test_sync_failure_keeps_stored_models():
    model_client = _client(active=5)
    result = await _run(_fetcher(AsyncMock(side_effect=FetchError("bad key"))), model_client, creds={"api_key": "k"})
    assert result.status == "failed"
    model_client.replace_provider_models.assert_not_called()


@pytest.mark.asyncio
async def test_sync_empty_list_keeps_stored_models():
    model_client = _client(active=5)
    result = await _run(_fetcher(AsyncMock(return_value=[])), model_client, creds={"api_key": "k"})
    assert result.status == "failed"
    model_client.replace_provider_models.assert_not_called()


@pytest.mark.asyncio
async def test_sync_large_shrink_waits_unless_forced():
    fetch = AsyncMock(return_value=[ModelListing("a")])
    model_client = _client(active=10)
    result = await _run(_fetcher(fetch), model_client, creds={"api_key": "k"})
    assert result.status == "needs_review"
    model_client.replace_provider_models.assert_not_called()

    result = await _run(_fetcher(fetch), model_client, force=True, creds={"api_key": "k"})
    assert result.status == "updated"
    model_client.replace_provider_models.assert_awaited_once()


@pytest.mark.asyncio
async def test_public_list_needs_no_key():
    model_client = _client()
    fetch = AsyncMock(return_value=[ModelListing("a")])
    result = await _run(_fetcher(fetch, requires_key=False), model_client)
    assert result.status == "updated"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("provider", "capability"),
    [("openai", "llm"), ("deepgram", "stt"), ("elevenlabs", "tts"), ("openai_realtime", "realtime")],
)
async def test_code_list_is_used_for_every_service(provider, capability):
    with patch.object(catalog, "get_live_models", AsyncMock(return_value=[])):
        result = await catalog.list_provider_models(provider=provider, capability=capability)
    assert result.source == "static"
    assert result.models


@pytest.mark.asyncio
async def test_provider_without_the_service_is_rejected():
    with pytest.raises(ValueError):
        await catalog.list_provider_models(provider="groq", capability="tts")


@pytest.mark.parametrize(
    "model",
    ["gemini-nano-banana-2.1", "gemini-3.5-transcribe", "gemini-3.1-pro-preview-customtools"],
)
def test_google_chat_drops_models_that_cannot_run_a_voice_agent(model):
    entry = {"name": f"models/{model}", "supportedGenerationMethods": ["generateContent"]}
    assert not is_google_chat_model(entry)


@pytest.mark.parametrize(
    "model",
    ["gemini-robotics-er-2-streaming-preview", "gemini-3.5-live-translate-preview", "gemini-3.5-transcribe-live"],
)
def test_google_live_drops_models_that_cannot_run_a_voice_agent(model):
    entry = {"name": f"models/{model}", "supportedGenerationMethods": ["bidiGenerateContent"]}
    assert not is_google_live_model(entry)
