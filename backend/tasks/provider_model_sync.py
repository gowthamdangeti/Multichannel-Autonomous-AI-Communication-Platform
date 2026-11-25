"""Daily refresh of live model lists from provider APIs."""

from loguru import logger

from api.services.configuration.model_sync.sync import (
    execute_model_sync,
    record_model_sync_status,
)


async def sync_provider_models(ctx, force: bool = False) -> dict:
    results = await execute_model_sync(force=force)
    await record_model_sync_status(results)
    summary = {f"{r.provider}:{r.capability}": r.status for r in results}
    logger.info(f"Provider model sync finished: {summary}")
    return summary
