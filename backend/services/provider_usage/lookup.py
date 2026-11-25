"""Find the call behind a provider's request ID."""

from __future__ import annotations

from api.db import db_client
from api.schemas.provider_usage import ProviderRequestLookup
from api.services.provider_usage.exceptions import ProviderRequestNotFoundError
from api.services.provider_usage.registry import list_usage_providers
from api.services.provider_usage.summary import to_provider_request


async def get_provider_request(
    *, request_id: str, organization_id: int
) -> ProviderRequestLookup:
    """Return the request and its run, only if this organization owns the run."""
    found = await db_client.find_provider_request_event(
        operation_ids=[
            f"{provider}:{request_id}" for provider in list_usage_providers()
        ],
        organization_id=organization_id,
    )
    if found is None:
        raise ProviderRequestNotFoundError(request_id=request_id)
    event, run = found
    return ProviderRequestLookup(
        workflow_id=run.workflow_id,
        run_id=run.id,
        run_name=run.name,
        request=to_provider_request(event),
    )
