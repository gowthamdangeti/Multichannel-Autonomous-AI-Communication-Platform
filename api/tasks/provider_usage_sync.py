"""Background sync of billed usage after a run ends."""

from datetime import datetime

from arq import Retry
from loguru import logger

from api.services.provider_usage.sync import sync_provider_usage_for_run

FIRST_RUN_DELAY_SECONDS = 60
# Waits after attempts 1, 2 and 3: passes run about 1, 5, 15 and 60 minutes in.
# Soniox doesn't document how late records can land and has no "complete"
# signal, so each pass picks up whatever is new.
RETRY_DELAYS_SECONDS = (240, 600, 2700)
MAX_TRIES = len(RETRY_DELAYS_SECONDS) + 1


async def sync_provider_usage(ctx: dict, workflow_run_id: int, completed_at: str) -> int:
    attempt = int(ctx.get("job_try") or 1)
    outcome = await sync_provider_usage_for_run(
        workflow_run_id=workflow_run_id,
        completed_at=datetime.fromisoformat(completed_at),
        is_last_attempt=attempt >= MAX_TRIES,
    )
    logger.info(
        f"Provider usage sync for run {workflow_run_id}: "
        f"attempt {attempt}/{MAX_TRIES}, {outcome.found} records"
    )
    if outcome.should_retry and attempt < MAX_TRIES:
        raise Retry(defer=RETRY_DELAYS_SECONDS[attempt - 1])
    return outcome.found
