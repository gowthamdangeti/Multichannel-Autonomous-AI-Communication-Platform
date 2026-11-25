"""Language registry and per-provider language catalog."""

import pytest

from api.services.configuration.locales import (
    canonical_code,
    count_languages,
    get_locale,
    group_locales,
)
from api.services.configuration.options.soniox import SONIOX_LANGUAGES
from api.services.configuration.provider_catalog import language_catalog
from api.services.configuration.registry import (
    REGISTRY,
    ServiceType,
    SonioxSTTConfiguration,
    SonioxTTSConfiguration,
)

CAPABILITIES = {ServiceType.STT: "stt", ServiceType.TTS: "tts", ServiceType.REALTIME: "realtime"}


def _speech_providers():
    for service_type, capability in CAPABILITIES.items():
        for provider in REGISTRY[service_type]:
            yield getattr(provider, "value", provider), capability


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "code,label,flag",
    [
        ("en-US", "English (US)", "🇺🇸"),
        ("en-GB", "English (UK)", "🇬🇧"),
        ("en-IN", "English (India)", "🇮🇳"),
        ("hi-IN", "Hindi (India)", "🇮🇳"),
        ("es-419", "Spanish (Latin America)", None),
        ("cmn-Hans-CN", "Mandarin (Simplified, China)", "🇨🇳"),
        ("en", "English", None),
    ],
)
def test_locale_labels_and_flags(code, label, flag):
    locale = get_locale(code)
    assert locale.label == label
    assert locale.flag == flag


def test_locale_keeps_provider_value_but_canonicalizes_display():
    locale = get_locale("en-us")
    assert locale.code == "en-us"
    assert locale.display_code == "en-US"
    assert canonical_code("EN_gb") == "en-GB"


def test_auto_detect_codes():
    for code in ("auto", "multi", "unknown"):
        locale = get_locale(code)
        assert locale.is_auto_detect
        assert locale.group == "auto"


def test_mixed_language_codes():
    locale = get_locale("ar_en")
    assert locale.label == "Arabic + English"
    assert locale.group == "mixed"


def test_rtl_direction():
    assert get_locale("ar-SA").direction == "rtl"
    assert get_locale("ur-IN").direction == "rtl"
    assert get_locale("hi-IN").direction == "ltr"


def test_grouping_puts_variants_together_and_auto_first():
    groups = group_locales(["fr-FR", "en-US", "auto", "hi-IN", "en-GB", "en-IN", "EN-us"])
    assert [g.id for g in groups] == ["auto", "indian", "english", "european"]
    english = next(g for g in groups if g.id == "english")
    assert [l.code for l in english.locales] == ["en-IN", "en-GB", "en-US"]  # duplicate "EN-us" dropped


def test_count_languages_vs_options():
    assert count_languages(["auto", "en-US", "en-GB", "en-IN", "hi-IN"]) == (2, 4)


# ---------------------------------------------------------------------------
# Every provider
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("provider,capability", list(_speech_providers()))
def test_every_language_has_a_name_and_group(provider, capability):
    catalog = language_catalog(provider, capability)
    for group in catalog.groups:
        assert group.id != "other", f"{provider}: add a group for {[l.code for l in group.locales]}"
        for locale in group.locales:
            assert locale.language_name != locale.language, f"{provider}: no name for {locale.code}"


@pytest.mark.parametrize("provider,capability", list(_speech_providers()))
def test_default_language_is_offered(provider, capability):
    catalog = language_catalog(provider, capability)
    if catalog.total_options or catalog.auto_detect:
        codes = [l.code for g in catalog.groups for l in g.locales]
        assert catalog.default in codes


@pytest.mark.parametrize("provider,capability", list(_speech_providers()))
def test_counts_match_groups(provider, capability):
    catalog = language_catalog(provider, capability)
    selectable = [l for g in catalog.groups for l in g.locales if not l.is_auto_detect]
    assert catalog.total_options == len(selectable)
    assert catalog.total_languages <= catalog.total_options


