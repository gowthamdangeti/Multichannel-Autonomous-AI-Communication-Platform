"""Copy a finished run's billed usage from its providers into usage events."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from loguru import logger

from api.db import db_client
from api.services.configuration.ai_model_configuration import (
    get_effective_ai_model_configuration_for_workflow,
)
from api.services.provider_usage.exceptions import ProviderUsageAccessError
from api.services.provider_usage.reference import to_run_usage_context
from api.services.provider_usage.registry import get_usage_fetcher
from api.services.provider_usage.types import (
    ProviderUsageRecord,
    RunUsageContext,
    SyncOutcome,
)
from api.services.workflow.usage_contract import (
    NormalizedUsage,
    UsageCase,
    UsageServiceType,
    UsageSource,
    UsageStatus,
)

# Every request ends by the time the call completes. The margin covers clock
# differences, and the bound keeps a busy organization's window small.
WINDOW_MARGIN = timedelta(minutes=5)
# Soniox rejects a window over 31 days.
MAX_WINDOW = timedelta(days=30)


def to_normalized_usage(record: ProviderUsageRecord) -> NormalizedUsage:
    return NormalizedUsage(
        input_tokens=record.input_tokens,
        output_tokens=record.output_tokens,
        total_tokens=record.input_tokens + record.output_tokens,
        input_units=record.input_seconds,
        output_units=record.output_seconds,
    )


def to_usage_window(
    *, created_at: datetime, completed_at: datetime, now: datetime
) -> tuple[datetime, datetime]:
    end_time = min(now, completed_at + WINDOW_MARGIN, created_at + MAX_WINDOW)
    return created_at, end_time


def list_provider_keys(
    *, context: RunUsageContext, config: Any
) -> dict[str, set[str]]:
    """Map each provider that served this run to its API keys.

    STT and TTS can use different keys, and a key only sees its own project.
    """
    keys: dict[str, set[str]] = {}
    services = (
        (context.stt_provider, getattr(config, "stt", None)),
        (context.tts_provider, getattr(config, "tts", None)),
    )
    for provider, service in services:
        api_key = getattr(service, "api_key", None)
        if get_usage_fetcher(provider) and api_key:
            keys.setdefault(provider, set()).add(api_key)
    return keys


async def _fetch_records(
    *,
    provider: str,
    api_keys: set[str],
    reference: str,
    start_time: datetime,
    end_time: datetime,
) -> list[ProviderUsageRecord]:
    """Read every key. Raises only when all of them are refused for good."""
    fetcher = get_usage_fetcher(provider)
    records: list[ProviderUsageRecord] = []
    last_refusal: ProviderUsageAccessError | None = None
    refused = 0
    for api_key in api_keys:
        try:
            records += await fetcher.list_usage_records(
                api_key=api_key,
                client_reference_id=reference,
                start_time=start_time,
                end_time=end_time,
            )
        except ProviderUsageAccessError as exc:
            refused += 1
            last_refusal = exc
        except (httpx.HTTPError, ArithmeticError, RuntimeError, ValueError) as exc:
            # The key travels in a header, so it can't appear in this message.
            logger.warning(f"Could not read {provider} usage for {reference}: {exc}")
    if last_refusal and refused == len(api_keys):
        raise last_refusal
    return records


async def _save_records(
    *, workflow_run_id: int, records: list[ProviderUsageRecord]
) -> None:
    for record in records:
        await db_client.record_usage(
            workflow_run_id=workflow_run_id,
            case=UsageCase.CONVERSATION,
            service_type=record.service_type,
            operation_id=f"{record.provider}:{record.request_id}",
            usage=to_normalized_usage(record),
            provider=record.provider,
            model=record.model,
            usage_source=UsageSource.PROVIDER_BILLED,
            provider_cost_usd=record.cost_usd,
            usage_detail=record.detail,
        )


async def _mark_unavailable(*, workflow_run_id: int, provider: str) -> None:
    await db_client.record_usage(
        workflow_run_id=workflow_run_id,
        case=UsageCase.CONVERSATION,
        service_type=UsageServiceType.STT,
        operation_id=f"{provider}:unavailable",
        provider=provider,
        status=UsageStatus.UNAVAILABLE,
        usage_source=UsageSource.PROVIDER_BILLED,
    )


async def sync_provider_usage_for_run(
    *, workflow_run_id: int, completed_at: datetime, is_last_attempt: bool
) -> SyncOutcome:
    """Save any new provider records for a run.

    Safe to repeat: each record's request ID makes a second write a no-op.
    """
    run = await db_client.get_workflow_run(workflow_run_id)
    if run is None:
        return SyncOutcome(found=0, should_retry=False)
    context = to_run_usage_context(initial_context=run.initial_context)
    if not context.reference:
        return SyncOutcome(found=0, should_retry=False)

    config = await get_effective_ai_model_configuration_for_workflow(
        user_id=run.workflow.user_id,
        organization_id=run.workflow.organization_id,
        workflow_configurations=(
            run.definition.workflow_configurations if run.definition else None
        )
        or {},
    )
    start_time, end_time = to_usage_window(
        created_at=run.created_at, completed_at=completed_at, now=datetime.now(UTC)
    )

    found = 0
    should_retry = False
    for provider, api_keys in list_provider_keys(context=context, config=config).items():
        try:
            records = await _fetch_records(
                provider=provider,
                api_keys=api_keys,
                reference=context.reference,
                start_time=start_time,
                end_time=end_time,
            )
        except ProviderUsageAccessError as exc:
            logger.warning(f"Stopping usage sync for run {workflow_run_id}: {exc}")
            await _mark_unavailable(workflow_run_id=workflow_run_id, provider=provider)
            continue

        should_retry = True
        if records:
            await _save_records(workflow_run_id=workflow_run_id, records=records)
            found += len(records)
        elif is_last_attempt:
            await _mark_unavailable(workflow_run_id=workflow_run_id, provider=provider)
    return SyncOutcome(found=found, should_retry=should_retry)
