"""Sample text used to render voice previews.

The default sample is spoken in the voice's own language, so a Tamil voice is
previewed reading Tamil. This module is the single source of these sentences:
the UI receives them with the preview capabilities and never keeps a copy.
"""

from __future__ import annotations

from api.schemas.ai_model_configuration import MAX_VOICE_PREVIEW_TEXT_CHARS

# Rendered by every provider, so samples avoid markdown, emoji, and punctuation
# that some TTS engines read out loud. Each says the same thing as the English
# sample, worded so the speaker's grammatical gender never shows (Hindi,
# Marathi, Punjabi and Urdu use a passive form for that reason).
DEFAULT_SAMPLE_LANGUAGE = "en"

PREVIEW_SAMPLE_TEXTS: dict[str, str] = {
    "en": (
        "Hello, this is a preview of my voice. I can help you schedule "
        "appointments, answer questions, and follow up with your customers."
    ),
    "hi": (
        "नमस्ते, यह मेरी आवाज़ का एक नमूना है। अपॉइंटमेंट तय करने, सवालों के "
        "जवाब देने और आपके ग्राहकों से संपर्क बनाए रखने में मेरी मदद ली जा सकती है।"
    ),
    "ta": (
        "வணக்கம், இது என் குரலின் ஒரு மாதிரி. சந்திப்புகளைத் திட்டமிடவும், "
        "கேள்விகளுக்குப் பதிலளிக்கவும், உங்கள் வாடிக்கையாளர்களைத் தொடர்ந்து "
        "தொடர்புகொள்ளவும் நான் உதவ முடியும்."
    ),
    "te": (
        "నమస్కారం, ఇది నా గొంతు యొక్క ఒక నమూనా. అపాయింట్‌మెంట్‌లను షెడ్యూల్ "
        "చేయడంలో, ప్రశ్నలకు సమాధానం ఇవ్వడంలో మరియు మీ కస్టమర్‌లను ఫాలో అప్ "
        "చేయడంలో నేను సహాయం చేయగలను."
    ),
    "kn": (
        "ನಮಸ್ಕಾರ, ಇದು ನನ್ನ ಧ್ವನಿಯ ಒಂದು ಮಾದರಿ. ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್‌ಗಳನ್ನು "
        "ನಿಗದಿಪಡಿಸಲು, ಪ್ರಶ್ನೆಗಳಿಗೆ ಉತ್ತರಿಸಲು ಮತ್ತು ನಿಮ್ಮ ಗ್ರಾಹಕರನ್ನು "
        "ಸಂಪರ್ಕಿಸಲು ನಾನು ಸಹಾಯ ಮಾಡಬಲ್ಲೆ."
    ),
    "ml": (
        "നമസ്കാരം, ഇത് എന്റെ ശബ്ദത്തിന്റെ ഒരു മാതൃകയാണ്. അപ്പോയിന്റ്മെന്റുകൾ "
        "ഷെഡ്യൂൾ ചെയ്യാനും ചോദ്യങ്ങൾക്ക് ഉത്തരം നൽകാനും നിങ്ങളുടെ "
        "ഉപഭോക്താക്കളുമായി ബന്ധപ്പെടാനും എനിക്ക് സഹായിക്കാനാകും."
    ),
    "mr": (
        "नमस्कार, हा माझ्या आवाजाचा एक नमुना आहे. अपॉइंटमेंट ठरवणे, प्रश्नांची "
        "उत्तरे देणे आणि तुमच्या ग्राहकांशी संपर्क ठेवणे यासाठी माझी मदत घेता येईल."
    ),
    "bn": (
        "নমস্কার, এটি আমার কণ্ঠের একটি নমুনা। অ্যাপয়েন্টমেন্ট ঠিক করা, প্রশ্নের "
        "উত্তর দেওয়া এবং আপনার গ্রাহকদের সাথে যোগাযোগ রাখতে আমি সাহায্য করতে পারি।"
    ),
    "gu": (
        "નમસ્તે, આ મારા અવાજનો એક નમૂનો છે. એપોઇન્ટમેન્ટ નક્કી કરવામાં, "
        "પ્રશ્નોના જવાબ આપવામાં અને તમારા ગ્રાહકો સાથે સંપર્કમાં રહેવામાં "
        "હું મદદ કરી શકું છું."
    ),
    "pa": (
        "ਸਤ ਸ੍ਰੀ ਅਕਾਲ, ਇਹ ਮੇਰੀ ਆਵਾਜ਼ ਦਾ ਇੱਕ ਨਮੂਨਾ ਹੈ। ਮੁਲਾਕਾਤਾਂ ਤੈਅ ਕਰਨ, "
        "ਸਵਾਲਾਂ ਦੇ ਜਵਾਬ ਦੇਣ ਅਤੇ ਤੁਹਾਡੇ ਗਾਹਕਾਂ ਨਾਲ ਸੰਪਰਕ ਰੱਖਣ ਵਿੱਚ ਮੇਰੀ "
        "ਮਦਦ ਲਈ ਜਾ ਸਕਦੀ ਹੈ।"
    ),
    "ur": (
        "السلام علیکم، یہ میری آواز کا ایک نمونہ ہے۔ ملاقاتیں طے کرنے، سوالوں کے "
        "جواب دینے اور آپ کے گاہکوں سے رابطہ رکھنے میں میری مدد لی جا سکتی ہے۔"
    ),
    "es": (
        "Hola, esta es una muestra de mi voz. Puedo ayudarte a programar citas, "
        "responder preguntas y hacer seguimiento a tus clientes."
    ),
    "fr": (
        "Bonjour, ceci est un aperçu de ma voix. Je peux vous aider à planifier "
        "des rendez-vous, répondre aux questions et assurer le suivi de vos clients."
    ),
    "de": (
        "Hallo, dies ist eine Hörprobe meiner Stimme. Ich kann Ihnen helfen, "
        "Termine zu vereinbaren, Fragen zu beantworten und Ihre Kunden nachzubetreuen."
    ),
    "pt": (
        "Olá, esta é uma amostra da minha voz. Posso ajudar a agendar "
        "compromissos, responder a perguntas e acompanhar os seus clientes."
    ),
    "it": (
        "Ciao, questa è un'anteprima della mia voce. Posso aiutarti a fissare "
        "appuntamenti, rispondere alle domande e seguire i tuoi clienti."
    ),
    "nl": (
        "Hallo, dit is een voorbeeld van mijn stem. Ik kan je helpen afspraken "
        "in te plannen, vragen te beantwoorden en je klanten op te volgen."
    ),
    "pl": (
        "Dzień dobry, to jest próbka mojego głosu. Mogę pomóc w umawianiu "
        "spotkań, odpowiadaniu na pytania i kontakcie z Twoimi klientami."
    ),
    "ru": (
        "Здравствуйте, это образец моего голоса. Я могу помочь вам назначать "
        "встречи, отвечать на вопросы и поддерживать связь с вашими клиентами."
    ),
    "tr": (
        "Merhaba, bu sesimin bir örneği. Randevu planlamanıza, soruları "
        "yanıtlamanıza ve müşterilerinizle iletişimi sürdürmenize yardımcı olabilirim."
    ),
    "ar": (
        "مرحبًا، هذه عينة من صوتي. يمكنني مساعدتك في تحديد المواعيد والإجابة "
        "عن الأسئلة ومتابعة عملائك."
    ),
    "id": (
        "Halo, ini adalah contoh suara saya. Saya dapat membantu menjadwalkan "
        "janji temu, menjawab pertanyaan, dan menindaklanjuti pelanggan Anda."
    ),
    "vi": (
        "Xin chào, đây là bản xem trước giọng nói của tôi. Tôi có thể giúp bạn "
        "sắp xếp lịch hẹn, trả lời câu hỏi và theo dõi khách hàng của bạn."
    ),
    "ja": (
        "こんにちは、これは私の声のサンプルです。予約の調整、ご質問への回答、"
        "お客様へのフォローアップをお手伝いできます。"
    ),
    "zh": "你好，这是我的声音示例。我可以帮助您安排预约、回答问题，并跟进您的客户。",
    "ko": (
        "안녕하세요, 이것은 제 목소리 샘플입니다. 예약 일정 관리, 질문 답변, "
        "고객 후속 연락을 도와드릴 수 있습니다."
    ),
}

