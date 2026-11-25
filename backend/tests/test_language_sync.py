"""Live language lists: fetchers, safety rules, credentials and catalog merge.

No network or database: provider APIs are replayed with httpx.MockTransport
and the DB client is an in-memory fake.
"""

from dataclasses import dataclass, field
from datetime import UTC, datetime

import httpx
import pytest

from api.services.configuration.language_sync import store as live_store
from api.services.configuration.language_sync import sync as sync_module
from api.services.configuration.language_sync.credentials import pick_credentials
from api.services.configuration.language_sync.fetchers import (
    AzureSpeechTTSFetcher,
    CartesiaTTSFetcher,
    DeepgramTTSFetcher,
    ElevenLabsTTSFetcher,
    FetchError,
    GoogleTTSFetcher,
    SonioxTTSFetcher,
)
from api.services.configuration.language_sync.store import LiveLanguages
from api.services.configuration.language_sync.sync import review_change, sync_provider
from api.services.configuration.provider_catalog import language_catalog


def _client(routes):
    """routes: {(method, host+path): response json | (status, json) | callable(request)}."""

    def handler(request: httpx.Request):
        key = request.url.host + request.url.path
        value = routes[key]
        if callable(value):
            return value(request)
        if isinstance(value, tuple):
            return httpx.Response(value[0], json=value[1])
        return httpx.Response(200, json=value)

    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


# ---------------------------------------------------------------------------
# Fetchers
# ---------------------------------------------------------------------------


async def test_google_groups_voices_by_model_tier():
    seen = {}

    def voices(request):
        seen["key"] = request.url.params.get("key")
        return httpx.Response(200, json={"voices": [
            {"name": "en-US-Chirp3-HD-Charon", "languageCodes": ["en-US"]},
            {"name": "en-IN-Chirp3-HD-Aoede", "languageCodes": ["en-IN"]},
            {"name": "hi-IN-Neural2-A", "languageCodes": ["hi-IN"]},
            {"name": "hi-IN-Neural2-B", "languageCodes": ["hi-IN"]},
            {"name": "en-US-Studio-O", "languageCodes": ["en-US"]},  # not a model we offer
        ]})

    async with _client({"texttospeech.googleapis.com/v1/voices": voices}) as client:
        result = await GoogleTTSFetcher().fetch({"api_key": "g-key"}, client)
    assert seen["key"] == "g-key"
    assert result.models == {"chirp_3_hd": ["en-IN", "en-US"], "neural2": ["hi-IN"]}
    assert result.voice_counts["neural2"] == {"hi-IN": 2}


async def test_azure_lists_locales_with_voice_counts():
    seen = {}

    def voices(request):
        seen["key"] = request.headers.get("Ocp-Apim-Subscription-Key")
        return httpx.Response(200, json=[
            {"ShortName": "en-US-AriaNeural", "Locale": "en-US"},
            {"ShortName": "en-US-GuyNeural", "Locale": "en-US"},
            {"ShortName": "ta-IN-PallaviNeural", "Locale": "ta-IN"},
        ])

    async with _client({"eastus.tts.speech.microsoft.com/cognitiveservices/voices/list": voices}) as client:
        result = await AzureSpeechTTSFetcher().fetch({"api_key": "a-key", "region": "eastus"}, client)
    assert seen["key"] == "a-key"
    assert result.models == {"": ["en-US", "ta-IN"]}
    assert result.voice_counts[""] == {"en-US": 2, "ta-IN": 1}


async def test_azure_rejects_a_bad_region():
    async with _client({}) as client:
        with pytest.raises(FetchError):
            await AzureSpeechTTSFetcher().fetch({"api_key": "k", "region": "evil.com/x"}, client)


async def test_elevenlabs_lists_languages_per_tts_model():
    async with _client({"api.elevenlabs.io/v1/models": [
        {"model_id": "eleven_flash_v2_5", "can_do_text_to_speech": True,
         "languages": [{"language_id": "en", "name": "English"}, {"language_id": "hi", "name": "Hindi"}]},
        {"model_id": "eleven_english_sts_v2", "can_do_text_to_speech": False,
         "languages": [{"language_id": "en", "name": "English"}]},
    ]}) as client:
        result = await ElevenLabsTTSFetcher().fetch({"api_key": ["", "e-key"]}, client)
    assert result.models == {"eleven_flash_v2_5": ["en", "hi"]}


