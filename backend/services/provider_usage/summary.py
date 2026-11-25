"""Turn saved usage events into what the run page shows."""

from __future__ import annotations

from collections.abc import Sequence
from decimal import Decimal

from api.db.models import UsageEventModel
from api.schemas.provider_usage import (
    BilledServiceUsage,
    ProviderRequest,
    ProviderUsageSummary,
)
from api.services.provider_usage.registry import list_tracked_providers
from api.services.provider_usage.types import RunUsageContext
from api.services.workflow.usage_contract import UsageSource, UsageStatus

_TOKEN_FIELDS = (
    "input_text_tokens",
    "input_audio_tokens",
    "output_text_tokens",
    "output_audio_tokens",
)
_COST_FIELDS = (
    "input_text_cost_usd",
    "input_audio_cost_usd",
    "output_text_cost_usd",
    "output_audio_cost_usd",
)


def _add_cost(current: str, amount: Decimal | str | None) -> str:
    # Decimal text, not float: billed values must add up exactly.
    return str(Decimal(current) + Decimal(str(amount or "0")))


def to_billed_services(
    rows: Sequence[UsageEventModel],
) -> list[BilledServiceUsage]:
    """Add recorded billed rows up per service and model."""
    services: dict[tuple[str, str, str], BilledServiceUsage] = {}
    for row in rows:
        if row.status != UsageStatus.RECORDED.value:
            continue
        detail = row.usage_detail or {}
        service = services.setdefault(
            (row.service_type, row.provider or "", row.model or ""),
            BilledServiceUsage(
                service_type=row.service_type,
                provider=row.provider,
                model=row.model,
            ),
        )
        service.request_count += 1
        service.input_seconds += float(row.input_units or 0)
        service.output_seconds += float(row.output_units or 0)
        service.cost_usd = _add_cost(service.cost_usd, row.provider_cost_usd)
        for field in _TOKEN_FIELDS:
            setattr(service, field, getattr(service, field) + int(detail.get(field) or 0))
        for field in _COST_FIELDS:
            setattr(service, field, _add_cost(getattr(service, field), detail.get(field)))
    return list(services.values())


def to_provider_request(row: UsageEventModel) -> ProviderRequest:
    detail = row.usage_detail or {}
    return ProviderRequest(
        # The operation ID is "<provider>:<request id>".
        request_id=row.operation_id.split(":", 1)[-1],
        provider=row.provider,
        service_type=row.service_type,
        model=row.model,
        input_tokens=row.input_tokens or 0,
        output_tokens=row.output_tokens or 0,
        input_seconds=float(row.input_units or 0),
        output_seconds=float(row.output_units or 0),
        cost_usd=str(row.provider_cost_usd or "0"),
        started_at=detail.get("start_time"),
        ended_at=detail.get("end_time"),
    )


def _count_unreported_llm_requests(rows: Sequence[UsageEventModel]) -> int:
    return sum(
        int((row.usage_detail or {}).get("requests") or 0)
        for row in rows
        if row.usage_source == UsageSource.PROVIDER_UNREPORTED.value
    )


def to_provider_usage_summary(
    *, rows: Sequence[UsageEventModel], context: RunUsageContext
) -> ProviderUsageSummary:
    billed_rows = [
        row for row in rows if row.usage_source == UsageSource.PROVIDER_BILLED.value
    ]
    services = to_billed_services(billed_rows)
    tracked = list_tracked_providers(context=context)
    if services:
        status = "billed"
    elif billed_rows:
        status = "unavailable"
    elif tracked:
        status = "pending"
    else:
        status = "none"

    billed_providers = {service.provider for service in services}
    closed_providers = {row.provider for row in billed_rows}
    return ProviderUsageSummary(
        status=status,
        services=services,
        client_reference_id=context.reference,
        requests=[
            to_provider_request(row)
            for row in billed_rows
            if row.status == UsageStatus.RECORDED.value
        ],
        awaiting_providers=[
            p for p in tracked if p not in billed_providers and p not in closed_providers
        ],
        unreported_llm_requests=_count_unreported_llm_requests(rows),
    )
