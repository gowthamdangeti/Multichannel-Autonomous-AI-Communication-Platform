// Display names for language codes, used where the languages API isn't (recordings, admin).
// The language picker gets names, groups and counts from the backend instead.
// A plain code ("en") is the language itself; regional codes ("en-IN") name the country.
export const LANGUAGE_DISPLAY_NAMES: Record<string, string> = {
    "multi": "Multilingual (Auto-detect)",
    "auto": "Auto-detect",
    "unknown": "Auto-detect",

    // Indian Regional Languages (Full structured names)
    "en-IN": "English (India)",
    "hi": "Hindi",
    "hi-IN": "Hindi (India)",
    "ta": "Tamil",
    "ta-IN": "Tamil (India)",
    "te": "Telugu",
    "te-IN": "Telugu (India)",
    "kn": "Kannada",
    "kn-IN": "Kannada (India)",
    "bn": "Bengali",
    "bn-IN": "Bengali (India)",
    "bn-BD": "Bengali (Bangladesh)",
    "gu": "Gujarati",
    "gu-IN": "Gujarati (India)",
    "mr": "Marathi",
    "mr-IN": "Marathi (India)",
    "ml": "Malayalam",
    "ml-IN": "Malayalam (India)",
    "pa": "Punjabi",
    "pa-IN": "Punjabi (India)",
    "or": "Odia",
    "od-IN": "Odia (India)",
    "as-IN": "Assamese (India)",
    "ur": "Urdu",
    "ur-IN": "Urdu (India)",
    "ur-PK": "Urdu (Pakistan)",
    "ne": "Nepali",
    "ne-IN": "Nepali (India)",
    "sa-IN": "Sanskrit (India)",
    "kok-IN": "Konkani (India)",
    "ks-IN": "Kashmiri (India)",
    "sd-IN": "Sindhi (India)",
    "sat-IN": "Santali (India)",
    "mni-IN": "Manipuri (India)",
    "brx-IN": "Bodo (India)",
    "mai-IN": "Maithili (India)",
    "doi-IN": "Dogri (India)",

    // English & Accents (Full structured names)
    "en": "English",
    "en-US": "English (US)",
    "en-GB": "English (UK)",
    "en-AU": "English (Australia)",
    "en-CA": "English (Canada)",
    "en-NZ": "English (New Zealand)",
    "en-IE": "English (Ireland)",
    "en-ZA": "English (South Africa)",
    "en-SG": "English (Singapore)",
    "en-PH": "English (Philippines)",

    // Spanish & Accents
    "es": "Spanish",
    "es-ES": "Spanish (Spain)",
    "es-419": "Spanish (Latin America)",
    "es-MX": "Spanish (Mexico)",
    "es-US": "Spanish (US)",
    "es-AR": "Spanish (Argentina)",
    "es-CO": "Spanish (Colombia)",
    "es-CL": "Spanish (Chile)",

    // French
    "fr": "French",
    "fr-FR": "French (France)",
    "fr-CA": "French (Canada)",
    "fr-CH": "French (Switzerland)",
    "fr-BE": "French (Belgium)",

    // German
    "de": "German",
    "de-DE": "German (Germany)",
    "de-CH": "German (Switzerland)",
    "de-AT": "German (Austria)",

    // Italian & Portuguese
    "it": "Italian",
    "it-IT": "Italian (Italy)",
    "pt": "Portuguese",
    "pt-BR": "Portuguese (Brazil)",
    "pt-PT": "Portuguese (Portugal)",

    // Other European Languages
    "nl": "Dutch",
    "nl-NL": "Dutch (Netherlands)",
    "nl-BE": "Flemish (Belgium)",
    "pl": "Polish",
    "pl-PL": "Polish (Poland)",
    "ru": "Russian",
    "ru-RU": "Russian (Russia)",
    "uk": "Ukrainian",
    "uk-UA": "Ukrainian (Ukraine)",
    "sv": "Swedish",
    "sv-SE": "Swedish (Sweden)",
    "da": "Danish",
    "da-DK": "Danish (Denmark)",
    "no": "Norwegian",
    "nb-NO": "Norwegian Bokmål",
    "fi": "Finnish",
    "fi-FI": "Finnish (Finland)",
    "el": "Greek",
    "el-GR": "Greek (Greece)",
    "cs": "Czech",
    "cs-CZ": "Czech (Czechia)",
    "sk": "Slovak",
    "sk-SK": "Slovak (Slovakia)",
    "hu": "Hungarian",
    "hu-HU": "Hungarian (Hungary)",
    "ro": "Romanian",
    "ro-RO": "Romanian (Romania)",
    "bg": "Bulgarian",
    "bg-BG": "Bulgarian (Bulgaria)",
    "hr": "Croatian",
    "hr-HR": "Croatian (Croatia)",
    "sr": "Serbian",
    "sr-RS": "Serbian (Serbia)",
    "sl": "Slovenian",
    "sl-SI": "Slovenian (Slovenia)",
    "ca": "Catalan",
    "ca-ES": "Catalan (Spain)",
    "be": "Belarusian",
    "be-BY": "Belarusian (Belarus)",
    "bs": "Bosnian",
    "bs-BA": "Bosnian (Bosnia)",
    "et": "Estonian",
    "et-EE": "Estonian",
    "lv": "Latvian",
    "lv-LV": "Latvian",
    "lt": "Lithuanian",
    "lt-LT": "Lithuanian",
    "af": "Afrikaans",
    "af-ZA": "Afrikaans (South Africa)",
    "sq": "Albanian",
    "sq-AL": "Albanian (Albania)",
    "az": "Azerbaijani",
    "az-AZ": "Azerbaijani (Azerbaijan)",
    "eu": "Basque",
    "eu-ES": "Basque (Spain)",
    "gl": "Galician",
    "gl-ES": "Galician (Spain)",
    "kk": "Kazakh",
    "kk-KZ": "Kazakh (Kazakhstan)",
    "mk": "Macedonian",
    "mk-MK": "Macedonian (North Macedonia)",
    "cy": "Welsh",
    "cy-GB": "Welsh (UK)",

    // Asian Languages
    "ja": "Japanese",
    "ja-JP": "Japanese (Japan)",
    "ko": "Korean",
    "ko-KR": "Korean (South Korea)",
    "zh": "Chinese",
    "zh-CN": "Chinese (Simplified)",
    "zh-TW": "Chinese (Traditional)",
    "cmn-CN": "Mandarin (China)",
    "yue-HK": "Cantonese (Hong Kong)",
    "vi": "Vietnamese",
    "vi-VN": "Vietnamese (Vietnam)",
    "th": "Thai",
    "th-TH": "Thai (Thailand)",
    "id": "Indonesian",
    "id-ID": "Indonesian (Indonesia)",
    "ms": "Malay",
    "ms-MY": "Malay (Malaysia)",
    "fil": "Filipino",
    "tl": "Tagalog",

    // Middle Eastern & African
    "ar": "Arabic",
    "ar-SA": "Arabic (Saudi Arabia)",
    "ar-AE": "Arabic (UAE)",
    "ar-EG": "Arabic (Egypt)",
    "ar-QA": "Arabic (Qatar)",
    "ar-KW": "Arabic (Kuwait)",
    "ar-MA": "Arabic (Morocco)",
    "ar-IQ": "Arabic (Iraq)",
    "ar-XA": "Arabic (Regional)",
    "he": "Hebrew",
    "he-IL": "Hebrew (Israel)",
    "fa": "Persian",
    "tr": "Turkish",
    "tr-TR": "Turkish (Turkey)",
    "sw": "Swahili",
    "sw-KE": "Swahili (Kenya)",
};

