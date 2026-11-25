"""Read billed usage from Soniox's usage logs.

https://docs.soniox.com/api-reference/other/get_usage_logs

The endpoint has no reference filter, so we page through a time window and match
``client_reference_id`` here. The window is matched on each request's end time.
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import httpx

from api.services.provider_usage.exceptions import ProviderUsageAccessError
from api.services.provider_usage.types import ProviderUsageRecord
from api.services.workflow.usage_contract import UsageServiceType

USAGE_LOGS_URL = "https://api.soniox.com/v1/usage-logs"
PAGE_LIMIT = 1000
MAX_PAGES = 50
REQUEST_TIMEOUT_SECONDS = 20.0
PERMANENT_STATUS_CODES = frozenset({401, 403, 404})


def to_iso_utc(value: datetime) -> str:
    return value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def to_service_type(model: str) -> UsageServiceType | None:
    if model.startswith("stt-"):
        return UsageServiceType.STT
    if model.startswith("tts-"):
        return UsageServiceType.TTS
    return None


def to_usage_record(entry: dict[str, Any]) -> ProviderUsageRecord | None:
    """Map one log entry to a record, or None when it isn't speech usage."""
    model = str(entry.get("model") or "")
    service_type = to_service_type(model)
    request_id = str(entry.get("uuid") or "")
    if service_type is None or not request_id:
        return None
    return ProviderUsageRecord(
        provider="soniox",
        request_id=request_id,
        service_type=service_type,
        model=model,
        input_tokens=int(entry.get("input_text_tokens") or 0)
        + int(entry.get("input_audio_tokens") or 0),
        output_tokens=int(entry.get("output_text_tokens") or 0)
        + int(entry.get("output_audio_tokens") or 0),
        input_seconds=int(entry.get("input_audio_duration_ms") or 0) / 1000,
        output_seconds=int(entry.get("output_audio_duration_ms") or 0) / 1000,
        # Decimal from the string: a float would change the billed value.
        cost_usd=Decimal(str(entry.get("cost_usd") or "0")),
        detail=entry,
    )


class SonioxUsageFetcher:
    provider = "soniox"

    async def list_usage_records(
        self,
        *,
        api_key: str,
        client_reference_id: str,
        start_time: datetime,
        end_time: datetime,
    ) -> list[ProviderUsageRecord]:
        params: dict[str, Any] = {
            "start_time": to_iso_utc(start_time),
            "end_time": to_iso_utc(end_time),
            "limit": PAGE_LIMIT,
        }
        records: list[ProviderUsageRecord] = []
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
            for _ in range(MAX_PAGES):
                response = await client.get(
                    USAGE_LOGS_URL,
                    params=params,
                    headers={"Authorization": f"Bearer {api_key}"},
                )
                if response.status_code in PERMANENT_STATUS_CODES:
                    raise ProviderUsageAccessError(
                        provider=self.provider, status_code=response.status_code
                    )
                response.raise_for_status()
                payload = response.json()
                for entry in payload.get("usage_logs") or []:
                    if entry.get("client_reference_id") != client_reference_id:
                        continue
                    record = to_usage_record(entry)
                    if record is not None:
                        records.append(record)
                cursor = payload.get("next_page_cursor")
                if not cursor:
                    return records
                params["cursor"] = cursor
        raise RuntimeError(f"Soniox usage logs exceeded {MAX_PAGES} pages")
