"""MiniMax TTS languages.

MiniMax takes a ``language_boost`` name ("English", "Hindi", ...) rather than a
code; pipecat's ``language_to_minimax_language`` does that conversion. This
list matches pipecat's map (40 languages) and
https://platform.minimax.io/docs/api-reference/speech-t2a-http
"""

MINIMAX_TTS_LANGUAGES = (
    "af", "ar", "bg", "ca", "cs", "da", "de", "el", "en", "es",
    "fa", "fi", "fil", "fr", "he", "hi", "hr", "hu", "id", "it",
    "ja", "ko", "ms", "nb", "nn", "nl", "pl", "pt", "ro", "ru",
    "sk", "sl", "sv", "ta", "th", "tr", "uk", "vi", "yue", "zh",
)
