"""Daily refresh of model prices."""

from loguru import logger

from api.services.configuration.pricing.sync import execute_price_sync, to_result_dicts


async def sync_model_prices(ctx) -> list[dict]:
    results = to_result_dicts(await execute_price_sync())
    logger.info(f"Model price sync finished: {results}")
    return results
