import abc
import time
import logging
from typing import Dict, Any, List, Optional
from app.schemas.agent import AgentExecutionResult
from app.schemas.task import TaskContract

logger = logging.getLogger(__name__)

class BaseAutonomousAgent(abc.ABC):
    """
    Standard base class for all autonomous agents in the Autonomous AI OS workforce.
    Provides execution lifecycle, tool calling, validation, and structured output formatting.
    """
    slug: str
    name: str
    department: str
    role: str
    description: str
    system_prompt: str
    model_provider: str = "openai"
    model_name: str = "gpt-4o"
    capabilities: List[str] = []
    tools: List[str] = []

    def __init__(self, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)

    @abc.abstractmethod
    async def execute_task(self, task: TaskContract) -> AgentExecutionResult:
        """Execute the assigned task contract and return a verified result."""
        pass

    async def run(self, task: TaskContract) -> AgentExecutionResult:
        start_time = time.time()
        logger.info(f"Agent [{self.slug}] starting task [{task.task_id}]: {task.objective}")
        try:
            result = await self.execute_task(task)
            duration_ms = (time.time() - start_time) * 1000
            result.structured_result["_meta"] = {
                "duration_ms": round(duration_ms, 2),
                "agent_slug": self.slug,
                "department": self.department
            }
            return result
        except Exception as e:
            logger.error(f"Agent [{self.slug}] failed on task [{task.task_id}]: {str(e)}", exc_info=True)
            return AgentExecutionResult(
                task_id=task.task_id,
                agent_id=self.slug,
                status="failed",
                confidence=0.0,
                structured_result={},
                evidence=[f"Execution failed due to exception: {type(e).__name__}"],
                artifacts=[],
                errors=[str(e)],
                next_recommended_action="escalate_to_orchestrator_recovery"
            )
