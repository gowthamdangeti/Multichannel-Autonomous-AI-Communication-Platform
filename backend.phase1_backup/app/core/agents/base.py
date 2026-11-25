import abc
import time
import logging
from typing import Dict, Any, List, Optional
from app.schemas.agent import AgentExecutionResult
from app.schemas.task import TaskContract
from app.core.tools.registry import tool_registry
from app.core.tools.base import ToolResult
from app.core.llm.providers import llm_gateway, LLMResponse

logger = logging.getLogger(__name__)

class BaseAutonomousAgent(abc.ABC):
    """
    Standard base class for all autonomous agents in the Autonomous AI OS workforce.
    Provides execution lifecycle, tool calling, validation, model abstraction, and structured output formatting.
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

    async def call_llm(
        self,
        prompt: str,
        custom_system_prompt: Optional[str] = None,
        temperature: float = 0.2
    ) -> LLMResponse:
        """Call underlying LLM gateway with agent system prompt and provider fallback."""
        sys_prompt = custom_system_prompt or self.system_prompt
        return await llm_gateway.generate(
            prompt=prompt,
            system_prompt=sys_prompt,
            provider=self.model_provider,
            model=self.model_name,
            temperature=temperature
        )

    async def call_tool(
        self,
        task: TaskContract,
        tool_name: str,
        **kwargs
    ) -> ToolResult:
        """Execute a tool while enforcing task-level and agent-level permissions."""
        if tool_name not in self.tools:
            return ToolResult(
                success=False,
                output=None,
                error=f"Agent '{self.slug}' is not authorized to use tool '{tool_name}'."
            )
        return await tool_registry.execute_tool(
            tool_name=tool_name,
            caller_permissions=task.permissions,
            **kwargs
        )

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
