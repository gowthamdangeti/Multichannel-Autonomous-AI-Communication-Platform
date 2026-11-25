import logging
from typing import Optional
from arq import create_pool
from arq.connections import RedisSettings, ArqRedis
from app.config import settings

logger = logging.getLogger(__name__)

_redis_pool: Optional[ArqRedis] = None

async def get_redis_pool() -> ArqRedis:
    global _redis_pool
    if _redis_pool is None:
        _redis_pool = await create_pool(RedisSettings.from_dsn(settings.REDIS_URL))
    return _redis_pool

async def enqueue_objective_job(objective: str) -> Optional[str]:
    """Enqueue a long-running autonomous workflow job to ARQ background worker."""
    try:
        pool = await get_redis_pool()
        job = await pool.enqueue_job("process_autonomous_objective", objective)
        logger.info(f"Enqueued autonomous workflow job [{job.job_id}] to ARQ worker queue.")
        return job.job_id
    except Exception as e:
        logger.warning(f"Could not enqueue job to ARQ worker: {e}. Executing in synchronous fallback mode.")
        return None
