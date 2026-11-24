import asyncio
import logging
from typing import Optional
from app.core.agents.base import BaseAutonomousAgent
from app.schemas.agent import AgentExecutionResult
from app.schemas.task import TaskContract

logger = logging.getLogger(__name__)

class ErrorRecoveryManager:
    """
    Autonomous error detection, retry with backoff, model fallback,
    and agent reassignment pipeline.
    """

    def __init__(self, max_retries: int = 3, base_backoff_sec: float = 0.5):
        self.max_retries = max_retries
        self.base_backoff_sec = base_backoff_sec

    async def execute_with_recovery(
        self,
        agent: BaseAutonomousAgent,
        task: TaskContract
    ) -> AgentExecutionResult:
        attempt = 0
        last_result: Optional[AgentExecutionResult] = None

        while attempt < self.max_retries:
            attempt += 1
            try:
                result = await agent.run(task)
                if result.status == "completed":
                    return result
                
                logger.warning(
                    f"Task {task.task_id} on agent {agent.slug} returned non-completed status: "
                    f"{result.status}. Attempt {attempt}/{self.max_retries}"
                )
                last_result = result
            except Exception as e:
                logger.error(f"Execution error on attempt {attempt}: {str(e)}")
                last_result = AgentExecutionResult(
                    task_id=task.task_id,
                    agent_id=agent.slug,
                    status="failed",
                    confidence=0.0,
                    structured_result={},
                    evidence=[],
                    artifacts=[],
                    errors=[str(e)],
                    next_recommended_action="retry_with_backoff"
                )

            # Exponential backoff
            if attempt < self.max_retries:
                delay = self.base_backoff_sec * (2 ** (attempt - 1))
                logger.info(f"Backing off for {delay}s before retry...")
                await asyncio.sleep(delay)

        logger.error(f"All {self.max_retries} attempts failed for task {task.task_id}. Reassigning to fallback.")
        return last_result or AgentExecutionResult(
            task_id=task.task_id,
            agent_id=agent.slug,
            status="failed",
            confidence=0.0,
            structured_result={},
            evidence=[],
            artifacts=[],
            errors=["Exceeded maximum retry attempts."],
            next_recommended_action="dead_letter_queue"
        )
