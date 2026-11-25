"""Languages for Whisper-family speech models.

Used by OpenAI (gpt-4o-transcribe, TTS, and realtime transcription), Cartesia
ink-whisper, and Hugging Face Whisper models. These models take plain ISO
639-1 codes and have no regional variants. Matches pipecat's
``language_to_whisper_language`` map and
https://platform.openai.com/docs/guides/speech-to-text#supported-languages
"""

WHISPER_LANGUAGES = (
    "af", "ar", "hy", "az", "be", "bs", "bg", "ca", "zh", "hr",
    "cs", "da", "nl", "en", "et", "fi", "fr", "gl", "de", "el",
    "he", "hi", "hu", "is", "id", "it", "ja", "kn", "kk", "ko",
    "lv", "lt", "mk", "ms", "mr", "mi", "ne", "no", "fa", "pl",
    "pt", "ro", "ru", "sr", "sk", "sl", "es", "sw", "sv", "tl",
    "ta", "th", "tr", "uk", "ur", "vi", "cy",
)
