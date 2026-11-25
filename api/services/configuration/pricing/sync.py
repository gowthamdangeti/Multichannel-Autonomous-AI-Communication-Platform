"""Refresh stored prices from every source.

Safety rules:
- A failed or empty fetch changes nothing, and one source can't stop another.
- A model seen for the first time is stored straight away.
- A changed price is parked as *pending* for an admin; the old price stays in
  use until then, so a bad feed value can't reach users.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from decimal import Decimal
from typing import Awaitable, Callable

import httpx
from loguru import logger

from api.db.model_price_client import ModelPriceClient
from api.services.configuration.pricing.entries import (
    PriceEntry,
    PriceSource,
    ReviewStatus,
)
from api.services.configuration.pricing.feeds import (
    HTTP_TIMEOUT,
    PriceFetchError,
    fetch_litellm_prices,
    fetch_openrouter_prices,
)
from api.services.configuration.pricing.official_prices import (
    VERIFIED_ON,
    list_official_prices,
)


@dataclass
class SourceSyncResult:
    source: str
    status: str  # "updated" | "failed" | "skipped"
    added: int = 0
    pending: int = 0
    unchanged: int = 0
    message: str = ""


@dataclass(frozen=True)
class SourceDiff:
    new_entries: list[PriceEntry]
    pending_entries: list[PriceEntry]
    verified_ids: list[int]
    superseded_pending_ids: list[int]


def _same_price(row, entry: PriceEntry) -> bool:
    """Compare the price per unit, so 0.06/min and 3.6/hr count as equal."""
    return (
        row.currency == entry.currency
        and Decimal(row.rate) / row.unit_quantity == entry.rate / entry.unit_quantity
    )


def compare_prices(*, rows: list, entries: list[PriceEntry]) -> SourceDiff:
    """Pure diff between stored rows of one source and a fresh fetch."""
    approved = {}
    pending = {}
    for row in rows:
        key = (row.provider, row.capability, row.model_id, row.component)
        target = pending if row.review_status == ReviewStatus.PENDING.value else approved
        target[key] = row

    new_entries: list[PriceEntry] = []
    pending_entries: list[PriceEntry] = []
    verified_ids: list[int] = []
    superseded: list[int] = []
    for entry in entries:
        current = approved.get(entry.key)
        waiting = pending.get(entry.key)
        if current is None:
            new_entries.append(entry)
        elif _same_price(current, entry):
            verified_ids.append(current.id)
            if waiting is not None:
                superseded.append(waiting.id)
        elif waiting is None:
            pending_entries.append(entry)
        elif not _same_price(waiting, entry):
            superseded.append(waiting.id)
            pending_entries.append(entry)
    return SourceDiff(new_entries, pending_entries, verified_ids, superseded)


async def _store_entries(
    *,
    source: PriceSource,
    entries: list[PriceEntry],
    verified_at: datetime,
    price_client: ModelPriceClient,
) -> SourceSyncResult:
    rows = await price_client.list_source_prices(source=source.value)
    diff = compare_prices(rows=rows, entries=entries)
    await price_client.apply_source_sync(
        new_entries=diff.new_entries,
        pending_entries=diff.pending_entries,
        verified_ids=diff.verified_ids,
        superseded_pending_ids=diff.superseded_pending_ids,
        verified_at=verified_at,
    )
    return SourceSyncResult(
        source=source.value,
        status="updated",
        added=len(diff.new_entries),
        pending=len(diff.pending_entries),
        unchanged=len(diff.verified_ids),
    )


async def _sync_fetched_source(
    *,
    source: PriceSource,
    fetch: Callable[[httpx.AsyncClient], Awaitable[list[PriceEntry]]],
    client: httpx.AsyncClient,
    price_client: ModelPriceClient,
) -> SourceSyncResult:
    try:
        entries = await fetch(client)
    except PriceFetchError as exc:
        logger.warning(f"Price sync failed for {source.value}: {exc}")
        return SourceSyncResult(source=source.value, status="failed", message=str(exc))
    if not entries:
        return SourceSyncResult(source=source.value, status="skipped", message="Source returned no prices")
    return await _store_entries(
        source=source,
        entries=entries,
        verified_at=datetime.now(UTC),
        price_client=price_client,
    )


async def execute_price_sync(*, client: httpx.AsyncClient | None = None) -> list[SourceSyncResult]:
    price_client = ModelPriceClient()
    owns_client = client is None
    http = client or httpx.AsyncClient(timeout=HTTP_TIMEOUT, follow_redirects=True)
    results: list[SourceSyncResult] = []
    try:
        results.append(
            await _store_entries(
                source=PriceSource.OFFICIAL,
                entries=list_official_prices(),
                verified_at=VERIFIED_ON,
                price_client=price_client,
            )
        )
        for source, fetch in (
            (PriceSource.PROVIDER_API, fetch_openrouter_prices),
            (PriceSource.FEED, fetch_litellm_prices),
        ):
            try:
                results.append(
                    await _sync_fetched_source(
                        source=source, fetch=fetch, client=http, price_client=price_client
                    )
                )
            except Exception as exc:  # one source must never stop the others
                logger.exception(f"Price sync crashed for {source.value}")
                results.append(
                    SourceSyncResult(source=source.value, status="failed", message=type(exc).__name__)
                )
    finally:
        if owns_client:
            await http.aclose()
    return results


def to_result_dicts(results: list[SourceSyncResult]) -> list[dict]:
    return [asdict(result) for result in results]
