"""Master language registry.

One place that knows how to name and group every language code a provider
can offer. Provider modules only declare *which* codes they support; this
module turns a code into a ``Locale`` (English name, native name, country,
flag, display group) and groups a provider's codes for the language picker.

The ``code`` on a ``Locale`` is always the provider's own value, unchanged,
because that is what gets stored and sent at runtime. ``display_code`` is the
canonical BCP-47 spelling (``en-us`` -> ``en-US``) used only for display.
"""

from __future__ import annotations

from dataclasses import dataclass, field

# ---------------------------------------------------------------------------
# Names
# ---------------------------------------------------------------------------

LANGUAGE_NAMES: dict[str, str] = {
    "af": "Afrikaans", "am": "Amharic", "ar": "Arabic", "as": "Assamese",
    "az": "Azerbaijani", "ba": "Bashkir", "be": "Belarusian", "bg": "Bulgarian",
    "bn": "Bengali", "bo": "Tibetan", "br": "Breton", "bs": "Bosnian",
    "ca": "Catalan", "cs": "Czech", "cy": "Welsh", "da": "Danish",
    "de": "German", "el": "Greek", "en": "English", "eo": "Esperanto",
    "es": "Spanish", "et": "Estonian", "eu": "Basque", "fa": "Persian",
    "fi": "Finnish", "fil": "Filipino", "fo": "Faroese", "fr": "French",
    "ga": "Irish", "gl": "Galician", "gu": "Gujarati", "ha": "Hausa",
    "haw": "Hawaiian", "he": "Hebrew", "hi": "Hindi", "hr": "Croatian",
    "ht": "Haitian Creole", "hu": "Hungarian", "hy": "Armenian", "id": "Indonesian",
    "ig": "Igbo", "is": "Icelandic", "it": "Italian",
    "ja": "Japanese", "jw": "Javanese", "jv": "Javanese", "ka": "Georgian",
    "kk": "Kazakh", "km": "Khmer", "kn": "Kannada", "ko": "Korean",
    "ku": "Kurdish", "ky": "Kyrgyz", "la": "Latin", "lb": "Luxembourgish",
    "ln": "Lingala", "lo": "Lao", "lt": "Lithuanian", "lv": "Latvian",
    "mg": "Malagasy", "mi": "Maori", "mk": "Macedonian", "ml": "Malayalam",
    "mn": "Mongolian", "mr": "Marathi", "ms": "Malay", "mt": "Maltese",
    "my": "Burmese", "nb": "Norwegian Bokmål", "ne": "Nepali", "nl": "Dutch",
    "nn": "Norwegian Nynorsk", "no": "Norwegian", "oc": "Occitan", "od": "Odia",
    "or": "Odia", "pa": "Punjabi", "pl": "Polish", "ps": "Pashto",
    "pt": "Portuguese", "ro": "Romanian", "ru": "Russian", "rw": "Kinyarwanda",
    "sa": "Sanskrit", "sd": "Sindhi", "si": "Sinhala", "sk": "Slovak",
    "sl": "Slovenian", "sn": "Shona", "so": "Somali", "sq": "Albanian",
    "sr": "Serbian", "st": "Sesotho", "su": "Sundanese", "sv": "Swedish",
    "sw": "Swahili", "ta": "Tamil", "te": "Telugu", "tg": "Tajik",
    "th": "Thai", "tk": "Turkmen", "tl": "Tagalog", "tr": "Turkish",
    "tt": "Tatar", "ug": "Uyghur", "uk": "Ukrainian", "ur": "Urdu",
    "uz": "Uzbek", "vi": "Vietnamese", "xh": "Xhosa", "yi": "Yiddish",
    "yo": "Yoruba", "yue": "Cantonese", "zh": "Chinese", "zu": "Zulu",
    # Three-letter and provider-specific codes
    "cmn": "Mandarin", "kok": "Konkani", "ks": "Kashmiri", "sat": "Santali",
    "mni": "Manipuri", "brx": "Bodo", "mai": "Maithili", "doi": "Dogri",
    "nan": "Min Nan", "wuu": "Wu Chinese", "ckb": "Central Kurdish",
}

