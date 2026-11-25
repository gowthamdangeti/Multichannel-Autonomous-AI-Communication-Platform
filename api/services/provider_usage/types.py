"""Shared shapes for provider usage. Fetchers return these and never touch the DB."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Any, Protocol

from api.services.workflow.usage_contract import UsageServiceType


@dataclass(frozen=True, slots=True)
class ProviderUsageRecord:
    """One billed request, exactly as the provider reported it."""

    provider: str
    request_id: str
    service_type: UsageServiceType
    model: str
    input_tokens: int
    output_tokens: int
    input_seconds: float
    output_seconds: float
    cost_usd: Decimal
    detail: dict[str, Any]


@dataclass(frozen=True, slots=True)
class RunUsageContext:
    """What a run recorded about its speech providers when it started."""

    reference: str | None
    stt_provider: str | None
    tts_provider: str | None


@dataclass(frozen=True, slots=True)
class SyncOutcome:
    found: int
    should_retry: bool


class ProviderUsageFetcher(Protocol):
    provider: str

    async def list_usage_records(
        self,
        *,
        api_key: str,
        client_reference_id: str,
        start_time: datetime,
        end_time: datetime,
    ) -> list[ProviderUsageRecord]:
        """Return the provider's records for one reference inside a time window.

        Raises ProviderUsageAccessError when retrying can't help.
        """
        ...
