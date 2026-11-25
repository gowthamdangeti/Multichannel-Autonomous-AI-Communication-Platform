"""Shared price types. No I/O."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from enum import StrEnum


class PriceSource(StrEnum):
    ADMIN = "admin"
    PROVIDER_API = "provider_api"
    OFFICIAL = "official"
    FEED = "feed"


class PriceComponent(StrEnum):
    INPUT_TOKEN = "input_token"
    OUTPUT_TOKEN = "output_token"
    CACHED_INPUT_TOKEN = "cached_input_token"
    CACHE_WRITE_TOKEN = "cache_write_token"
    INPUT_AUDIO_TOKEN = "input_audio_token"
    OUTPUT_AUDIO_TOKEN = "output_audio_token"
    AUDIO_SECOND = "audio_second"
    OUTPUT_AUDIO_SECOND = "output_audio_second"
    SESSION_SECOND = "session_second"
    CHARACTER = "character"


class ReviewStatus(StrEnum):
    APPROVED = "approved"
    PENDING = "pending"
    REJECTED = "rejected"


PER_MILLION = 1_000_000
PER_THOUSAND = 1_000
PER_MINUTE = 60
PER_HOUR = 3_600


@dataclass(frozen=True)
class PriceEntry:
    """``rate`` is the price of ``unit_quantity`` units of ``component``."""

    provider: str
    capability: str
    model_id: str
    component: PriceComponent
    rate: Decimal
    unit_quantity: int
    source: PriceSource
    currency: str = "USD"
    tier: str | None = None
    source_url: str | None = None
    note: str | None = None

    @property
    def key(self) -> tuple[str, str, str, str]:
        return (self.provider, self.capability, self.model_id, self.component.value)