# Less common and legacy codes. Kept out of LANGUAGE_NAMES so the reverse
# name -> code lookup used for voice metadata keeps preferring modern codes.
EXTRA_LANGUAGE_NAMES: dict[str, str] = {
    "iw": "Hebrew", "ast": "Asturian", "ceb": "Cebuano", "ff": "Fula",
    "ia": "Interlingua", "kam": "Kamba", "kea": "Kabuverdianu", "lg": "Ganda",
    "luo": "Luo", "nso": "Northern Sotho", "ny": "Nyanja", "om": "Oromo",
    "rup": "Aromanian", "ss": "Swati", "tn": "Tswana", "ts": "Tsonga",
    "umb": "Umbundu", "ve": "Venda", "wo": "Wolof", "iu": "Inuktitut",
    "qu": "Quechua", "gn": "Guarani", "ay": "Aymara", "nv": "Navajo",
}

NATIVE_NAMES: dict[str, str] = {
    "ar": "العربية", "as": "অসমীয়া", "bg": "Български", "bn": "বাংলা",
    "ca": "Català", "cs": "Čeština", "da": "Dansk", "de": "Deutsch",
    "el": "Ελληνικά", "en": "English", "es": "Español", "et": "Eesti",
    "fa": "فارسی", "fi": "Suomi", "fil": "Filipino", "fr": "Français",
    "gu": "ગુજરાતી", "he": "עברית", "hi": "हिन्दी", "hr": "Hrvatski",
    "hu": "Magyar", "id": "Bahasa Indonesia", "it": "Italiano", "ja": "日本語",
    "kn": "ಕನ್ನಡ", "ko": "한국어", "lt": "Lietuvių", "lv": "Latviešu",
    "ml": "മലയാളം", "mr": "मराठी", "ms": "Bahasa Melayu", "ne": "नेपाली",
    "nl": "Nederlands", "no": "Norsk", "od": "ଓଡ଼ିଆ", "or": "ଓଡ଼ିଆ",
    "pa": "ਪੰਜਾਬੀ", "pl": "Polski", "pt": "Português", "ro": "Română",
    "ru": "Русский", "sa": "संस्कृतम्", "sk": "Slovenčina", "sl": "Slovenščina",
    "sr": "Српски", "sv": "Svenska", "sw": "Kiswahili", "ta": "தமிழ்",
    "te": "తెలుగు", "th": "ไทย", "tl": "Tagalog", "tr": "Türkçe",
    "uk": "Українська", "ur": "اردو", "vi": "Tiếng Việt", "zh": "中文",
    "cmn": "普通话", "yue": "粵語", "kok": "कोंकणी", "mai": "मैथिली",
}