// Case-insensitive lookup helper that returns the full, proper language name
export function getLanguageDisplayName(code?: string | null): string {
    if (!code) return "";
    const clean = code.trim();
    if (LANGUAGE_DISPLAY_NAMES[clean]) return LANGUAGE_DISPLAY_NAMES[clean];

    const lower = clean.toLowerCase();
    if (LANGUAGE_DISPLAY_NAMES[lower]) return LANGUAGE_DISPLAY_NAMES[lower];

    // Case-insensitive match across all keys
    for (const [k, v] of Object.entries(LANGUAGE_DISPLAY_NAMES)) {
        if (k.toLowerCase() === lower) return v;
    }

    // Any other code: language name from Intl, plus region, e.g. "fil-PH" -> "Filipino (PH)"
    const { name, countryCode } = getLanguageNameAndCountry(clean);
    const region = clean.includes("_") ? "" : parseLanguageCode(clean).region;
    return region && countryCode ? `${name} (${countryCode})` : name;
}

// Codes that Intl.DisplayNames doesn't know (non-standard or provider-specific).
const CUSTOM_LANGUAGE_NAMES: Record<string, string> = {
    od: "Odia",
    jw: "Javanese",
    multi: "Multilingual (auto-detect)",
    auto: "Auto-detect",
    unknown: "Auto-detect",
};

