"""Provider voice catalog: valid voice lists, gender/language metadata,
language filtering, and replacement of voices a provider would reject."""

from pathlib import Path
from types import SimpleNamespace

import pytest

from api.services.configuration.provider_catalog import (
    list_languages,
    list_voices,
    resolve_voice,
    voice_matches_language,
    voice_metadata,
)


def _by_id(provider: str, capability: str = "tts", **kwargs) -> dict:
    return {v.voice_id: v for v in list_voices(provider, capability, **kwargs)}


# ---------------------------------------------------------------------------
# Voice lists match the providers' official catalogs
# ---------------------------------------------------------------------------

def test_soniox_voices_are_real_soniox_voices():
    voices = _by_id("soniox")
    # "Emily" was rejected by Soniox: "Invalid voice 'Emily' for model 'tts-rt-v2'".
    for fake in ["Bryce", "Lia", "Alexander", "Emily", "James"]:
        assert fake not in voices
    for real in ["Adrian", "Daniel", "Emma", "Grace", "Nina", "Maya"]:
        assert real in voices
    assert len(voices) == 28


def test_deepgram_voices_match_official_list():
    voices = _by_id("deepgram")
    assert len(voices) == 102
    assert "aura-2-thalia-en" in voices
    assert "aura-2-celeste-es" in voices
    assert "aura-2-achilles-en" not in voices  # never existed


def test_sarvam_v3_has_no_v2_or_unknown_speakers():
    v3 = {v.voice_id for v in list_voices("sarvam", "tts", model="bulbul:v3")}
    assert "amelia" not in v3 and "sophia" not in v3
    assert "shubh" in v3 and "anushka" not in v3


def test_cartesia_voices_have_names():
    voices = _by_id("cartesia")
    assert voices["694f9389-aac1-45b6-b726-9d9369183238"].name == "Sarah"
    assert voices["a0e99841-438c-4a64-b679-ae501e7d6091"].name == "Barbershop Man"
    assert "3faa81ae-d3d8-4ab1-9e44-e50e46d33c30" not in voices  # old, non-existent default


def test_model_specific_voice_lists():
    assert "marin" in _by_id("openai", model="gpt-4o-mini-tts")
    assert "marin" not in _by_id("openai", model="tts-1")
    assert set(_by_id("rime", model="arcana")) == {"celeste", "luna"}
    pro = _by_id("smallest", model="lightning_v3.1_pro")
    assert "meher" in pro and "sophia" not in pro
    assert len(_by_id("google_realtime", "realtime")) == 30
    assert {"marin", "cedar"} <= set(_by_id("openai_realtime", "realtime"))


@pytest.mark.parametrize(
    "provider, capability, model",
    [
        ("soniox", "tts", "tts-rt-v2"),
        ("deepgram", "tts", None),
        ("cartesia", "tts", "sonic-3.5"),
        ("smallest", "tts", "lightning_v3.1"),
        ("rime", "tts", "arcana"),
        ("sarvam", "tts", "bulbul:v2"),
        ("openai", "tts", "gpt-4o-mini-tts"),
        ("google_realtime", "realtime", None),
    ],
)
def test_default_voice_is_in_the_catalog(provider, capability, model):
    from api.services.configuration.provider_catalog import _property, _schema

    default = _property(_schema(provider, capability), "voice")["default"]
    assert default in _by_id(provider, capability, model=model)


# ---------------------------------------------------------------------------
# Gender and language metadata
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "voice_id, gender",
    [
        ("aura-2-orion-en", "male"),
        ("aura-orion-en", "male"),
        ("aura-helios-en", "male"),
        ("aura-2-hyperion-en", "male"),
        ("aura-2-janus-en", "female"),  # Deepgram lists Janus as feminine
        ("aura-2-thalia-en", "female"),
        ("aura-2-javier-es", "male"),
    ],
)
def test_deepgram_gender(voice_id, gender):
    assert voice_metadata("deepgram", voice_id)[0] == gender


@pytest.mark.parametrize(
    "provider",
    ["deepgram", "azure_speech", "google", "speaches", "indicf5", "sarvam", "rime",
     "smallest", "soniox", "cartesia"],
)
def test_every_voice_has_gender_and_language(provider):
    voices = list_voices(provider, "tts")
    assert voices
    assert [v.voice_id for v in voices if not v.gender] == []
    assert [v.voice_id for v in voices if not v.language] == []


def test_deepgram_voice_language_comes_from_suffix():
    voices = _by_id("deepgram")
    assert voices["aura-2-thalia-en"].language == "en"
    assert voices["aura-2-celeste-es"].language == "es"
    assert voices["aura-2-uzume-ja"].language == "ja"


def test_azure_and_google_metadata():
    assert voice_metadata("azure_speech", "hi-IN-SwaraNeural") == ("female", "hi-IN")
    assert voice_metadata("azure_speech", "en-US-AvaMultilingualNeural") == ("female", "en-US")
    assert voice_metadata("google", "en-IN-Chirp3-HD-Charon") == ("male", "en-IN")