REGION_NAMES: dict[str, str] = {
    "AE": "UAE", "AF": "Afghanistan", "AO": "Angola", "CV": "Cape Verde",
    "MW": "Malawi", "SN": "Senegal", "UG": "Uganda", "AL": "Albania", "AM": "Armenia",
    "AR": "Argentina", "AT": "Austria", "AU": "Australia", "AZ": "Azerbaijan",
    "BA": "Bosnia", "BD": "Bangladesh", "BE": "Belgium", "BG": "Bulgaria",
    "BH": "Bahrain", "BO": "Bolivia", "BR": "Brazil", "BY": "Belarus",
    "CA": "Canada", "CH": "Switzerland", "CL": "Chile", "CN": "China",
    "CO": "Colombia", "CR": "Costa Rica", "CU": "Cuba", "CY": "Cyprus",
    "CZ": "Czechia", "DE": "Germany", "DK": "Denmark", "DO": "Dominican Republic",
    "DZ": "Algeria", "EC": "Ecuador", "EE": "Estonia", "EG": "Egypt",
    "ES": "Spain", "ET": "Ethiopia", "FI": "Finland", "FR": "France",
    "GB": "UK", "GE": "Georgia", "GH": "Ghana", "GQ": "Equatorial Guinea",
    "GR": "Greece", "GT": "Guatemala", "HK": "Hong Kong", "HN": "Honduras",
    "HR": "Croatia", "HU": "Hungary", "ID": "Indonesia", "IE": "Ireland",
    "IL": "Israel", "IN": "India", "IQ": "Iraq", "IR": "Iran",
    "IS": "Iceland", "IT": "Italy", "JO": "Jordan", "JP": "Japan",
    "KE": "Kenya", "KH": "Cambodia", "KR": "South Korea", "KW": "Kuwait",
    "KZ": "Kazakhstan", "LA": "Laos", "LB": "Lebanon", "LK": "Sri Lanka",
    "LT": "Lithuania", "LU": "Luxembourg", "LV": "Latvia", "LY": "Libya",
    "MA": "Morocco", "MK": "North Macedonia", "MM": "Myanmar", "MN": "Mongolia",
    "MT": "Malta", "MX": "Mexico", "MY": "Malaysia", "NG": "Nigeria",
    "NI": "Nicaragua", "NL": "Netherlands", "NO": "Norway", "NP": "Nepal",
    "NZ": "New Zealand", "OM": "Oman", "PA": "Panama", "PE": "Peru",
    "PH": "Philippines", "PK": "Pakistan", "PL": "Poland", "PR": "Puerto Rico",
    "PS": "Palestine", "PT": "Portugal", "PY": "Paraguay", "QA": "Qatar",
    "RO": "Romania", "RS": "Serbia", "RU": "Russia", "RW": "Rwanda",
    "SA": "Saudi Arabia", "SE": "Sweden", "SG": "Singapore", "SI": "Slovenia",
    "SK": "Slovakia", "SO": "Somalia", "SV": "El Salvador", "SY": "Syria",
    "TH": "Thailand", "TN": "Tunisia", "TR": "Turkey", "TW": "Taiwan",
    "TZ": "Tanzania", "UA": "Ukraine", "US": "US", "UY": "Uruguay",
    "UZ": "Uzbekistan", "VE": "Venezuela", "VN": "Vietnam", "XA": "Regional",
    "YE": "Yemen", "ZA": "South Africa", "ZW": "Zimbabwe", "419": "Latin America",
}

SCRIPT_NAMES: dict[str, str] = {
    "Hans": "Simplified", "Hant": "Traditional", "Latn": "Latin",
    "Cyrl": "Cyrillic", "Arab": "Arabic", "Deva": "Devanagari", "Cans": "Syllabics",
}

RTL_LANGUAGES = frozenset({"ar", "fa", "he", "iw", "ur", "ps", "sd", "yi", "ug", "ckb", "ks"})

# Codes providers use to mean "detect the language automatically".
AUTO_DETECT_CODES = frozenset({"auto", "multi", "unknown", "mul"})

# ---------------------------------------------------------------------------
# Display groups (order here is the order shown in the picker)
# ---------------------------------------------------------------------------

GROUP_LABELS: dict[str, str] = {
    "auto": "Auto-detect",
    "indian": "Indian languages",
    "english": "English",
    "european": "European languages",
    "asian": "Asian & Pacific languages",
    "middle_east_africa": "Middle East & African languages",
    "americas": "Indigenous languages of the Americas",
    "mixed": "Mixed-language (code-switching)",
    "other": "Other languages",
}

