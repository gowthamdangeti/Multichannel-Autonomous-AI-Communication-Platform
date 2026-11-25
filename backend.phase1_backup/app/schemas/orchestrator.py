from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field

class ObjectiveSubmission(BaseModel):
    objective: str = Field(..., description="High-level user natural language objective", example="Analyze the latest competitive landscape in autonomous AI agents and generate a comprehensive executive summary")
    constraints: List[str] = Field(default_factory=list, example=["Strict enterprise data privacy", "Response within 60 seconds"])
    require_human_approval: bool = Field(default=False)
    target_department: Optional[str] = None

class PlanStep(BaseModel):
    step_id: str
    title: str
    description: str
    department: str
    assigned_agent_slug: str
    dependencies: List[str] = Field(default_factory=list)
    action_type: str = "agent"  # agent, tool, approval, verification
    input_payload: Dict[str, Any] = Field(default_factory=dict)

class ExecutionPlan(BaseModel):
    objective: str
    category: str
    confidence: float
    reasoning: str
    steps: List[PlanStep] = Field(default_factory=list)
    estimated_duration_sec: int = 30
