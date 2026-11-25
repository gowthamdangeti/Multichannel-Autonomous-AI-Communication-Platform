from api.services.configuration.locales import base_language_normalizer

SONIOX_STT_MODELS = (
    "stt-rt-v5",
    "stt-rt-v4",
    "stt-rt-v3",
    "stt-rt-v2",
    "stt-rt-v1",
)

# Soniox takes plain ISO 639-1 codes for both STT and TTS; it has no regional
# variants (en-US / en-GB / en-IN all behave as "en"). Source:
# https://soniox.com/docs/stt/concepts/supported-languages and
# https://soniox.com/docs/tts/concepts/supported-languages
SONIOX_LANGUAGES = (
    "af", "ar", "az", "be", "bg", "bn", "bs", "ca", "cs", "cy",
    "da", "de", "el", "en", "es", "et", "eu", "fa", "fi", "fr",
    "gl", "gu", "he", "hi", "hr", "hu", "id", "it", "ja", "kk",
    "kn", "ko", "lt", "lv", "mk", "ml", "mr", "ms", "nl", "no",
    "pa", "pl", "pt", "ro", "ru", "sk", "sl", "sq", "sr", "sv",
    "sw", "ta", "te", "th", "tl", "tr", "uk", "ur", "vi", "zh",
)

# "auto" leaves out language hints so Soniox detects the language itself.
SONIOX_STT_LANGUAGES = ("auto", *SONIOX_LANGUAGES)

SONIOX_TTS_MODELS = (
    "tts-rt-v2",
    "tts-rt-v1",
)

# Voice names from Soniox docs (GET https://api.soniox.com/v1/tts-models lists them per model).
# Names are case-sensitive. Adrian is the Soniox/pipecat default.
SONIOX_TTS_VOICE_GENDERS: dict[str, str] = {
    "Adrian": "male",
    "Daniel": "male",
    "Noah": "male",
    "Jack": "male",
    "Owen": "male",
    "Kenji": "male",
    "Rafael": "male",
    "Mateo": "male",
    "Oliver": "male",
    "Arthur": "male",
    "Cooper": "male",
    "Mason": "male",
    "Arjun": "male",
    "Rohan": "male",
    "Maya": "female",
    "Nina": "female",
    "Emma": "female",
    "Claire": "female",
    "Grace": "female",
    "Mina": "female",
    "Lucia": "female",
    "Sofia": "female",
    "Isla": "female",
    "Victoria": "female",
    "Ruby": "female",
    "Elise": "female",
    "Priya": "female",
    "Meera": "female",
}

SONIOX_TTS_VOICES = tuple(SONIOX_TTS_VOICE_GENDERS)

SONIOX_TTS_LANGUAGES = SONIOX_LANGUAGES



# Maps saved regional codes ("en-US", "hi-IN") to the plain code Soniox uses.
normalize_soniox_language = base_language_normalizer(SONIOX_LANGUAGES, auto_value="auto")