_INDIAN = frozenset({
    "hi", "ta", "te", "kn", "bn", "gu", "mr", "ml", "pa", "or", "od", "as", "ur",
    "sa", "ne", "kok", "ks", "sd", "sat", "mni", "brx", "mai", "doi",
})
_EUROPEAN = frozenset({
    "be", "bg", "br", "bs", "ca", "cs", "cy", "da", "de", "el", "eo", "es", "et",
    "eu", "fi", "fo", "fr", "ga", "gl", "hr", "hu", "hy", "is", "it", "ka", "la",
    "lb", "lt", "lv", "mk", "mt", "nb", "nl", "nn", "no", "oc", "pl", "pt", "ro",
    "ru", "sk", "sl", "sq", "sr", "sv", "uk", "az", "tt", "ba", "ast", "rup", "ia",
})
_ASIAN = frozenset({
    "ja", "ko", "zh", "cmn", "yue", "nan", "wuu", "vi", "th", "id", "ms", "fil",
    "tl", "jv", "jw", "su", "km", "lo", "my", "mn", "si", "bo", "kk", "ky", "tg",
    "tk", "uz", "ug", "mi", "haw", "ceb",
})
_AMERICAS = frozenset({"iu", "qu", "gn", "ay", "nv"})
_MIDDLE_EAST_AFRICA = frozenset({
    "ar", "he", "fa", "tr", "ps", "ku", "ckb", "yi", "af", "am", "ha", "ig",
    "ln", "mg", "rw", "sn", "so", "st", "sw", "xh", "yo", "zu", "ht", "iw",
    "ff", "kam", "kea", "lg", "luo", "nso", "ny", "om", "ss", "tn", "ts", "umb",
    "ve", "wo",
})


def _group_for(language: str, is_auto: bool, is_mixed: bool) -> str:
    if is_auto:
        return "auto"
    if is_mixed:
        return "mixed"
    if language == "en":
        return "english"
    if language in _INDIAN:
        return "indian"
    if language in _EUROPEAN:
        return "european"
    if language in _ASIAN:
        return "asian"
    if language in _MIDDLE_EAST_AFRICA:
        return "middle_east_africa"
    if language in _AMERICAS:
        return "americas"
    return "other"


# ---------------------------------------------------------------------------
# Locale
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Locale:
    code: str  # the provider's value, unchanged
    display_code: str  # canonical spelling for display, e.g. "en-US"
    language: str  # base language subtag, e.g. "en"
    script: str | None
    region: str | None  # "IN", "419", ...
    language_name: str  # "English"
    region_name: str | None  # "India"
    label: str  # "English (India)"
    native_name: str | None
    flag: str | None
    group: str
    direction: str = "ltr"
    is_auto_detect: bool = False

    # Backwards-compatible names used by older callers.
    @property
    def name(self) -> str:
        return self.label

    @property
    def base_language(self) -> str:
        return self.language

    @property
    def source(self) -> str:
        return "static"

    @property
    def is_selectable(self) -> bool:
        return True


def flag_for_region(region: str | None) -> str | None:
    """Regional-indicator flag emoji for a two-letter country code."""
    if not region or len(region) != 2 or not region.isalpha():
        return None
    return "".join(chr(0x1F1E6 + ord(c) - ord("A")) for c in region.upper())


def _split(code: str) -> tuple[str, str | None, str | None]:
    parts = code.strip().replace("_", "-").split("-")
    language = parts[0].lower()
    script = region = None
    for part in parts[1:]:
        if len(part) == 4 and part.isalpha():
            script = part.title()
        elif (len(part) == 2 and part.isalpha()) or (len(part) == 3 and part.isdigit()):
            region = part.upper()
    return language, script, region


def _is_mixed(code: str) -> bool:
    """Code-switching codes such as ``ar_en`` or ``cmn_en_ms_ta``."""
    if "_" not in code:
        return False
    parts = code.split("_")
    return len(parts) > 1 and all(p.isalpha() and p.islower() and 2 <= len(p) <= 3 for p in parts)


def language_name(language: str) -> str:
    key = language.lower()
    return LANGUAGE_NAMES.get(key) or EXTRA_LANGUAGE_NAMES.get(key) or language


def canonical_code(code: str) -> str:
    """``en_us`` / ``EN-us`` -> ``en-US``; ``cmn-hans-cn`` -> ``cmn-Hans-CN``."""
    clean = code.strip()
    if clean.lower() in AUTO_DETECT_CODES or _is_mixed(clean):
        return clean.lower()
    language, script, region = _split(clean)
    return "-".join(p for p in (language, script, region) if p)


