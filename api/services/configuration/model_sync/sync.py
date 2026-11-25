"""Refresh live model lists from provider APIs and store them.

Safety rules:
- A failed or empty fetch never changes anything.
- A refresh that would drop the list below ``SHRINK_LIMIT`` of what users see
  is not applied unless an admin forces it, so a provider outage or a limited
  key can't wipe models from the picker.
- A model that stops being listed is deprecated, never deleted.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import UTC, datetime

import httpx
from loguru import logger

from api.db.platform_client import platform_client
from api.db.provider_model_client import STATUS_ACTIVE, ProviderModelClient
from api.services.configuration.language_sync.credentials import resolve_credentials
from api.services.configuration.language_sync.fetchers import FetchError
from api.services.configuration.model_sync import store
from api.services.configuration.model_sync.fetchers import FETCHERS, ModelFetcher

SHRINK_LIMIT = 0.7
STATUS_KEY = "model_sync_status"
HTTP_TIMEOUT = httpx.Timeout(15.0, connect=5.0)


@dataclass
class ModelSyncResult:
    provider: str
    capability: str
    status: str  # "updated" | "needs_review" | "skipped" | "failed"
    models: int = 0
    message: str = ""
    finished_at: str = ""


def is_large_shrink(*, current: int, new: int) -> bool:
    return current > 0 and new < current * SHRINK_LIMIT


async def _sync_fetcher(
    *,
    fetcher: ModelFetcher,
    client: httpx.AsyncClient,
    model_client: ProviderModelClient,
    force: bool,
) -> ModelSyncResult:
    result = ModelSyncResult(fetcher.provider, fetcher.capability, "updated")
    creds: dict = {}
    if fetcher.requires_key:
        creds = await resolve_credentials(
            fetcher.credential_provider or fetcher.provider, fetcher.capability
        ) or {}
        if not creds:
            result.status = "skipped"
            result.message = f"No platform key for {fetcher.provider}; the built-in list is used."
            return result
    try:
        listings = await fetcher.fetch(creds, client)
    except FetchError as exc:
        result.status = "failed"
        result.message = str(exc)
        logger.warning(f"Model sync failed for {fetcher.id}: {exc}")
        return result
    if not listings:
        result.status = "failed"
        result.message = "Provider returned no usable models"
        return result

    rows = await model_client.list_provider_models(
        provider=fetcher.provider, capability=fetcher.capability
    )
    active = sum(1 for row in rows if row.status == STATUS_ACTIVE)
    result.models = len(listings)
    if not force and is_large_shrink(current=active, new=len(listings)):
        result.status = "needs_review"
        result.message = f"Provider lists {len(listings)} models instead of {active}. Run with force to apply."
        return result

    await model_client.replace_provider_models(
        provider=fetcher.provider,
        capability=fetcher.capability,
        models=[(item.model_id, item.display_name) for item in listings],
        seen_at=datetime.now(UTC),
    )
    store.invalidate(fetcher.provider)
    return result


async def execute_model_sync(
    *, force: bool = False, client: httpx.AsyncClient | None = None
) -> list[ModelSyncResult]:
    model_client = ProviderModelClient()
    owns_client = client is None
    http = client or httpx.AsyncClient(timeout=HTTP_TIMEOUT, follow_redirects=True)
    results: list[ModelSyncResult] = []
    try:
        for fetcher in FETCHERS:
            try:
                result = await _sync_fetcher(
                    fetcher=fetcher, client=http, model_client=model_client, force=force
                )
            except Exception as exc:  # one provider must never stop the others
                logger.exception(f"Model sync crashed for {fetcher.id}")
                result = ModelSyncResult(
                    fetcher.provider, fetcher.capability, "failed", message=type(exc).__name__
                )
            result.finished_at = datetime.now(UTC).isoformat()
            results.append(result)
    finally:
        if owns_client:
            await http.aclose()
    return results


async def record_model_sync_status(results: list[ModelSyncResult]) -> dict:
    """Merge results into the status shown to admins."""
    current = await platform_client.get_platform_config_value(STATUS_KEY) or {}
    for result in results:
        current[f"{result.provider}:{result.capability}"] = asdict(result)
    await platform_client.upsert_platform_config(STATUS_KEY, current)
    return current


async def get_model_sync_status() -> dict:
    return await platform_client.get_platform_config_value(STATUS_KEY) or {}