async def test_deepgram_prefers_regional_codes():
    async with _client({"api.deepgram.com/v1/models": {"stt": [], "tts": [
        {"name": "aura-2-thalia-en", "languages": ["en", "en-US"]},
        {"name": "aura-2-celeste-es", "languages": ["es"]},
    ]}}) as client:
        result = await DeepgramTTSFetcher().fetch({}, client)
    assert result.models == {"": ["en-US", "es"]}


async def test_cartesia_follows_pagination_and_keeps_plain_languages():
    pages = iter([
        {"data": [{"id": "a", "language": "en"}, {"id": "b", "language": "hi"}], "has_more": True, "next_page": "b"},
        {"data": [{"id": "c", "accents": [{"locale": "fr-FR"}]}], "has_more": False, "next_page": None},
    ])
    cursors = []

    def voices(request):
        cursors.append(request.url.params.get("starting_after"))
        assert request.headers["Cartesia-Version"]
        return httpx.Response(200, json=next(pages))

    async with _client({"api.cartesia.ai/voices": voices}) as client:
        result = await CartesiaTTSFetcher().fetch({"api_key": "c-key"}, client)
    assert cursors == [None, "b"]
    assert result.models == {"": ["en", "fr", "hi"]}


async def test_soniox_lists_languages_per_model():
    async with _client({"api.soniox.com/v1/tts-models": {"models": [
        {"id": "tts-rt-v2", "languages": [{"code": "en", "name": "English"}, {"code": "te", "name": "Telugu"}]},
    ]}}) as client:
        result = await SonioxTTSFetcher().fetch({"api_key": "s-key"}, client)
    assert result.models == {"tts-rt-v2": ["en", "te"]}


async def test_rejected_key_is_an_error_not_a_retry():
    calls = []

    def unauthorized(request):
        calls.append(1)
        return httpx.Response(401, json={"detail": "bad key"})

    async with _client({"api.soniox.com/v1/tts-models": unauthorized}) as client:
        with pytest.raises(FetchError, match="credentials rejected"):
            await SonioxTTSFetcher().fetch({"api_key": "bad"}, client)
    assert len(calls) == 1


async def test_server_errors_are_retried(monkeypatch):
    async def no_sleep(_seconds):
        return None

    monkeypatch.setattr("api.services.configuration.language_sync.fetchers.asyncio.sleep", no_sleep)
    responses = iter([(503, {}), (200, {"models": [{"id": "m", "languages": [{"code": "en"}]}]})])

    def flaky(request):
        status, body = next(responses)
        return httpx.Response(status, json=body)

    async with _client({"api.soniox.com/v1/tts-models": flaky}) as client:
        result = await SonioxTTSFetcher().fetch({"api_key": "k"}, client)
    assert result.models == {"m": ["en"]}


# ---------------------------------------------------------------------------
# Safety rule
# ---------------------------------------------------------------------------


def test_big_shrink_needs_review():
    assert review_change(["a"] * 10, ["a"] * 6)
    assert review_change(["a"] * 10, ["a"] * 7) is None
    assert review_change([], ["a"]) is None
    assert review_change(["a"] * 10, ["a"] * 40) is None


# ---------------------------------------------------------------------------
# Credentials
# ---------------------------------------------------------------------------


def test_credentials_prefer_a_tts_block_over_an_llm_key():
    configs = [{
        "llm": {"provider": "google", "api_key": "gemini-key", "model": "gemini"},
        "tts": {"provider": "google", "credentials": "{...}", "voice": "en-US-Chirp3-HD-Charon"},
    }]
    assert pick_credentials(configs, "google", "tts")["credentials"] == "{...}"


def test_credentials_found_at_any_depth_and_missing_returns_none():
    configs = [{"presets": [{"pipeline": {"tts": {"provider": "cartesia", "api_key": "k", "voice": "v"}}}]}]
    assert pick_credentials(configs, "cartesia", "tts")["api_key"] == "k"
    assert pick_credentials(configs, "elevenlabs", "tts") is None


# ---------------------------------------------------------------------------
# Catalog merge
# ---------------------------------------------------------------------------


def test_live_list_for_the_model_wins():
    fetched = datetime(2026, 11, 2, tzinfo=UTC)
    live = {"tts-rt-v2": LiveLanguages(codes=["en", "te"], fetched_at=fetched, voice_counts={"en": 3})}
    catalog = language_catalog("soniox", "tts", "tts-rt-v2", live=live)
    assert catalog.source == "live"
    assert catalog.fetched_at == fetched
    assert catalog.total_languages == 2
    assert catalog.voice_counts == {"en": 3}


