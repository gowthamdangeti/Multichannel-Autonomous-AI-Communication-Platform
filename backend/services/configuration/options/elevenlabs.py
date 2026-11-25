from api.services.configuration.locales import base_codes

# pipecat sends ElevenLabs plain languages (use_base_code=True), so regional
# variants are collapsed.
ELEVENLABS_TTS_MODELS = (
    "eleven_flash_v2_5",
    "eleven_multilingual_v2",
    "eleven_turbo_v2_5",
    "eleven_flash_v2",
    "eleven_turbo_v2",
    "eleven_monolingual_v1",
)

ELEVENLABS_TTS_VOICES = (
    "21m00Tcm4TlvDq8ikWAM",  # Rachel - Calm, American female
    "AZnzlk1XvdvUeBnXmlld",  # Domi - Strong, American female
    "EXAVITQu4vr4xnSDxMaL",  # Sarah - Soft, American female
    "ErXwobaYiN019PkySvjV",  # Antoni - Well-rounded, American male
    "MF3mGyEYCl7XYWbV9V6O",  # Elli - Emotional, American female
    "TxGEqnHWrfWFTfGW9XjX",  # Josh - Deep, American male
    "VR6AewLTigWG4tlVwjdK",  # Arnold - Crisp, American male
    "pNInz6obpgDQGcFmaJgB",  # Adam - Deep, American male
    "yoZ06a0pkGbda9VNxB3S",  # Sam - Raspy, American male
    "onwK4e9ZLuTAKqWW03F9",  # Daniel - Authoritative, British male
    "pFZP5JQG7iQjIQuC4Bku",  # Lily - Warm, British female
    "ThT5KcBeYPX3keUQqHPh",  # Dorothy - Pleasant, British female
    "LcfcDJNigLHyBiGajdjz",  # Emily - Calm, American female
    "jsCqWAovK2LkecY7zXl4",  # Freya - Expressive, American female
    "z9fAnlkpzviPz146aGWa",  # Glinda - Warm, American female
    "oWAxZDxUHUwScMcUqPjm",  # Grace - Gentle, Southern American female
    "bIHbv24MWmeRgasZH58o",  # Will - Friendly, American male
    "flq6f7yk4E4fJM5XTYuZ",  # Michael - Natural, American male
    "g5CIjZEefAph4nQFvHAz",  # Ethan - Whisper, American male
    "IKne3meq5aSn9XLyUdCD",  # Charlie - Casual, Australian male
    "JBFqnCBsd6RMkjVDRZzb",  # George - Raspy, British male
    "N2lVS1w4EtoT3dr4eOWO",  # Callum - Intense, Transatlantic male
    "XB0fDUnXU5powFXDhCwa",  # Charlotte - Seductive, Swedish female
    "Xb7hH8MSUJpSbSDYk0k2",  # Alice - Confident, British female
    "XrExE9yKIg1WjnnlVkGX",  # Matilda - Warm, American female
    "bVMeCyTHy58xNoL34h3p",  # Jeremy - Excited, Irish-American male
    "cjVigY5qzO86Huf0OWal",  # Eric - Conversational, American male
    "iP95p4xoKVk53GoZ742B",  # Chris - Casual, American male
    "nPczCjzI2devNBz1zQrb",  # Brian - Deep, American male
    "pqHfZKP75CvOlQylNhV4",  # Bill - Trustworthy, American male
)

ELEVENLABS_TTS_LANGUAGES_MULTILINGUAL = base_codes((
    "en-US",
    "en-GB",
    "en-AU",
    "en-IN",
    "hi-IN",
    "ja-JP",
    "zh-CN",
    "de-DE",
    "fr-FR",
    "fr-CA",
    "ko-KR",
    "pt-BR",
    "pt-PT",
    "it-IT",
    "es-ES",
    "es-MX",
    "id-ID",
    "nl-NL",
    "tr-TR",
    "fil-PH",
    "pl-PL",
    "sv-SE",
    "bg-BG",
    "ro-RO",
    "ar-SA",
    "ar-AE",
    "cs-CZ",
    "el-GR",
    "fi-FI",
    "hr-HR",
    "ms-MY",
    "sk-SK",
    "da-DK",
    "ta-IN",
    "te-IN",
    "uk-UA",
    "ru-RU",
    "hu-HU",
    "no-NO",
    "vi-VN",
))

ELEVENLABS_TTS_LANGUAGES_MONOLINGUAL = base_codes((
    "en-US",
))
