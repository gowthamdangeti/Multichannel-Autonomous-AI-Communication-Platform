"""Read stored model lists with a short in-process cache.

The API and the ARQ worker are separate processes, so a worker refresh can't
clear the API's memory: entries simply expire after ``TTL_SECONDS``.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

from loguru import logger

from api.db.provider_model_client import STATUS_ACTIVE, ProviderModelClient

TTL_SECONDS = 300
ERROR_TTL_SECONDS = 30  # after a DB error, don't retry on every request


@dataclass(frozen=True)
class LiveModel:
    model_id: str
    display_name: str | None
    is_active: bool


_cache: dict[tuple[str, str], tuple[float, list[LiveModel]]] = {}


async def get_live_models(*, provider: str, capability: str) -> list[LiveModel]:
    """Stored models for a provider. Empty when none, or when the DB is down."""
    key = (provider, capability)
    cached = _cache.get(key)
    if cached and cached[0] > time.monotonic():
        return cached[1]
    try:
        rows = await ProviderModelClient().list_provider_models(
            provider=provider, capability=capability
        )
    except Exception as exc:
        logger.warning(f"Live model lookup failed for {provider}/{capability}: {exc}")
        _cache[key] = (time.monotonic() + ERROR_TTL_SECONDS, [])
        return []
    value = [
        LiveModel(row.model_id, row.display_name, row.status == STATUS_ACTIVE) for row in rows
    ]
    _cache[key] = (time.monotonic() + TTL_SECONDS, value)
    return value


def invalidate(provider: str | None = None) -> None:
    for key in list(_cache):
        if provider is None or key[0] == provider:
            del _cache[key]