# ---------------------------------------------------------------------------
# Soniox
# ---------------------------------------------------------------------------


def test_soniox_offers_60_languages_without_fake_regions():
    assert len(SONIOX_LANGUAGES) == 60
    for capability in ("stt", "tts"):
        catalog = language_catalog("soniox", capability)
        assert catalog.total_languages == 60
        assert catalog.total_options == 60
        codes = [l.code for g in catalog.groups for l in g.locales]
        assert not [c for c in codes if "-" in c]


def test_soniox_stt_offers_auto_detect():
    assert language_catalog("soniox", "stt").auto_detect
    assert not language_catalog("soniox", "tts").auto_detect


@pytest.mark.parametrize(
    "saved,expected",
    [("en-US", "en"), ("en-IN", "en"), ("hi-IN", "hi"), ("unknown", "auto"), ("my-custom", "my-custom")],
)
def test_soniox_saved_regional_codes_still_load(saved, expected):
    assert SonioxSTTConfiguration(api_key="k", language=saved).language == expected
    if expected != "auto":
        assert SonioxTTSConfiguration(api_key="k", language=saved).language == expected


# ---------------------------------------------------------------------------
# Per-model lists
# ---------------------------------------------------------------------------


def test_model_specific_list_is_used():
    assert language_catalog("deepgram", "stt", "flux-general-en").total_languages == 1
    assert language_catalog("deepgram", "stt", "nova-3-general").total_languages > 1
    assert language_catalog("elevenlabs", "tts", "eleven_monolingual_v1").total_options == 1


# ---------------------------------------------------------------------------
# Phase 1b: language-only providers and providers with no language setting
# ---------------------------------------------------------------------------


def _codes(catalog):
    return [l.code for g in catalog.groups for l in g.locales]


@pytest.mark.parametrize(
    "provider,capability",
    [
        ("openai_realtime", "realtime"),
        ("azure_realtime", "realtime"),
        ("grok_realtime", "realtime"),
        ("openai", "tts"),
        ("openai", "stt"),
        ("cartesia", "stt"),
        ("huggingface", "stt"),
        ("minimax", "tts"),
    ],
)
def test_language_only_providers_offer_no_fake_regions(provider, capability):
    catalog = language_catalog(provider, capability)
    assert catalog.total_options > 1
    assert catalog.total_options == catalog.total_languages
    assert not [c for c in _codes(catalog) if "-" in c]


def test_whisper_providers_offer_57_languages():
    for provider, capability in [("openai", "stt"), ("cartesia", "stt"), ("openai", "tts"),
                                 ("openai_realtime", "realtime"), ("azure_realtime", "realtime")]:
        assert language_catalog(provider, capability).total_languages == 57, provider


def test_huggingface_stt_defaults_to_auto_detect():
    catalog = language_catalog("huggingface", "stt")
    assert catalog.auto_detect
    assert catalog.default == "auto"


def test_minimax_offers_40_languages_plus_auto():
    catalog = language_catalog("minimax", "tts")
    assert catalog.total_languages == 40
    assert catalog.auto_detect


def test_speaches_english_only_model_lists_only_english():
    assert _codes(language_catalog("speaches", "stt", "Systran/faster-distil-whisper-small.en")) == ["en"]
    assert language_catalog("speaches", "stt", "Systran/faster-whisper-large-v3").total_languages == 9


@pytest.mark.parametrize(
    "provider,capability",
    [("openai", "tts"), ("grok_realtime", "realtime"), ("deepgram", "tts"), ("speaches", "tts")],
)
def test_providers_without_a_language_setting_explain_it(provider, capability):
    assert language_catalog(provider, capability).note


@pytest.mark.parametrize(
    "provider,capability",
    [("soniox", "stt"), ("google", "tts"), ("elevenlabs", "tts"), ("openai_realtime", "realtime")],
)
def test_providers_that_use_the_language_have_no_note(provider, capability):
    assert language_catalog(provider, capability).note is None


