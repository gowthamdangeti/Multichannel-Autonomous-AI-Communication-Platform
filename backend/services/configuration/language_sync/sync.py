"""Refresh live language lists from provider APIs and store them.

Safety rules:
- A failed or empty fetch never changes anything; the last good list (or the
  static list in code) stays in use.
- A refresh that would drop the list below ``SHRINK_LIMIT`` of what users see
  today is parked as *pending* for an admin to approve, so a provider outage
  or a bad key can't wipe languages from the picker.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime

import httpx
from loguru import logger

from api.db.platform_client import platform_client
from api.services.configuration.language_sync import store
from api.services.configuration.language_sync.credentials import resolve_credentials
from api.services.configuration.language_sync.fetchers import (
    ALL_MODELS,
    FETCHERS,
    FetchError,
    LanguageFetcher,
    get_fetcher,
)
from api.services.configuration.locales import get_locale

SHRINK_LIMIT = 0.7
STATUS_KEY = "language_sync_status"
HTTP_TIMEOUT = httpx.Timeout(10.0, connect=5.0)


@dataclass
class ProviderSyncResult:
    provider: str
    capability: str
    status: str  # "updated" | "unchanged" | "pending_review" | "skipped" | "error"
    message: str = ""
    models: dict[str, int] = field(default_factory=dict)  # model -> languages stored
    pending: list[str] = field(default_factory=list)  # models parked for review
    unknown_codes: list[str] = field(default_factory=list)
    finished_at: str = ""


def review_change(current: list[str], new: list[str]) -> str | None:
    """Return why ``new`` must be reviewed before replacing ``current``, or None."""
    if current and len(new) < len(current) * SHRINK_LIMIT:
        return (
            f"Provider now reports {len(new)} languages instead of {len(current)} "
            f"(over {int((1 - SHRINK_LIMIT) * 100)}% fewer). Approve to apply."
        )
    return None


def _static_codes(provider: str, capability: str, model: str) -> list[str]:
    """What the picker shows today when there's no live row: the list in code."""
    from api.services.configuration.provider_catalog import list_languages

    try:
        locales = list_languages(provider, capability, model or None)
    except ValueError:
        return []
    return [l.code for l in locales if not l.is_auto_detect]


async def sync_provider(
    fetcher_id: str, *, client: httpx.AsyncClient | None = None
) -> ProviderSyncResult:
    """Refresh one list. ``fetcher_id`` is "provider:capability" (bare provider = TTS)."""
    fetcher: LanguageFetcher | None = get_fetcher(fetcher_id)
    if fetcher is None:
        provider, _, capability = fetcher_id.partition(":")
        return _finish(ProviderSyncResult(
            provider, capability, "skipped", "No listing API; the built-in list is used"
        ))
    provider = fetcher.provider

    result = ProviderSyncResult(provider, fetcher.capability, "unchanged")
    creds = await resolve_credentials(provider, fetcher.capability) if fetcher.requires_key else {}
    if fetcher.requires_key and not creds:
        result.status = "skipped"
        result.message = (
            f"No platform key for {provider}. Add one to the global model configuration "
            f"or set LANGUAGE_SYNC_{provider.upper()}_API_KEY."
        )
        return _finish(result)

    owns_client = client is None
    client = client or httpx.AsyncClient(timeout=HTTP_TIMEOUT)
    try:
        fetched = await fetcher.fetch(creds or {}, client)
    except FetchError as exc:
        result.status = "error"
        result.message = str(exc)
        logger.warning(f"Language sync failed for {provider}: {exc}")
        return _finish(result)
    finally:
        if owns_client:
            await client.aclose()

    existing = {
        row.model: row
        for row in await platform_client.list_language_catalog(
            provider=provider, capability=fetcher.capability
        )
    }
    unknown: set[str] = set()
    changed = False
    for model, codes in fetched.models.items():
        unknown.update(c for c in codes if get_locale(c).language_name == get_locale(c).language)
        row = existing.get(model)
        current = list(row.codes) if row and row.codes else _static_codes(provider, fetcher.capability, model)
        reason = review_change(current, codes)
        if reason:
            await platform_client.save_language_catalog_entry(
                provider=provider, capability=fetcher.capability, model=model,
                codes=None, voice_counts=None, pending_codes=codes, pending_reason=reason,
            )
            result.pending.append(model or "all models")
            continue
        if row is None or sorted(row.codes or []) != codes or row.pending_codes:
            changed = True
        await platform_client.save_language_catalog_entry(
            provider=provider,
            capability=fetcher.capability,
            model=model,
            codes=codes,
            voice_counts=fetched.voice_counts.get(model),
            pending_codes=None,
            pending_reason=None,
        )
        result.models[model or "all models"] = len(codes)

    store.invalidate(provider)
    result.unknown_codes = sorted(unknown)
    if unknown:
        logger.info(f"Language sync {provider}: codes without a display name: {sorted(unknown)}")
    if result.pending:
        result.status = "pending_review"
        result.message = f"{len(result.pending)} list(s) shrank a lot and wait for review"
    elif changed:
        result.status = "updated"
    return _finish(result)


async def sync_all(client: httpx.AsyncClient | None = None) -> list[ProviderSyncResult]:
    results = []
    for fetcher_id, fetcher in FETCHERS.items():
        try:
            results.append(await sync_provider(fetcher_id, client=client))
        except Exception as exc:  # one provider must never stop the others
            logger.exception(f"Language sync crashed for {fetcher_id}")
            results.append(
                _finish(ProviderSyncResult(fetcher.provider, fetcher.capability, "error", str(exc)))
            )
    return results


def _finish(result: ProviderSyncResult) -> ProviderSyncResult:
    result.finished_at = datetime.now(UTC).isoformat()
    return result


async def record_status(results: list[ProviderSyncResult]) -> dict:
    """Merge results into the status shown on the admin page."""
    current = await platform_client.get_platform_config_value(STATUS_KEY) or {}
    for r in results:
        key = f"{r.provider}:{r.capability}"
        entry = dict(current.get(key) or {})
        entry.update(
            capability=r.capability or entry.get("capability"),
            status=r.status,
            message=r.message,
            models=r.models or entry.get("models", {}),
            pending=r.pending,
            unknown_codes=r.unknown_codes,
            last_attempt_at=r.finished_at,
        )
        if r.status in ("updated", "unchanged", "pending_review"):
            entry["last_success_at"] = r.finished_at
        current[key] = entry
    await platform_client.upsert_platform_config(STATUS_KEY, current)
    return current


def result_dict(result: ProviderSyncResult) -> dict:
    return asdict(result)
