"""Static catalog of languages and voices per provider/capability.

Voices and languages come from the provider config schemas in ``registry``.
This module adds metadata the schemas don't carry: the display name, gender
and language of each voice.

Gender lookup always uses an *exact* voice name, never a substring. Substring
matching breaks easily: the female Deepgram name "io" is inside "orion",
"helios" and "hyperion", and "dione" is inside "dionysus".
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Mapping

from api.services.configuration.options.cartesia import (
    CARTESIA_TTS_VOICE_GENDERS,
    CARTESIA_TTS_VOICE_NAMES,
)
from api.services.configuration.options.deepgram import DEEPGRAM_TTS_VOICE_GENDERS
from api.services.configuration.options.google import GOOGLE_REALTIME_VOICE_GENDERS
from api.services.configuration.options.smallest import (
    SMALLEST_TTS_PRO_VOICE_GENDERS,
    SMALLEST_TTS_VOICE_GENDERS,
    SMALLEST_VOICE_LANGUAGES,
)
from api.services.configuration.options.soniox import SONIOX_TTS_VOICE_GENDERS
from api.services.configuration.locales import (
    LANGUAGE_NAMES,
    Locale,
    LocaleGroup,
    count_languages,
    get_locale,
    group_locales,
)
from api.services.configuration.registry import REGISTRY, RIME_VOICE_GENDERS, ServiceType

# Kept for callers that still import the old name.
CatalogLanguage = Locale


@dataclass(frozen=True)
class CatalogVoice:
    voice_id: str
    name: str
    gender: str | None = None
    language: str | None = None
    accent: str | None = None
    source: str = "static"
    is_selectable: bool = True


# ---------------------------------------------------------------------------
# Languages
# ---------------------------------------------------------------------------

INDIAN_LANGUAGES = frozenset(
    {"hi", "ta", "te", "kn", "bn", "gu", "mr", "ml", "pa", "or", "od", "as", "ur", "sa"}
)

# Providers whose voices each speak every language the provider supports.
MULTILINGUAL_PROVIDERS = frozenset(
    {
        "elevenlabs", "rime", "soniox", "cartesia", "openai", "convozent",
        "camb", "minimax", "openai_realtime", "azure_realtime", "grok_realtime",
        "ultravox_realtime", "google_realtime", "google_vertex_realtime",
    }
)


def _base_language(code: str) -> str:
    return code.replace("_", "-").split("-")[0].lower()


# ---------------------------------------------------------------------------
# Voice gender tables (keys are lowercase, matched exactly)
# ---------------------------------------------------------------------------

def _names(gender: str, names: str) -> dict[str, str]:
    return {n: gender for n in names.split()}


# Per-provider voice genders, kept next to each provider's voice list in the
# options modules / registry. Keys are matched case-insensitively.
PROVIDER_VOICE_GENDERS: dict[str, dict[str, str]] = {
    "deepgram": DEEPGRAM_TTS_VOICE_GENDERS,
    "cartesia": CARTESIA_TTS_VOICE_GENDERS,
    "smallest": {**SMALLEST_TTS_VOICE_GENDERS, **SMALLEST_TTS_PRO_VOICE_GENDERS},
    "soniox": SONIOX_TTS_VOICE_GENDERS,
    "rime": RIME_VOICE_GENDERS,
    "google_realtime": GOOGLE_REALTIME_VOICE_GENDERS,
    "google_vertex_realtime": GOOGLE_REALTIME_VOICE_GENDERS,
}
_PROVIDER_VOICE_GENDERS_LOWER = {
    provider: {k.lower(): v for k, v in genders.items()}
    for provider, genders in PROVIDER_VOICE_GENDERS.items()
}

# Display names for voices whose ID is not a readable name (UUIDs).
ELEVENLABS_VOICE_NAMES: dict[str, str] = {
    "21m00Tcm4TlvDq8ikWAM": "Rachel", "AZnzlk1XvdvUeBnXmlld": "Domi",
    "EXAVITQu4vr4xnSDxMaL": "Sarah", "ErXwobaYiN019PkySvjV": "Antoni",
    "MF3mGyEYCl7XYWbV9V6O": "Elli", "TxGEqnHWrfWFTfGW9XjX": "Josh",
    "VR6AewLTigWG4tlVwjdK": "Arnold", "pNInz6obpgDQGcFmaJgB": "Adam",
    "yoZ06a0pkGbda9VNxB3S": "Sam", "onwK4e9ZLuTAKqWW03F9": "Daniel",
    "pFZP5JQG7iQjIQuC4Bku": "Lily", "ThT5KcBeYPX3keUQqHPh": "Dorothy",
    "LcfcDJNigLHyBiGajdjz": "Emily", "jsCqWAovK2LkecY7zXl4": "Freya",
    "z9fAnlkpzviPz146aGWa": "Glinda", "oWAxZDxUHUwScMcUqPjm": "Grace",
    "bIHbv24MWmeRgasZH58o": "Will", "flq6f7yk4E4fJM5XTYuZ": "Michael",
    "g5CIjZEefAph4nQFvHAz": "Ethan", "IKne3meq5aSn9XLyUdCD": "Charlie",
    "JBFqnCBsd6RMkjVDRZzb": "George", "N2lVS1w4EtoT3dr4eOWO": "Callum",
    "XB0fDUnXU5powFXDhCwa": "Charlotte", "Xb7hH8MSUJpSbSDYk0k2": "Alice",
    "XrExE9yKIg1WjnnlVkGX": "Matilda", "bVMeCyTHy58xNoL34h3p": "Jeremy",
    "cjVigY5qzO86Huf0OWal": "Eric", "iP95p4xoKVk53GoZ742B": "Chris",
    "nPczCjzI2devNBz1zQrb": "Brian", "pqHfZKP75CvOlQylNhV4": "Bill",
}
VOICE_DISPLAY_NAMES: dict[str, str] = {**CARTESIA_TTS_VOICE_NAMES, **ELEVENLABS_VOICE_NAMES}

# Plain voice IDs that are also the voice name, for providers without a
# per-provider table above (OpenAI, Sarvam, Grok, Ultravox, ...).
GENDER_BY_VOICE: dict[str, str] = {
    # OpenAI TTS & Realtime
    "alloy": "neutral",
    **_names("male", "ash ballad echo fable onyx verse cedar"),
    **_names("female", "coral nova sage shimmer marin"),
    # Grok realtime
    **_names("female", "ara eve"),
    **_names("male", "rex sal leo"),
    # Ultravox realtime
    **_names("male", "mark matthew dennis terrence"),
    **_names("female", "jessica rachel"),
    # Sarvam
    **_names(
        "female",
        "anushka manisha vidya arya ritu priya neha pooja simran kavya ishita shreya "
        "roopa tanya shruti suhani kavitha rupali",
    ),
    **_names(
        "male",
        "abhilash karun hitesh shubh aditya rahul rohan amit dev ratan varun manan "
        "sumit kabir aayan ashutosh advait anand tarun sunny mani gokul vijay mohit rehan soham",
    ),
    # Convozent managed (ElevenLabs-style names)
    **_names("male", "antoni josh"),
    **_names("female", "sarah"),
    # NeuTTS reference voices
    **_names("male", "dave"),
    **_names("female", "jo anna stella"),
    # ElevenLabs premade voice IDs
    **_names(
        "female",
        "21m00tcm4tlvdq8ikwam aznzlk1xvdvuebnxmlld exavitqu4vr4xnsdxmal mf3mgyeycl7xywbv9v6o "
        "pfzp5jqg7iqjiquc4bku tht5kcbeypx3keuqqhph lcfcdjniglhybigajdjz jscqwaovk2lkecy7zxl4 "
        "z9fanlkpzvipz146agwa owaxzdxuhuwscmcuqpjm xb0fdunxu5powfxdhcwa xb7hh8msujpsbsdyk0k2 "
        "xrexe9ykig1wjnnlvkgx",
    ),
    **_names(
        "male",
        "erxwobayin019pkysvjv txgeqnhwrfwftfgw9xjx vr6aewltigwg4tlvwjdk pninz6obpgdqgcfmajgb "
        "yoz06a0pkgbda9vnxb3s onwk4e9zlutakqww03f9 bihbv24mwmergaszh58o flq6f7yk4e4fjm5xtyuz "
        "g5cijzeefaph4nqfvhaz ikne3meq5asn9xlyudcd jbfqncbsd6rmkjvdrzzb n2lvs1w4etot3dr4eowo "
        "bvmecythy58xnol34h3p cjvigy5qzo86huf0owal ip95p4xokvk53goz742b npczcjzi2devnbz1zqrb "
        "pqhfzkp75cvolqylnhv4",
    ),
}

# Deepgram Aura: the name between "aura-[2-]" and the language suffix. Used for
# Aura IDs typed in as custom input; catalog voices use PROVIDER_VOICE_GENDERS.
AURA_GENDER: dict[str, str] = {
    m.group(1).lower(): gender
    for voice_id, gender in DEEPGRAM_TTS_VOICE_GENDERS.items()
    if (m := re.match(r"^aura-(?:\d+-)?([a-z]+)-[a-z]{2}$", voice_id))
}

# Azure Neural: the name in "<lang>-<REGION>-<Name>[Multilingual]Neural".
AZURE_GENDER: dict[str, str] = {
    **_names(
        "female",
        "aria jenny amber ana ashley elizabeth michelle monica nancy sara sonia natasha "
        "neerja swara pallavi shruti tanishaa dhwani aarohi sapna sobhana vaani gul ava "
        "emma amanda cora hayley holly mia olivia ananya kavya",
    ),
    **_names(
        "male",
        "guy davis brandon christopher eric jacob roger steffan tony ryan william prabhat "
        "madhur valluvar mohan bashkar niranjan manohar gagan midhun ojas salman andrew "
        "brian jason oliver aarav kunal",
    ),
}

# Google Chirp 3 HD and Journey voice names.
GOOGLE_GENDER: dict[str, str] = {
    **_names("male", "charon fenrir puck orus d"),
    **_names("female", "aoede kore leda zephyr f o"),
}

_AURA_RE = re.compile(r"^aura-(?:\d+-)?([a-z]+)-([a-z]{2})$", re.IGNORECASE)
_AZURE_RE = re.compile(
    r"^([a-z]{2,3}-[A-Z]{2})-([A-Za-z]+?)(?:Multilingual)?Neural$"
)
_GOOGLE_RE = re.compile(
    r"^([a-z]{2,3}-[A-Z]{2})-(?:Chirp3-HD|Chirp-HD|Journey)-([A-Za-z]+)$"
)
_BCP_PREFIX_RE = re.compile(r"^([a-z]{2,3})-([A-Z]{2})-")
_KOKORO_RE = re.compile(r"^([abjz])([fm])_", re.IGNORECASE)
_INDICF5_RE = re.compile(r"^([A-Z]{3})_([FM])_")
_MINIMAX_LANG_RE = re.compile(r"^([A-Za-z]+)_")

_KOKORO_LANG = {"a": "en-US", "b": "en-GB", "j": "ja", "z": "zh"}
_INDICF5_LANG = {
    "HIN": "hi-IN", "PAN": "pa-IN", "TAM": "ta-IN", "TEL": "te-IN", "KAN": "kn-IN",
    "MAL": "ml-IN", "BEN": "bn-IN", "GUJ": "gu-IN", "MAR": "mr-IN", "ODI": "od-IN",
}
_LANGUAGE_WORDS = {v.lower(): k for k, v in LANGUAGE_NAMES.items() if len(k) == 2}

_FEMALE_WORDS = frozenset({"woman", "female", "lady", "girl"})
_MALE_WORDS = frozenset({"man", "male", "boy", "gentleman"})


def _gender_from_words(text: str) -> str | None:
    words = set(re.split(r"[^a-z]+", text.lower()))
    if words & _FEMALE_WORDS:
        return "female"
    if words & _MALE_WORDS:
        return "male"
    return None


def voice_metadata(
    provider: str, voice_id: str, provider_languages: list[str] | None = None
) -> tuple[str | None, str | None]:
    """Return ``(gender, language)`` for a voice. Either may be ``None``."""
    provider = provider.lower()
    lower = voice_id.lower()
    gender: str | None = _PROVIDER_VOICE_GENDERS_LOWER.get(provider, {}).get(lower)
    if gender is None:
        gender = GENDER_BY_VOICE.get(lower)
    language: str | None = None

    if m := _AURA_RE.match(voice_id):
        gender = gender or AURA_GENDER.get(m.group(1).lower())
        language = m.group(2).lower()
    elif m := _AZURE_RE.match(voice_id):
        gender = AZURE_GENDER.get(m.group(2).lower(), gender)
        language = m.group(1)
    elif m := _GOOGLE_RE.match(voice_id):
        gender = GOOGLE_GENDER.get(m.group(2).lower(), gender)
        language = m.group(1)
    elif m := _KOKORO_RE.match(voice_id):
        gender = "female" if m.group(2).lower() == "f" else "male"
        language = _KOKORO_LANG[m.group(1).lower()]
    elif m := _INDICF5_RE.match(voice_id):
        gender = "female" if m.group(2) == "F" else "male"
        language = _INDICF5_LANG.get(m.group(1), "hi-IN")
    elif m := _BCP_PREFIX_RE.match(voice_id):
        language = f"{m.group(1)}-{m.group(2)}"

    if gender is None:
        gender = _gender_from_words(voice_id)

    if language is None:
        if provider == "sarvam":
            language = "hi-IN"
        elif provider == "smallest":
            language = SMALLEST_VOICE_LANGUAGES.get(lower, "en-US")
        elif provider == "minimax" and (m := _MINIMAX_LANG_RE.match(voice_id)):
            language = _LANGUAGE_WORDS.get(m.group(1).lower(), "multi")
        elif provider in MULTILINGUAL_PROVIDERS:
            language = "multi"
        elif provider_languages and len(provider_languages) == 1:
            language = provider_languages[0]

    return gender, language


def voice_matches_language(provider: str, voice_language: str | None, target: str) -> bool:
    """Whether a voice should be offered for the selected ``target`` language.

    Voices with no known language, and multilingual voices, always match.
    Sarvam voices speak every Indian language; other providers' Indian voices
    (IndicF5, Azure, Google) are tied to a single language.
    """
    provider = provider.lower()
    if not voice_language or voice_language.lower() == "multi":
        return True
    if provider in MULTILINGUAL_PROVIDERS:
        return True
    target_base = _base_language(target)
    if target_base in {"multi", "auto", "unknown"}:
        return True
    if provider == "sarvam" and target_base in INDIAN_LANGUAGES:
        return True
    return _base_language(voice_language) == target_base


# ---------------------------------------------------------------------------
# Schema access
# ---------------------------------------------------------------------------

def _service_type(capability: str) -> ServiceType:
    values = {
        "stt": ServiceType.STT,
        "tts": ServiceType.TTS,
        "sts": ServiceType.REALTIME,
        "realtime": ServiceType.REALTIME,
    }
    try:
        return values[capability.lower()]
    except KeyError as exc:
        raise ValueError(f"Unsupported catalog capability: {capability}") from exc


def _schema(provider: str, capability: str) -> dict[str, Any]:
    service_type = _service_type(capability)
    model = REGISTRY[service_type].get(provider)
    if model is None:
        raise ValueError(f"Provider {provider!r} does not support {capability}")
    return model.model_json_schema()


def _property(schema: dict[str, Any], name: str) -> dict[str, Any] | None:
    value = schema.get("properties", {}).get(name)
    if isinstance(value, dict) and "$ref" in value:
        ref = value["$ref"].rsplit("/", 1)[-1]
        value = schema.get("$defs", {}).get(ref, value)
    return value if isinstance(value, dict) else None


def _option_values(prop: dict[str, Any], model: str | None) -> list[str]:
    values = prop.get("model_options", {}).get(model) if model else None
    values = values or prop.get("enum") or prop.get("examples") or []
    return [str(v) for v in dict.fromkeys(values)]


def list_languages(provider: str, capability: str, model: str | None = None) -> list[Locale]:
    prop = _property(_schema(provider, capability), "language")
    if not prop:
        return []
    return [get_locale(code) for code in _option_values(prop, model)]


@dataclass(frozen=True)
class LanguageCatalog:
    """Everything the language picker needs for one provider + model."""

    provider: str
    capability: str
    model: str | None
    default: str | None
    auto_detect: bool
    allow_custom_input: bool
    total_languages: int
    total_options: int
    groups: list[LocaleGroup]
    note: str | None = None  # e.g. "the voice decides the language"
    source: str = "static"  # "live" when the list came from the provider's API
    fetched_at: Any = None  # datetime of the live list
    voice_counts: dict[str, int] | None = None  # code -> voices (live lists only)


def language_catalog(
    provider: str,
    capability: str,
    model: str | None = None,
    live: Mapping[str, Any] | None = None,
) -> LanguageCatalog:
    """Languages for a provider/model, counted and grouped for display.

    Sources, first match wins:
    1. ``live[model]``: the provider's API list for this model;
    2. ``live[""]``: the provider's API list for all its models;
    3. the static list in code, per model (``model_options``) or provider-wide.

    ``live`` maps model -> object with ``codes``, ``fetched_at`` and
    ``voice_counts`` (see ``language_sync.store``). Auto-detect stays offered
    when the static list has it, since provider listings don't include it.
    """
    schema = _schema(provider, capability)
    if not model:
        model_prop = _property(schema, "model")
        model = model_prop.get("default") if model_prop else None
    prop = _property(schema, "language")
    codes = _option_values(prop, model) if prop else []
    source, fetched_at, voice_counts = "static", None, None
    live_entry = (live or {}).get(model or "") or (live or {}).get("")
    if live_entry is not None and live_entry.codes:
        auto = [c for c in codes if get_locale(c).is_auto_detect]
        codes = auto + [c for c in live_entry.codes if c not in auto]
        source, fetched_at, voice_counts = "live", live_entry.fetched_at, live_entry.voice_counts
    default = prop.get("default") if prop else None
    if default is not None and codes and default not in codes:
        default = codes[0]
    total_languages, total_options = count_languages(codes)
    groups = group_locales(codes)
    return LanguageCatalog(
        provider=provider,
        capability=capability,
        model=model,
        default=default,
        auto_detect=any(get_locale(c).is_auto_detect for c in codes),
        allow_custom_input=bool(prop and prop.get("allow_custom_input")),
        total_languages=total_languages,
        total_options=total_options,
        groups=groups,
        note=prop.get("language_note") if prop else None,
        source=source,
        fetched_at=fetched_at,
        voice_counts=voice_counts,
    )


def list_voices(
    provider: str,
    capability: str,
    model: str | None = None,
    language: str | None = None,
) -> list[CatalogVoice]:
    """List voices with gender and language metadata.

    When ``language`` is given, only voices that can speak it are returned.
    If no voice matches, the full list is returned rather than nothing.
    """
    schema = _schema(provider, capability)
    prop = _property(schema, "voice")
    if not prop:
        return []
    lang_prop = _property(schema, "language")
    provider_languages = _option_values(lang_prop, model) if lang_prop else []

    voices = []
    for voice_id in _option_values(prop, model):
        gender, voice_lang = voice_metadata(provider, voice_id, provider_languages)
        voices.append(
            CatalogVoice(
                voice_id=voice_id,
                name=VOICE_DISPLAY_NAMES.get(voice_id) or voice_id.replace("_", " ").title(),
                gender=gender,
                language=voice_lang,
            )
        )

    if language:
        matching = [v for v in voices if voice_matches_language(provider, v.language, language)]
        if matching:
            return matching
    return voices


# ---------------------------------------------------------------------------
# Saved voices that a provider would reject
# ---------------------------------------------------------------------------

_REMOVED_DEEPGRAM_NAMES = (
    "achilles agave ajax alcyone antigone aphrodite arachne ares ariadne atalanta boreas "
    "calliope calypso cassandra castor cerberus ceres charon chiron circe clio cupid daedalus "
    "danae daphne deimos demeter dione dionysus echo eos epimetheus erato erebus eris eros "
    "eunomia euphrosyne europa euryale eurydice euterpe gaia ganymede glaucus hebe hecate "
    "helios hephaestus hercules hesperus hestia hippolyta hyacinth hygieia hypnos iapetus "
    "icarus io kronos lachesis leander leda lethe leto maia medea medusa melpomene mercury "
    "midas mnemosyne momus morpheus nemesis nereus nike notus nyx oceanus pan pegasus "
    "penelope persephone perseus phaethon phobos pollux polyhymnia polyphemus pomona "
    "poseidon priam prometheus proteus psyche quirinus rhadamanthus rhea scylla semele "
    "silvanus siren sisyphus somnus talia tantalus tartarus terpsichore tethys thanatos "
    "themis theseus tisiphone triton tyche uranus venus vulcan zephyrus"
)

# Voices that were once offered by mistake and don't exist at the provider.
# Configs saved with them are switched to the model's default voice at runtime.
INVALID_VOICES: dict[str, frozenset[str]] = {
    "soniox": frozenset({"Bryce", "Lia", "Alexander", "Emily", "James"}),
    "sarvam": frozenset({"amelia", "sophia"}),
    "deepgram": frozenset(f"aura-2-{n}-en" for n in _REMOVED_DEEPGRAM_NAMES.split()),
    "cartesia": frozenset(
        {
            "3faa81ae-d3d8-4ab1-9e44-e50e46d33c30",
            "829ccd10-f8b3-43be-b230-46d50f7b7737",
            "c45bc599-3874-4b53-9092-23c52a0951a3",
            "e9035768-f7bc-4f03-8176-0cb7884d08a6",
            "156fb8d2-335b-4950-9cb3-a2d33fad7773",
            "564757c2-1e94-4340-9a25-c6bf21098651",
        }
    ),
}


def resolve_voice(
    provider: str, capability: str, model: str | None, voice: str | None
) -> str | None:
    """Return a voice the provider will accept for ``model``.

    The voice is replaced with the model's default voice when it is:
    - a known-invalid voice (listed by mistake in the past), or
    - a catalog voice of this provider that belongs to a *different* model
      (e.g. a bulbul:v2 speaker used with bulbul:v3).
    Anything else, including custom/cloned voice IDs, is returned unchanged.
    """
    if not voice:
        return voice
    provider = str(getattr(provider, "value", provider)).lower()
    try:
        prop = _property(_schema(provider, capability), "voice")
    except ValueError:
        return voice
    if not prop:
        return voice

    model_options: dict[str, list[str]] = prop.get("model_options") or {}
    model_voices = model_options.get(model) if model else None
    default = prop.get("default")
    if model_voices:
        replacement = default if default in model_voices else model_voices[0]
    else:
        replacement = default

    if voice in INVALID_VOICES.get(provider, ()):
        return replacement or voice
    if model_voices and voice not in model_voices:
        other_models_voices = {v for voices in model_options.values() for v in voices}
        if voice in other_models_voices:
            return replacement or voice
    return voice


# ---------------------------------------------------------------------------
# Save-time check: is the chosen language supported by the chosen model?
# ---------------------------------------------------------------------------


def unsupported_language_message(
    provider: str,
    capability: str,
    model: str | None,
    language: str | None,
    live: Mapping[str, Any] | None = None,
) -> str | None:
    """Return why ``language`` can't be used with this provider/model, or None.

    Accepted:
    - any code the model offers (case-insensitive), including auto-detect;
    - when the field allows custom input, a regional variant of an offered
      language (``en-NZ`` when ``en-US`` is offered) - providers often accept
      more regions than we list.
    Anything else is rejected with the closest supported suggestion.
    """
    if not isinstance(language, str) or not language.strip():
        return None
    try:
        catalog = language_catalog(provider, capability, model, live=live)
    except ValueError:
        return None  # provider/capability without a language field
    codes = [l.code for g in catalog.groups for l in g.locales]
    if not codes:
        return None
    value = language.strip()
    if value.lower() in {c.lower() for c in codes}:
        return None

    target = get_locale(value)
    same_language = [
        l for g in catalog.groups for l in g.locales
        if not l.is_auto_detect and l.language == target.language
    ]
    if same_language and catalog.allow_custom_input and not target.is_auto_detect:
        return None

    where = f"{provider} ({catalog.model})" if catalog.model else provider
    if target.is_auto_detect:
        reason = f"Auto-detect isn't available for {where}."
    else:
        reason = f"{target.label} ({value}) isn't supported by {where}."
    suggestion = same_language[0] if same_language else (
        get_locale(catalog.default) if catalog.default else None
    )
    hint = f" Try {suggestion.label} ({suggestion.code})." if suggestion else ""
    count = catalog.total_languages
    available = f"{count} language is" if count == 1 else f"{count} languages are"
    return f"{reason}{hint} {available} available for this model."
