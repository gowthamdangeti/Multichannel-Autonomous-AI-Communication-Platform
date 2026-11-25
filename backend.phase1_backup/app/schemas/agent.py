from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field

class AgentBase(BaseModel):
    name: str = Field(..., example="Senior Research Analyst")
    slug: str = Field(..., example="senior-research-analyst")
    department: str = Field(..., example="Research and Intelligence")
    role: str = Field(..., example="Autonomous Information Gathering & Synthesis")
    description: Optional[str] = None
    system_prompt: str
    model_provider: str = Field(default="openai", example="openai")
    model_name: str = Field(default="gpt-4o", example="gpt-4o")
    autonomy_level: str = Field(default="semi-autonomous")
    capabilities: List[str] = Field(default_factory=list)
    tools: List[str] = Field(default_factory=list)
    temperature: float = 0.2
    max_tokens: int = 4096

class AgentCreate(AgentBase):
    org_id: Optional[str] = None

class AgentResponse(AgentBase):
    id: str
    org_id: str
    status: str
    is_active: bool
    success_rate: float
    total_tasks_completed: float
    average_duration_ms: float

    class Config:
        from_attributes = True

class AgentExecutionResult(BaseModel):
    task_id: str = Field(..., description="Task identifier")
    agent_id: str = Field(..., description="Agent identifier")
    status: str = Field(..., description="Execution status: completed, failed, blocked")
    structured_result: Dict[str, Any] = Field(default_factory=dict, description="Structured execution payload")
    confidence: float = Field(default=1.0, ge=0.0, le=1.0, description="Confidence score")
    evidence: List[str] = Field(default_factory=list, description="Reasoning and sources")
    artifacts: List[Dict[str, Any]] = Field(default_factory=list, description="Generated artifacts or documents")
    errors: List[str] = Field(default_factory=list, description="Execution errors if any")
    next_recommended_action: Optional[str] = Field(None, description="Suggested next action or delegation")
