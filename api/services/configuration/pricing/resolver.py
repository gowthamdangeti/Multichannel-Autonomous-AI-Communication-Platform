"""Find the price of one provider + model. Exact match only, never a guess."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from enum import StrEnum

from api.db.model_price_client import ModelPriceClient
from api.services.configuration.pricing.entries import (
    PER_MINUTE,
    PriceComponent,
    PriceSource,
)

SELF_HOSTED_PROVIDERS = frozenset({"ollama", "speaches", "neutts", "indicf5"})

# Highest wins. Official pages rank above the feed because the feed can lag.
SOURCE_RANK: dict[str, int] = {
    PriceSource.ADMIN.value: 4,
    PriceSource.PROVIDER_API.value: 3,
    PriceSource.OFFICIAL.value: 2,
    PriceSource.FEED.value: 1,
}

CURRENCY_SYMBOLS = {"USD": "$", "EUR": "€", "INR": "₹"}
DISPLAY_PLACES = Decimal("0.0001")

_C = PriceComponent
COMPONENT_LABELS: dict[str, str] = {
    _C.INPUT_TOKEN.value: "Input",
    _C.OUTPUT_TOKEN.value: "Output",
    _C.CACHED_INPUT_TOKEN.value: "Cached input",
    _C.CACHE_WRITE_TOKEN.value: "Cache write",
    _C.INPUT_AUDIO_TOKEN.value: "Input audio",
    _C.OUTPUT_AUDIO_TOKEN.value: "Output audio",
    _C.AUDIO_SECOND.value: "Audio",
    _C.OUTPUT_AUDIO_SECOND.value: "Output audio",
    _C.SESSION_SECOND.value: "Session",
    _C.CHARACTER.value: "Text",
}
_DURATION_COMPONENTS = frozenset(
    {_C.AUDIO_SECOND.value, _C.OUTPUT_AUDIO_SECOND.value, _C.SESSION_SECOND.value}
)
_COMPONENT_ORDER = {name: index for index, name in enumerate(COMPONENT_LABELS)}


class PriceStatus(StrEnum):
    PRICED = "priced"
    UNAVAILABLE = "unavailable"
    SELF_HOSTED = "self_hosted"
    HIDDEN = "hidden"


@dataclass(frozen=True)
class PriceLine:
    component: str
    label: str
    display: str


@dataclass(frozen=True)
class ModelPrice:
    status: PriceStatus
    lines: list[PriceLine]
    source: str | None = None
    source_url: str | None = None
    tier: str | None = None
    note: str | None = None
    verified_at: datetime | None = None


def _format_amount(amount: Decimal) -> str:
    """Whole cents stay ``2.00``; small rates keep four decimal places."""
    if amount >= DISPLAY_PLACES:
        amount = amount.quantize(DISPLAY_PLACES)
    text = format(amount.normalize(), "f")
    if "." not in text:
        return f"{text}.00"
    return text if len(text.split(".")[1]) >= 2 else f"{text}0"


def format_price_line(
    *, component: str, rate: Decimal, unit_quantity: int, currency: str
) -> str:
    """e.g. ``$0.0077/min``, ``$2.00/1M tokens``, ``₹3.00/1K chars``."""
    symbol = CURRENCY_SYMBOLS.get(currency, f"{currency} ")
    if component in _DURATION_COMPONENTS:
        per_minute = Decimal(rate) * PER_MINUTE / unit_quantity
        return f"{symbol}{_format_amount(per_minute)}/min"
    noun = "chars" if component == _C.CHARACTER.value else "tokens"
    scale = "1K" if unit_quantity == 1_000 else "1M"
    multiplier = 1_000 if unit_quantity == 1_000 else 1_000_000
    per_scale = Decimal(rate) * multiplier / unit_quantity
    return f"{symbol}{_format_amount(per_scale)}/{scale} {noun}"


def to_price_model_id(*, provider: str, capability: str, model: str, voice: str) -> str:
    """Deepgram TTS has no model setting: the voice name carries it."""
    if provider == "deepgram" and capability == "tts" and not model:
        if voice.startswith("aura-2-"):
            return "aura-2"
        if voice.startswith("aura-"):
            return "aura"
    return model


def select_best_source(rows: list) -> list:
    """Keep one source per model: mixing sources could combine unrelated rates."""
    if not rows:
        return []
    best = max(rows, key=lambda row: SOURCE_RANK.get(row.source, 0)).source
    return [row for row in rows if row.source == best]


async def get_model_price(
    *, provider: str, capability: str, model: str | None, voice: str | None
) -> ModelPrice:
    if provider in SELF_HOSTED_PROVIDERS:
        return ModelPrice(status=PriceStatus.SELF_HOSTED, lines=[])
    model_id = to_price_model_id(
        provider=provider,
        capability=capability,
        model=(model or "").strip(),
        voice=(voice or "").strip().lower(),
    )
    if not model_id:
        return ModelPrice(status=PriceStatus.UNAVAILABLE, lines=[])

    rows = select_best_source(
        await ModelPriceClient().list_active_prices(
            provider=provider, capability=capability, model_id=model_id
        )
    )
    if not rows:
        return ModelPrice(status=PriceStatus.UNAVAILABLE, lines=[])

    rows.sort(key=lambda row: _COMPONENT_ORDER.get(row.component, len(_COMPONENT_ORDER)))
    first = rows[0]
    return ModelPrice(
        status=PriceStatus.PRICED,
        lines=[
            PriceLine(
                component=row.component,
                label=COMPONENT_LABELS.get(row.component, row.component),
                display=format_price_line(
                    component=row.component,
                    rate=row.rate,
                    unit_quantity=row.unit_quantity,
                    currency=row.currency,
                ),
            )
            for row in rows
        ],
        source=first.source,
        source_url=first.source_url,
        tier=first.tier,
        note=first.note,
        verified_at=first.verified_at,
    )