def test_provider_wide_live_list_applies_to_every_model():
    live = {"": LiveLanguages(codes=["en-US", "ta-IN"], fetched_at=None)}
    assert language_catalog("azure_speech", "tts", "neural", live=live).total_options == 2


def test_no_live_list_falls_back_to_static():
    catalog = language_catalog("soniox", "tts", live={"other-model": LiveLanguages(["en"], None)})
    assert catalog.source == "static"
    assert catalog.total_languages == 60


def test_auto_detect_is_kept_when_live_list_lacks_it():
    live = {"": LiveLanguages(codes=["en", "de"], fetched_at=None)}
    catalog = language_catalog("soniox", "stt", live=live)
    assert catalog.auto_detect
    assert catalog.total_languages == 2


# ---------------------------------------------------------------------------
# sync_provider against an in-memory store
# ---------------------------------------------------------------------------


@dataclass
class _Row:
    id: int
    provider: str
    capability: str
    model: str
    codes: list
    voice_counts: dict | None = None
    pending_codes: list | None = None
    pending_reason: str | None = None
    fetched_at: datetime | None = None


@dataclass
class _FakePlatform:
    rows: list = field(default_factory=list)

    async def list_language_catalog(self, *, provider=None, capability=None):
        return [r for r in self.rows if r.provider == provider and r.capability == capability]

    async def save_language_catalog_entry(self, *, provider, capability, model, codes,
                                          voice_counts, pending_codes, pending_reason):
        row = next((r for r in self.rows if (r.provider, r.capability, r.model) == (provider, capability, model)), None)
        if row is None:
            row = _Row(len(self.rows) + 1, provider, capability, model, codes or [])
            self.rows.append(row)
        elif codes is not None:
            row.codes = codes
        if codes is not None:
            row.voice_counts = voice_counts
        row.pending_codes, row.pending_reason = pending_codes, pending_reason
        return row


@pytest.fixture
def fake_platform(monkeypatch):
    fake = _FakePlatform()
    monkeypatch.setattr(sync_module, "platform_client", fake)

    async def creds(provider, capability):
        return {"api_key": "k"}

    monkeypatch.setattr(sync_module, "resolve_credentials", creds)
    live_store.invalidate()
    return fake


def _soniox(codes):
    return _client({"api.soniox.com/v1/tts-models": {"models": [
        {"id": "tts-rt-v2", "languages": [{"code": c} for c in codes]}
    ]}})


async def test_sync_stores_a_new_live_list(fake_platform):
    from api.services.configuration.options.soniox import SONIOX_LANGUAGES

    codes = list(SONIOX_LANGUAGES)
    async with _soniox(codes) as client:
        result = await sync_provider("soniox", client=client)
    assert result.status == "updated"
    assert result.models == {"tts-rt-v2": 60}
    assert fake_platform.rows[0].codes == sorted(codes)

    # A second identical refresh reports "unchanged".
    async with _soniox(codes) as client:
        again = await sync_provider("soniox", client=client)
    assert again.status == "unchanged"


async def test_sync_parks_a_big_shrink_for_review(fake_platform):
    # Static Soniox list has 60 languages; a 3-language reply looks like an outage.
    async with _soniox(["en", "hi", "te"]) as client:
        result = await sync_provider("soniox", client=client)
    assert result.status == "pending_review"
    row = fake_platform.rows[0]
    assert row.codes == []  # nothing applied
    assert row.pending_codes == ["en", "hi", "te"]
    assert row.pending_reason


async def test_sync_failure_changes_nothing(fake_platform):
    async with _client({"api.soniox.com/v1/tts-models": (401, {})}) as client:
        result = await sync_provider("soniox", client=client)
    assert result.status == "error"
    assert fake_platform.rows == []


async def test_sync_without_key_is_skipped(fake_platform, monkeypatch):
    async def no_creds(provider, capability):
        return None

    monkeypatch.setattr(sync_module, "resolve_credentials", no_creds)
    result = await sync_provider("elevenlabs")
    assert result.status == "skipped"
    assert "LANGUAGE_SYNC_ELEVENLABS_API_KEY" in result.message


async def test_provider_without_listing_api_is_skipped():
    result = await sync_provider("rime")
    assert result.status == "skipped"


