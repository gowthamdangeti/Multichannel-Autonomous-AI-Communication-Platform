"""Record LLM requests that ended without the provider reporting usage.

Streaming providers send usage in the last chunk, so a reply cut off by the
caller reports nothing. The provider may still bill it. We can't know the
tokens and must not invent them, so we record how many requests are unknown.
"""

from __future__ import annotations

from loguru import logger

from api.db import db_client
from api.services.workflow.usage_contract import (
    UsageCase,
    UsageServiceType,
    UsageSource,
    UsageStatus,
)


async def record_unreported_llm_requests(
    *, workflow_run_id: int, requests: int
) -> None:
    """Save the count. A failure here must never affect the call."""
    if requests <= 0:
        return
    try:
        await db_client.record_usage(
            workflow_run_id=workflow_run_id,
            case=UsageCase.CONVERSATION,
            service_type=UsageServiceType.LLM,
            operation_id=f"llm-unreported:{workflow_run_id}",
            status=UsageStatus.UNAVAILABLE,
            usage_source=UsageSource.PROVIDER_UNREPORTED,
            usage_detail={"requests": requests},
        )
    except Exception as exc:
        logger.error(
            f"Could not record unreported LLM requests for run {workflow_run_id}: {exc}"
        )
