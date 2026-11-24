import asyncio
import logging
from typing import Dict, Any
from app.config import settings
from app.core.orchestrator.master import orchestrator
from app.schemas.orchestrator import ObjectiveSubmission

logger = logging.getLogger(__name__)

async def process_autonomous_objective(ctx: Dict[str, Any], objective: str) -> Dict[str, Any]:
    """Background ARQ worker task for long-running autonomous multi-agent workflows."""
    logger.info(f"Worker received background task: {objective}")
    submission = ObjectiveSubmission(objective=objective)
    result = await orchestrator.execute_objective(submission)
    logger.info(f"Worker finished workflow {result.get('workflow_id')}")
    return result

class WorkerSettings:
    functions = [process_autonomous_objective]
    redis_settings = settings.REDIS_URL
    max_jobs = 10
    job_timeout = 600

if __name__ == "__main__":
    logger.info("Starting Autonomous AI OS background worker...")
    print("Autonomous AI OS Worker initialized and listening on Redis queue.")