# ---------------------------------------------------------------------------
# Phase 3: speech-to-text
# ---------------------------------------------------------------------------

import json  # noqa: E402
from pathlib import Path  # noqa: E402

from api.services.configuration.language_sync.fetchers import (  # noqa: E402
    FETCHERS,
    DeepgramSTTFetcher,
    SonioxFetcher,
    SpeechmaticsSTTFetcher,
    get_fetcher,
)
from api.services.configuration.registry import SPEECHMATICS_STT_LANGUAGES  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures" / "language_sync"


def test_fetchers_are_keyed_by_provider_and_capability():
    assert {"soniox:tts", "soniox:stt", "deepgram:tts", "deepgram:stt", "speechmatics:stt"} <= set(FETCHERS)
    assert get_fetcher("soniox").capability == "tts"  # bare provider = TTS
    assert get_fetcher("soniox:stt").capability == "stt"
    assert get_fetcher("azure_speech:stt") is None  # no real-time listing API


async def test_soniox_stt_uses_the_models_endpoint():
    async with _client({"api.soniox.com/v1/models": {"models": [
        {"id": "stt-rt-v4", "context_version": 2,
         "languages": [{"code": "af", "name": "Afrikaans"}, {"code": "en", "name": "English"}]},
    ]}}) as client:
        result = await SonioxFetcher("stt").fetch({"api_key": "k"}, client)
    assert result.models == {"stt-rt-v4": ["af", "en"]}


async def test_deepgram_stt_maps_models_to_our_ids_and_skips_batch_only():
    async with _client({"api.deepgram.com/v1/models": {"tts": [], "stt": [
        {"name": "nova-3", "canonical_name": "nova-3", "architecture": "base",
         "languages": ["en", "en-us"], "streaming": True},
        {"name": "nova-3", "canonical_name": "nova-3", "architecture": "base",
         "languages": ["hi"], "streaming": True},
        {"name": "flux", "canonical_name": "flux-general-en", "architecture": "flux",
         "languages": ["en"], "streaming": True},
        {"name": "whisper", "canonical_name": "whisper-large", "languages": ["fr"], "streaming": False},
    ]}}) as client:
        result = await DeepgramSTTFetcher().fetch({"api_key": "k"}, client)
    assert result.models == {"nova-3-general": ["en", "en-US", "hi"], "flux-general-en": ["en"]}


async def test_speechmatics_reads_the_real_discovery_response():
    recorded = json.loads((FIXTURES / "speechmatics_discovery_features.json").read_text(encoding="utf-8"))
    async with _client({"eu1.asr.api.speechmatics.com/v1/discovery/features": recorded}) as client:
        result = await SpeechmaticsSTTFetcher().fetch({}, client)
    codes = result.models[""]
    assert len(codes) == 61
    assert "ar_en" in codes  # mixed-language packs are kept
    # The built-in list was taken from this endpoint, so they match.
    assert set(codes) == set(SPEECHMATICS_STT_LANGUAGES)


async def test_speechmatics_needs_no_key(fake_platform, monkeypatch):
    async def no_creds(provider, capability):
        raise AssertionError("credentials must not be looked up for a public endpoint")

    monkeypatch.setattr(sync_module, "resolve_credentials", no_creds)
    recorded = json.loads((FIXTURES / "speechmatics_discovery_features.json").read_text(encoding="utf-8"))
    async with _client({"eu1.asr.api.speechmatics.com/v1/discovery/features": recorded}) as client:
        result = await sync_provider("speechmatics:stt", client=client)
    assert result.status == "updated"
    assert result.capability == "stt"


def test_live_stt_list_keeps_auto_detect():
    live = {"nova-3-general": LiveLanguages(codes=["en", "en-US", "hi"], fetched_at=None)}
    catalog = language_catalog("deepgram", "stt", "nova-3-general", live=live)
    assert catalog.source == "live"
    assert catalog.auto_detect  # "multi" comes from the built-in list
    assert catalog.total_options == 3


def test_credentials_for_stt_prefer_the_stt_block():
    configs = [{
        "tts": {"provider": "deepgram", "api_key": "tts-key", "voice": "aura-2-thalia-en"},
        "stt": {"provider": "deepgram", "api_key": "stt-key", "model": "nova-3-general"},
    }]
    assert pick_credentials(configs, "deepgram", "stt")["api_key"] == "stt-key"
    assert pick_credentials(configs, "deepgram", "tts")["api_key"] == "tts-key"