# English sample; kept as a name for callers that need the language-neutral one.
DEFAULT_PREVIEW_TEXT = PREVIEW_SAMPLE_TEXTS[DEFAULT_SAMPLE_LANGUAGE]

# Generous enough for a natural sample, short enough to stay cheap and fast.
# Same limit as the sentence saved with a model configuration.
MAX_PREVIEW_CHARS = MAX_VOICE_PREVIEW_TEXT_CHARS


def to_base_language(language: str | None) -> str:
    """'ta-IN', 'ta_IN' or 'TA' -> 'ta'; empty, 'auto' or 'multi' -> ''."""
    base = (language or "").strip().replace("_", "-").split("-")[0].lower()
    return "" if base in {"auto", "multi"} else base


def get_default_preview_text(language: str | None) -> str:
    """Default sample in the voice's language, falling back to English."""
    return PREVIEW_SAMPLE_TEXTS.get(to_base_language(language), DEFAULT_PREVIEW_TEXT)


def normalize_preview_text(
    text: str | None, *, use_custom_text: bool, language: str | None = None
) -> str:
    """Return the text to synthesize, truncated to :data:`MAX_PREVIEW_CHARS`.

    ``use_custom_text`` is False for platform-scoped previews: those are visible
    to every organization, so they always use the language's default sample.
    """
    if not use_custom_text or not text or not text.strip():
        return get_default_preview_text(language)
    return text.strip()[:MAX_PREVIEW_CHARS]
