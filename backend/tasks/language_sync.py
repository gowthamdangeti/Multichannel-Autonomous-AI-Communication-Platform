"""Daily refresh of live language lists from provider APIs."""

from loguru import logger

from api.services.configuration.language_sync.sync import record_status, sync_all


async def sync_provider_languages(ctx) -> dict:
    results = await sync_all()
    await record_status(results)
    summary = {r.provider: r.status for r in results}
    logger.info(f"Provider language sync finished: {summary}")
    return summary