let intlLanguageNames: Intl.DisplayNames | null | undefined;

function intlLanguageName(code: string): string | null {
    if (intlLanguageNames === undefined) {
        try {
            intlLanguageNames = new Intl.DisplayNames(["en"], { type: "language", fallback: "none" });
        } catch {
            intlLanguageNames = null;
        }
    }
    if (!intlLanguageNames) return null;
    try {
        return intlLanguageNames.of(code) ?? null;
    } catch {
        return null;
    }
}

/** Parse "cmn-Hans-CN" / "hi-in" / "ss-Latn-ZA" into language, script and region subtags. */
function parseLanguageCode(code: string): { language: string; script: string; region: string } {
    const parts = code.trim().split("-");
    const language = parts[0].toLowerCase();
    let script = "";
    let region = "";
    for (const part of parts.slice(1)) {
        if (/^[a-z]{4}$/i.test(part)) script = part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
        else if (/^[a-z]{2}$/i.test(part) || /^\d{3}$/.test(part)) region = part.toUpperCase();
    }
    return { language, script, region };
}

function stripRegion(name: string): string {
    return name.includes(" (") ? name.split(" (")[0].trim() : name;
}

/** Language name without region, e.g. "te-IN" -> "Telugu", "cmn-Hans-CN" -> "Mandarin Chinese". */
function languageNameOnly(code: string): string {
    const clean = code.trim();
    const lower = clean.toLowerCase();
    // Mixed-language codes such as "ar_en" or "cmn_en_ms_ta" (code-switching models)
    if (clean.includes("_")) {
        return clean.split("_").map(languageNameOnly).join(" + ");
    }
    const known = LANGUAGE_DISPLAY_NAMES[clean] || LANGUAGE_DISPLAY_NAMES[lower];
    if (known) return stripRegion(known);
    const { language, script } = parseLanguageCode(clean);
    if (CUSTOM_LANGUAGE_NAMES[language]) return CUSTOM_LANGUAGE_NAMES[language];
    const baseKnown = LANGUAGE_DISPLAY_NAMES[language];
    if (baseKnown && !script) return stripRegion(baseKnown);
    return intlLanguageName(script ? `${language}-${script}` : language)
        ?? (baseKnown ? stripRegion(baseKnown) : clean);
}

// Extracts clean language name and country code (e.g. "te-IN" -> { name: "Telugu", countryCode: "IN" })
export function getLanguageNameAndCountry(code?: string | null): { name: string; countryCode: string } {
    if (!code) return { name: "", countryCode: "" };
    const clean = code.trim();
    const lower = clean.toLowerCase();
    const rawDisplayName = languageNameOnly(clean);

    let countryCode = clean.includes("_") ? "" : parseLanguageCode(clean).region;

    if (!countryCode && !clean.includes("_")) {
        const defaultCountries: Record<string, string> = {
            te: "IN",
            hi: "IN",
            ta: "IN",
            kn: "IN",
            bn: "IN",
            gu: "IN",
            mr: "IN",
            ml: "IN",
            pa: "IN",
            or: "IN",
            od: "IN",
            as: "IN",
            ur: "IN",
            sa: "IN",
            kok: "IN",
            ks: "IN",
            sd: "IN",
            en: "US",
            es: "ES",
            fr: "FR",
            de: "DE",
            it: "IT",
            ja: "JP",
            ko: "KR",
            zh: "CN",
            pt: "BR",
            ru: "RU",
            ar: "SA",
            id: "ID",
            nl: "NL",
            tr: "TR",
            pl: "PL",
            sv: "SE",
            vi: "VN",
            th: "TH",
            uk: "UA",
            el: "GR",
            cs: "CZ",
            da: "DK",
            fi: "FI",
            he: "IL",
            no: "NO",
            ro: "RO",
            hu: "HU",
            multi: "AUTO",
            auto: "AUTO",
        };
        countryCode = defaultCountries[lower] || "";
    }

    // Clean name: strip parenthesized region (e.g. "Telugu (India)" -> "Telugu", "English (US)" -> "English")
    let name = rawDisplayName;
    if (name.includes(" (")) {
        name = name.split(" (")[0].trim();
    }

    return {
        name: name || clean,
        countryCode: countryCode || "",
    };
}
