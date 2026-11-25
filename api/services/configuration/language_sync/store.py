"""Read live language lists with a short in-process cache.

The API and the ARQ worker are separate processes, so the worker's refresh
can't clear the API's memory. Entries therefore expire after ``TTL_SECONDS``;
a refresh started from the admin page (in the API process) clears the cache
straight away.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import datetime

from loguru import logger

from api.db.platform_client import platform_client

TTL_SECONDS = 300
ERROR_TTL_SECONDS = 30  # after a DB error, don't retry on every request


@dataclass(frozen=True)
class LiveLanguages:
    codes: list[str]
    fetched_at: datetime | None
    voice_counts: dict[str, int] | None = None


_cache: dict[tuple[str, str], tuple[float, dict[str, LiveLanguages]]] = {}


async def get_live_languages(provider: str, capability: str) -> dict[str, LiveLanguages]:
    """Model -> live list for a provider ("" = all models). Empty when none stored.

    A database error is logged and treated as "no live list", so the picker
    falls back to the static list instead of failing.
    """
    from api.services.configuration.language_sync.fetchers import FETCHERS

    provider = str(getattr(provider, "value", provider))
    capability = "realtime" if capability == "sts" else capability
    if f"{provider}:{capability}" not in FETCHERS:
        return {}  # no listing API, so there can't be a live list
    key = (provider, capability)
    cached = _cache.get(key)
    if cached and cached[0] > time.monotonic():
        return cached[1]
    try:
        rows = await platform_client.list_language_catalog(provider=provider, capability=capability)
    except Exception as exc:
        logger.warning(f"Live language lookup failed for {provider}/{capability}: {exc}")
        _cache[key] = (time.monotonic() + ERROR_TTL_SECONDS, {})
        return {}
    value = {
        row.model: LiveLanguages(
            codes=list(row.codes or []), fetched_at=row.fetched_at, voice_counts=row.voice_counts
        )
        for row in rows
        if row.codes
    }
    _cache[key] = (time.monotonic() + TTL_SECONDS, value)
    return value


def invalidate(provider: str | None = None) -> None:
    for key in list(_cache):
        if provider is None or key[0] == provider:
            del _cache[key]