def get_locale(code: str) -> Locale:
    clean = code.strip()
    lower = clean.lower()

    if lower in AUTO_DETECT_CODES:
        label = "Multilingual (auto-detect)" if lower == "multi" else "Auto-detect"
        return Locale(
            code=clean, display_code=lower, language=lower, script=None, region=None,
            language_name=label, region_name=None, label=label, native_name=None,
            flag="🌐", group="auto", is_auto_detect=True,
        )

    if _is_mixed(clean):
        parts = clean.split("_")
        label = " + ".join(language_name(p) for p in parts)
        return Locale(
            code=clean, display_code=lower, language=parts[0], script=None, region=None,
            language_name=label, region_name=None, label=label, native_name=None,
            flag=None, group="mixed",
        )

    language, script, region = _split(clean)
    lang_name = language_name(language)
    region_name = REGION_NAMES.get(region, region) if region else None
    qualifiers = [q for q in (SCRIPT_NAMES.get(script, script) if script else None, region_name) if q]
    label = f"{lang_name} ({', '.join(qualifiers)})" if qualifiers else lang_name
    return Locale(
        code=clean,
        display_code=canonical_code(clean),
        language=language,
        script=script,
        region=region,
        language_name=lang_name,
        region_name=region_name,
        label=label,
        native_name=NATIVE_NAMES.get(language),
        flag=flag_for_region(region),
        group=_group_for(language, False, False),
        direction="rtl" if language in RTL_LANGUAGES else "ltr",
    )


# ---------------------------------------------------------------------------
# Grouping for the picker
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class LocaleGroup:
    id: str
    label: str
    locales: list[Locale] = field(default_factory=list)

    @property
    def count(self) -> int:
        return len(self.locales)


def group_locales(codes: list[str]) -> list[LocaleGroup]:
    """Group codes for display; duplicates (case-insensitive) are dropped.

    Within a group, locales are sorted by label, so the regional variants of
    one language (English (India), English (UK), English (US)) sit together.
    """
    seen: set[str] = set()
    by_group: dict[str, list[Locale]] = {}
    for code in codes:
        if not code or code.lower() in seen:
            continue
        seen.add(code.lower())
        locale = get_locale(code)
        by_group.setdefault(locale.group, []).append(locale)

    groups = []
    for group_id, label in GROUP_LABELS.items():
        locales = by_group.get(group_id)
        if not locales:
            continue
        if group_id != "auto":
            locales = sorted(locales, key=lambda l: (l.language_name, l.region_name or ""))
        groups.append(LocaleGroup(id=group_id, label=label, locales=locales))
    return groups


def count_languages(codes: list[str]) -> tuple[int, int]:
    """Return ``(distinct languages, selectable options)``, ignoring auto-detect."""
    locales = [get_locale(c) for c in dict.fromkeys(codes) if c]
    real = [l for l in locales if not l.is_auto_detect]
    distinct = {l.code.lower() if l.group == "mixed" else l.language for l in real}
    return len(distinct), len(real)


def base_codes(codes) -> tuple[str, ...]:
    """``("en-US", "en-GB", "hi-IN")`` -> ``("en", "hi")``, order kept."""
    return tuple(
        dict.fromkeys(
            c if c.lower() in AUTO_DETECT_CODES else c.replace("_", "-").split("-")[0].lower()
            for c in codes
        )
    )


# ---------------------------------------------------------------------------
# Saved-value normalization for language-only providers
# ---------------------------------------------------------------------------


def base_language_normalizer(allowed, auto_value: str | None = None):
    """Build a pydantic ``mode="before"`` validator for a language field.

    Providers such as Soniox, Whisper models and MiniMax only take a plain
    language (``en``), but older configs stored regional codes (``en-US``,
    ``hi-IN``). The validator maps those to the plain code when it is
    supported, maps auto-detect spellings to ``auto_value`` when the provider
    has one, and leaves anything else untouched so custom input still works.
    """
    allowed_set = frozenset(allowed)

    def normalize(value):
        if not isinstance(value, str) or not value.strip():
            return value
        clean = value.strip()
        if clean.lower() in AUTO_DETECT_CODES:
            return auto_value or clean
        base = clean.replace("_", "-").split("-")[0].lower()
        return base if base in allowed_set else clean

    return normalize