# ---------------------------------------------------------------------------
# Phase 4: built-in lists stay aligned with pipecat's per-provider maps
# ---------------------------------------------------------------------------

import inspect  # noqa: E402
import re  # noqa: E402


def _pipecat_map_values(func):
    return set(re.findall(r'Language\.[A-Z_0-9]+:\s*"([^"]+)"', inspect.getsource(func)))


def test_gemini_live_offers_exactly_what_pipecat_supports():
    from pipecat.services.google.gemini_live.llm import language_to_gemini_language

    supported = _pipecat_map_values(language_to_gemini_language)
    for provider in ("google_realtime", "google_vertex_realtime"):
        codes = set(_codes(language_catalog(provider, "realtime")))
        assert codes == supported, provider


def test_azure_offers_every_locale_pipecat_maps():
    from pipecat.services.azure.common import language_to_azure_language

    supported = _pipecat_map_values(language_to_azure_language)
    for capability in ("stt", "tts"):
        codes = set(_codes(language_catalog("azure_speech", capability)))
        assert supported <= codes, capability
        assert len(codes) >= 150


def test_rime_offers_plain_languages_pipecat_can_send():
    from pipecat.services.rime.tts import language_to_rime_language
    from pipecat.transcriptions.language import Language

    codes = _codes(language_catalog("rime", "tts"))
    assert set(codes) == {"en", "hi", "es", "fr", "de"}
    for code in codes:
        assert len(language_to_rime_language(Language(code))) == 3  # "eng", "hin", ...


# ---------------------------------------------------------------------------
# Phase 5: unsupported languages are rejected when a configuration is saved
# ---------------------------------------------------------------------------

from api.services.configuration.language_sync.store import LiveLanguages  # noqa: E402
from api.services.configuration.provider_catalog import unsupported_language_message  # noqa: E402


@pytest.mark.parametrize(
    "provider,capability,model,language",
    [
        ("soniox", "stt", None, "hi"),  # offered
        ("deepgram", "stt", "nova-3-general", "multi"),  # auto-detect offered
        ("google", "tts", None, "en-NZ"),  # custom regional variant of an offered language
        ("openai", "stt", None, "TA"),  # case-insensitive
        ("soniox", "stt", None, None),  # nothing chosen
    ],
)
def test_supported_languages_pass(provider, capability, model, language):
    assert unsupported_language_message(provider, capability, model, language) is None


@pytest.mark.parametrize(
    "provider,capability,model,language,suggested",
    [
        ("deepgram", "stt", "flux-general-en", "hi", "English (en)"),  # English-only model
        ("soniox", "tts", None, "auto", "English (en)"),  # no auto-detect for TTS
        ("google_realtime", "realtime", None, "cs-CZ", "English (US) (en-US)"),  # Gemini Live lacks Czech
        ("speaches", "stt", "Systran/faster-distil-whisper-small.en", "fr", "English (en)"),
    ],
)
def test_unsupported_languages_are_rejected_with_a_suggestion(provider, capability, model, language, suggested):
    message = unsupported_language_message(provider, capability, model, language)
    assert message and "isn't" in message
    assert f"Try {suggested}" in message


def test_live_list_is_used_for_the_save_check():
    live = {"tts-rt-v2": LiveLanguages(codes=["en", "te"], fetched_at=None)}
    assert unsupported_language_message("soniox", "tts", "tts-rt-v2", "te", live=live) is None
    assert unsupported_language_message("soniox", "tts", "tts-rt-v2", "hi", live=live)


def test_validator_reports_unsupported_language():
    from api.services.configuration.check_validity import UserConfigurationValidator
    from api.services.configuration.registry import DeepgramSTTConfiguration

    validator = UserConfigurationValidator()
    validator._live_languages = {}
    config = DeepgramSTTConfiguration(api_key="k", model="flux-general-en", language="hi")
    errors = validator._validate_service(config, "stt")
    assert errors and errors[0]["model"] == "stt"
    assert "Hindi" in errors[0]["message"]