def test_other_metadata():
    assert _by_id("convozent")["antoni"].gender == "male"
    assert _by_id("neutts")["jo"].gender == "female"
    minimax = _by_id("minimax")
    assert minimax["English_Graceful_Lady"].gender == "female"
    assert minimax["English_Graceful_Lady"].language == "en"
    assert _by_id("openai_realtime", "realtime")["verse"].gender == "male"
    smallest = _by_id("smallest")
    assert smallest["devansh"].language == "en-IN"
    assert smallest["jeevan"].language == "ta-IN"
    assert smallest["olivia"].language == "en-US"


# ---------------------------------------------------------------------------
# Language matching / filtering
# ---------------------------------------------------------------------------

def test_indian_language_matching_is_per_voice_except_sarvam():
    assert not voice_matches_language("indicf5", "hi-IN", "ta-IN")
    assert not voice_matches_language("azure_speech", "hi-IN", "ta-IN")
    assert voice_matches_language("indicf5", "ta-IN", "ta-IN")
    assert voice_matches_language("sarvam", "hi-IN", "ta-IN")
    assert voice_matches_language("elevenlabs", "multi", "ja")
    assert voice_matches_language("camb", None, "ja")


def test_list_voices_filters_by_language():
    assert [v.voice_id for v in list_voices("indicf5", "tts", language="ta-IN")] == ["TAM_F_HAPPY_00001"]
    azure_hindi = {v.voice_id for v in list_voices("azure_speech", "tts", language="hi-IN")}
    assert azure_hindi == {"hi-IN-SwaraNeural", "hi-IN-MadhurNeural"}
    spanish = list_voices("deepgram", "tts", language="es-ES")
    assert spanish and all(v.voice_id.endswith("-es") for v in spanish)
    assert len(list_voices("sarvam", "tts", language="ta-IN")) == len(list_voices("sarvam", "tts"))


def test_list_voices_falls_back_to_all_when_nothing_matches():
    assert len(list_voices("deepgram", "tts", language="ko")) == len(list_voices("deepgram", "tts"))


def test_language_names_cover_common_codes():
    names = {lang.code: lang.name for lang in list_languages("azure_speech", "tts")}
    assert names["nl-NL"] == "Dutch (Netherlands)"
    # ElevenLabs takes plain languages only.
    elevenlabs = {lang.code: lang.name for lang in list_languages("elevenlabs", "tts")}
    assert elevenlabs["nl"] == "Dutch"
    stt = {lang.code: lang.name for lang in list_languages("deepgram", "stt")}
    assert [code for code, name in stt.items() if name == code] == []


def test_unknown_provider_raises_value_error():
    with pytest.raises(ValueError):
        list_voices("not_a_provider", "tts")


# ---------------------------------------------------------------------------
# Replacing voices a provider would reject
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "provider, model, voice, expected",
    [
        # Listed by mistake in the past
        ("soniox", "tts-rt-v2", "Emily", "Adrian"),
        ("deepgram", None, "aura-2-achilles-en", "aura-2-helena-en"),
        ("cartesia", "sonic-3.5", "3faa81ae-d3d8-4ab1-9e44-e50e46d33c30",
         "694f9389-aac1-45b6-b726-9d9369183238"),
        ("sarvam", "bulbul:v3", "amelia", "shubh"),
        # Catalog voice of another model of the same provider
        ("sarvam", "bulbul:v3", "anushka", "shubh"),
        ("smallest", "lightning_v3.1_pro", "sophia", "meher"),
        ("rime", "arcana", "abbie", "celeste"),
        # Valid or custom voices are left alone
        ("soniox", "tts-rt-v2", "Adrian", "Adrian"),
        ("soniox", "tts-rt-v2", "my-cloned-voice-uuid", "my-cloned-voice-uuid"),
        ("sarvam", "bulbul:v2", "anushka", "anushka"),
        ("elevenlabs", "eleven_flash_v2_5", "someCustomVoiceId", "someCustomVoiceId"),
    ],
)
def test_resolve_voice(provider, model, voice, expected):
    assert resolve_voice(provider, "tts", model, voice) == expected


def test_resolve_voice_handles_empty_and_unknown_provider():
    assert resolve_voice("soniox", "tts", "tts-rt-v2", None) is None
    assert resolve_voice("not_a_provider", "tts", None, "x") == "x"


def test_factory_swaps_unsupported_voice_before_creating_service():
    from api.services.pipecat.service_factory import _replace_unsupported_voice

    cfg = SimpleNamespace(provider="soniox", model="tts-rt-v2", voice="Emily")
    _replace_unsupported_voice(cfg, "tts")
    assert cfg.voice == "Adrian"

    custom = SimpleNamespace(provider="soniox", model="tts-rt-v2", voice="cloned-123")
    _replace_unsupported_voice(custom, "tts")
    assert custom.voice == "cloned-123"


# ---------------------------------------------------------------------------
# UI catalog stays in sync with the backend
# ---------------------------------------------------------------------------

def test_generated_ui_voice_catalog_is_up_to_date():
    import importlib.util

    root = Path(__file__).resolve().parents[2]
    spec = importlib.util.spec_from_file_location(
        "generate_voice_catalog", root / "scripts" / "generate_voice_catalog.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    current = (root / "ui" / "src" / "lib" / "voiceCatalog.generated.json").read_text(encoding="utf-8")
    assert current == module.render(), (
        "ui/src/lib/voiceCatalog.generated.json is stale; run: python scripts/generate_voice_catalog.py"
    )
