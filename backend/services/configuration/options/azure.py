AZURE_MODELS = ["gpt-4.1-mini"]

AZURE_REALTIME_MODELS = ["gpt-4o-realtime-preview"]
AZURE_REALTIME_VOICES = [
    "alloy",
    "ash",
    "ballad",
    "coral",
    "echo",
    "sage",
    "shimmer",
    "verse",
]
AZURE_REALTIME_API_VERSIONS = [
    "2025-04-01-preview",
    "2024-10-01-preview",
    "2024-12-17",
]

AZURE_SPEECH_REGIONS = [
    "eastus",
    "eastus2",
    "westus",
    "westus2",
    "westus3",
    "centralus",
    "northcentralus",
    "southcentralus",
    "westcentralus",
    "westeurope",
    "northeurope",
    "uksouth",
    "ukwest",
    "francecentral",
    "switzerlandnorth",
    "germanywestcentral",
    "norwayeast",
    "australiaeast",
    "eastasia",
    "southeastasia",
    "japaneast",
    "japanwest",
    "koreacentral",
    "centralindia",
    "southindia",
    "brazilsouth",
]

# Current list plus every locale in pipecat's language_to_azure_language map.
AZURE_SPEECH_TTS_LANGUAGES = (
    "en-US", "en-GB", "en-AU", "en-CA", "en-IN", "en-IE", "en-NZ", "en-ZA",
    "en-SG", "en-PH", "hi-IN", "ta-IN", "te-IN", "bn-IN", "gu-IN", "mr-IN",
    "kn-IN", "ml-IN", "pa-IN", "ur-IN", "as-IN", "or-IN", "es-ES", "es-MX",
    "es-US", "es-AR", "es-CO", "es-CL", "fr-FR", "fr-CA", "fr-CH", "fr-BE",
    "de-DE", "de-AT", "de-CH", "it-IT", "it-CH", "pt-BR", "pt-PT", "ja-JP",
    "ko-KR", "zh-CN", "zh-HK", "zh-TW", "id-ID", "ms-MY", "th-TH", "vi-VN",
    "fil-PH", "ar-SA", "ar-AE", "ar-EG", "ar-QA", "he-IL", "nl-NL", "nl-BE",
    "pl-PL", "tr-TR", "sv-SE", "da-DK", "fi-FI", "nb-NO", "ru-RU", "uk-UA",
    "el-GR", "cs-CZ", "hu-HU", "ro-RO", "sk-SK", "bg-BG", "hr-HR", "af-ZA",
    "am-ET", "ar-BH", "ar-DZ", "ar-IQ", "ar-JO", "ar-KW", "ar-LB", "ar-LY",
    "ar-MA", "ar-OM", "ar-SY", "ar-TN", "ar-YE", "az-AZ", "bn-BD", "bs-BA",
    "ca-ES", "cy-GB", "en-HK", "en-KE", "en-NG", "en-TZ", "es-BO", "es-CR",
    "es-CU", "es-DO", "es-EC", "es-GQ", "es-GT", "es-HN", "es-NI", "es-PA",
    "es-PE", "es-PR", "es-PY", "es-SV", "es-UY", "es-VE", "et-EE", "eu-ES",
    "fa-IR", "ga-IE", "gl-ES", "hy-AM", "is-IS", "iu-Cans-CA", "iu-Latn-CA", "jv-ID",
    "ka-GE", "kk-KZ", "km-KH", "lo-LA", "lt-LT", "lv-LV", "mk-MK", "mn-MN",
    "mt-MT", "my-MM", "ne-NP", "ps-AF", "si-LK", "sl-SI", "so-SO", "sq-AL",
    "sr-RS", "sr-Latn-RS", "su-ID", "sw-KE", "sw-TZ", "ta-LK", "ta-MY", "ta-SG",
    "ur-PK", "uz-UZ", "wuu-CN", "yue-CN", "zh-CN-guangxi", "zh-CN-henan", "zh-CN-liaoning", "zh-CN-shaanxi",
    "zh-CN-shandong", "zh-CN-sichuan", "zu-ZA",
)

AZURE_SPEECH_TTS_VOICES = [
    # US English
    "en-US-AriaNeural",
    "en-US-GuyNeural",
    "en-US-JennyNeural",
    "en-US-DavisNeural",
    "en-US-AmberNeural",
    "en-US-AnaNeural",
    "en-US-AshleyNeural",
    "en-US-BrandonNeural",
    "en-US-ChristopherNeural",
    "en-US-ElizabethNeural",
    "en-US-EricNeural",
    "en-US-JacobNeural",
    "en-US-MichelleNeural",
    "en-US-MonicaNeural",
    "en-US-NancyNeural",
    "en-US-RogerNeural",
    "en-US-SaraNeural",
    "en-US-SteffanNeural",
    "en-US-TonyNeural",
    # UK & Australian English
    "en-GB-SoniaNeural",
    "en-GB-RyanNeural",
    "en-AU-NatashaNeural",
    "en-AU-WilliamNeural",
    # Indian English & Regional Indian Voices
    "en-IN-NeerjaNeural",
    "en-IN-PrabhatNeural",
    "hi-IN-SwaraNeural",
    "hi-IN-MadhurNeural",
    "ta-IN-PallaviNeural",
    "ta-IN-ValluvarNeural",
    "te-IN-ShrutiNeural",
    "te-IN-MohanNeural",
    "bn-IN-TanishaaNeural",
    "bn-IN-BashkarNeural",
    "gu-IN-DhwaniNeural",
    "gu-IN-NiranjanNeural",
    "mr-IN-AarohiNeural",
    "mr-IN-ManoharNeural",
    "kn-IN-SapnaNeural",
    "kn-IN-GaganNeural",
    "ml-IN-SobhanaNeural",
    "ml-IN-MidhunNeural",
    "pa-IN-OjasNeural",
    "pa-IN-VaaniNeural",
    "ur-IN-GulNeural",
    "ur-IN-SalmanNeural",
]

AZURE_SPEECH_STT_LANGUAGES = list(AZURE_SPEECH_TTS_LANGUAGES)

AZURE_EMBEDDING_MODELS = [
    "text-embedding-3-small",
    "text-embedding-ada-002",
]
