import abc
from typing import Dict, Any, List, Optional
from pydantic import BaseModel

class ToolResult(BaseModel):
    success: bool
    output: Any
    error: Optional[str] = None
    execution_time_ms: float = 0.0

class BaseTool(abc.ABC):
    """Abstract base class for all tools accessible by Autonomous AI OS agents."""
    name: str
    description: str
    required_permissions: List[str] = []

    @abc.abstractmethod
    async def execute(self, **kwargs) -> ToolResult:
        pass
