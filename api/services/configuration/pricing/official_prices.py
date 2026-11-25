"""Prices read from each provider's own pricing page.

Most voice providers have no price API and aren't in the public feed. Each
entry was read from ``source_url`` on ``VERIFIED_ON``. Add a model here only
when the page names it: a missing model shows "Price unavailable", which is
better than a nearby model's price.
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

from api.services.configuration.pricing.entries import (
    PER_HOUR,
    PER_MILLION,
    PER_MINUTE,
    PER_THOUSAND,
    PriceComponent,
    PriceEntry,
    PriceSource,
)

VERIFIED_ON = datetime(2026, 11, 5, tzinfo=UTC)

_C = PriceComponent

CARTESIA_URL = "https://cartesia.ai/pricing"
DEEPGRAM_URL = "https://deepgram.com/pricing"
GOOGLE_TTS_URL = "https://cloud.google.com/text-to-speech/pricing"
GLADIA_URL = "https://www.gladia.io/pricing"
MINIMAX_URL = "https://platform.minimax.io/docs/guides/pricing-paygo"
RIME_URL = "https://rime.ai/pricing"
SARVAM_URL = "https://www.sarvam.ai/api-pricing"
SONIOX_URL = "https://soniox.com/pricing"
SPEECHMATICS_URL = "https://www.speechmatics.com/pricing"
ULTRAVOX_URL = "https://www.ultravox.ai/pricing"

# Cartesia bills credits. Pro overage is $65 per 1M credits; 1 credit per
# character for Sonic and 3 credits per second for Ink.
CARTESIA_PRO_TIER = "Pro plan"
CARTESIA_RATE_PER_MILLION_CREDITS = Decimal("65")
CARTESIA_INK_CREDITS_PER_SECOND = 3

SONIOX_STT_MODELS = ("stt-rt-v6", "stt-rt-v5", "stt-rt-v4", "stt-rt-v3", "stt-rt-v2", "stt-rt-v1")
SONIOX_TTS_MODELS = ("tts-rt-v2", "tts-rt-v1")


def _entry(
    provider: str,
    capability: str,
    model_id: str,
    component: PriceComponent,
    rate: str | Decimal,
    unit_quantity: int,
    source_url: str,
    **extra,
) -> PriceEntry:
    return PriceEntry(
        provider=provider,
        capability=capability,
        model_id=model_id,
        component=component,
        rate=Decimal(rate),
        unit_quantity=unit_quantity,
        source=PriceSource.OFFICIAL,
        source_url=source_url,
        **extra,
    )


def _soniox_entries() -> list[PriceEntry]:
    entries: list[PriceEntry] = []
    for model in SONIOX_STT_MODELS:
        entries += [
            _entry("soniox", "stt", model, _C.INPUT_AUDIO_TOKEN, "2.00", PER_MILLION, SONIOX_URL),
            _entry("soniox", "stt", model, _C.INPUT_TOKEN, "4.00", PER_MILLION, SONIOX_URL),
            _entry("soniox", "stt", model, _C.OUTPUT_TOKEN, "4.00", PER_MILLION, SONIOX_URL),
        ]
    for model in SONIOX_TTS_MODELS:
        entries += [
            _entry("soniox", "tts", model, _C.INPUT_TOKEN, "4.00", PER_MILLION, SONIOX_URL),
            _entry("soniox", "tts", model, _C.OUTPUT_AUDIO_TOKEN, "21.50", PER_MILLION, SONIOX_URL),
        ]
    return entries


def _cartesia_entries() -> list[PriceEntry]:
    per_credit = {"tier": CARTESIA_PRO_TIER, "note": "Rate depends on your Cartesia plan."}
    ink_rate = CARTESIA_RATE_PER_MILLION_CREDITS * CARTESIA_INK_CREDITS_PER_SECOND
    return [
        _entry("cartesia", "tts", "sonic-3.5", _C.CHARACTER, CARTESIA_RATE_PER_MILLION_CREDITS, PER_MILLION, CARTESIA_URL, **per_credit),
        _entry("cartesia", "tts", "sonic-3", _C.CHARACTER, CARTESIA_RATE_PER_MILLION_CREDITS, PER_MILLION, CARTESIA_URL, **per_credit),
        _entry("cartesia", "stt", "ink-whisper", _C.AUDIO_SECOND, ink_rate, PER_MILLION, CARTESIA_URL, **per_credit),
    ]


def _deepgram_entries() -> list[PriceEntry]:
    payg = {"tier": "Pay as you go"}
    return [
        _entry("deepgram", "stt", "nova-3-general", _C.AUDIO_SECOND, "0.0077", PER_MINUTE, DEEPGRAM_URL, note="Multilingual costs $0.0092/min.", **payg),
        _entry("deepgram", "stt", "flux-general-en", _C.AUDIO_SECOND, "0.0077", PER_MINUTE, DEEPGRAM_URL, **payg),
        _entry("deepgram", "stt", "flux-general-multi", _C.AUDIO_SECOND, "0.0078", PER_MINUTE, DEEPGRAM_URL, **payg),
        _entry("deepgram", "tts", "aura-2", _C.CHARACTER, "0.030", PER_THOUSAND, DEEPGRAM_URL, **payg),
        _entry("deepgram", "tts", "aura", _C.CHARACTER, "0.015", PER_THOUSAND, DEEPGRAM_URL, **payg),
    ]


def _sarvam_entries() -> list[PriceEntry]:
    payg = {"tier": "Pay as you go", "currency": "INR"}
    return [
        _entry("sarvam", "tts", "bulbul:v3", _C.CHARACTER, "3.00", PER_THOUSAND, SARVAM_URL, **payg),
        _entry("sarvam", "stt", "saarika:v2.5", _C.AUDIO_SECOND, "0.49", PER_MINUTE, SARVAM_URL, **payg),
        _entry("sarvam", "stt", "saaras:v3", _C.AUDIO_SECOND, "0.49", PER_MINUTE, SARVAM_URL, **payg),
        _entry("sarvam", "llm", "sarvam-105b", _C.INPUT_TOKEN, "15.00", PER_MILLION, SARVAM_URL, **payg),
        _entry("sarvam", "llm", "sarvam-105b", _C.CACHED_INPUT_TOKEN, "5.00", PER_MILLION, SARVAM_URL, **payg),
        _entry("sarvam", "llm", "sarvam-105b", _C.OUTPUT_TOKEN, "60.00", PER_MILLION, SARVAM_URL, **payg),
    ]


def _other_entries() -> list[PriceEntry]:
    payg = {"tier": "Pay as you go"}
    return [
        _entry("google", "tts", "chirp_3_hd", _C.CHARACTER, "30", PER_MILLION, GOOGLE_TTS_URL),
        _entry("google", "tts", "neural2", _C.CHARACTER, "16", PER_MILLION, GOOGLE_TTS_URL),
        _entry("google", "tts", "wavenet", _C.CHARACTER, "4", PER_MILLION, GOOGLE_TTS_URL),
        _entry("google", "tts", "standard", _C.CHARACTER, "4", PER_MILLION, GOOGLE_TTS_URL),
        _entry("minimax", "tts", "speech-2.8-hd", _C.CHARACTER, "100", PER_MILLION, MINIMAX_URL),
        _entry("minimax", "tts", "speech-2.8-turbo", _C.CHARACTER, "60", PER_MILLION, MINIMAX_URL),
        _entry("rime", "tts", "mistv3", _C.OUTPUT_AUDIO_SECOND, "0.030", PER_MINUTE, RIME_URL, **payg),
        _entry("speechmatics", "stt", "enhanced", _C.AUDIO_SECOND, "0.80", PER_HOUR, SPEECHMATICS_URL, **payg),
        _entry("gladia", "stt", "solaria-1", _C.AUDIO_SECOND, "0.68", PER_HOUR, GLADIA_URL, currency="EUR", **payg),
        _entry("ultravox_realtime", "realtime", "ultravox-v0.7", _C.SESSION_SECOND, "0.05", PER_MINUTE, ULTRAVOX_URL, **payg),
        _entry("ultravox_realtime", "realtime", "fixie-ai/ultravox", _C.SESSION_SECOND, "0.05", PER_MINUTE, ULTRAVOX_URL, **payg),
    ]


def list_official_prices() -> list[PriceEntry]:
    return [
        *_soniox_entries(),
        *_cartesia_entries(),
        *_deepgram_entries(),
        *_sarvam_entries(),
        *_other_entries(),
    ]
