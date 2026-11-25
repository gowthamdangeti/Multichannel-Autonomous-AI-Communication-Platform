from typing import List, Dict, Any, Optional
from datetime import datetime
from pydantic import BaseModel, Field

class TaskContract(BaseModel):
    task_id: str = Field(..., description="Task ID")
    parent_task_id: Optional[str] = Field(None, description="Parent task ID")
    workflow_id: Optional[str] = Field(None, description="Workflow ID")
    assigned_agent: Optional[str] = Field(None, description="Assigned agent ID or role")
    objective: str = Field(..., description="Clear objective of the task")
    input_data: Dict[str, Any] = Field(default_factory=dict, description="Input data payload")
    constraints: List[str] = Field(default_factory=list, description="Operational constraints")
    permissions: List[str] = Field(default_factory=list, description="Authorized tools and actions")
    success_criteria: List[str] = Field(default_factory=list, description="Verification criteria")
    deadline: Optional[datetime] = Field(None, description="Execution deadline")
    execution_metadata: Dict[str, Any] = Field(default_factory=dict, description="Execution metadata")

class TaskCreate(BaseModel):
    title: str
    objective: str
    assigned_agent: Optional[str] = None
    workflow_id: Optional[str] = None
    parent_task_id: Optional[str] = None
    input_data: Dict[str, Any] = Field(default_factory=dict)
    constraints: List[str] = Field(default_factory=list)
    permissions: List[str] = Field(default_factory=list)
    success_criteria: List[str] = Field(default_factory=list)
    priority: str = "medium"

class TaskResponse(BaseModel):
    id: str
    title: str
    objective: str
    status: str
    priority: str
    assigned_agent: Optional[str] = None
    workflow_id: Optional[str] = None
    parent_task_id: Optional[str] = None
    input_data: Dict[str, Any] = Field(default_factory=dict)
    output_data: Dict[str, Any] = Field(default_factory=dict)
    confidence: float = 1.0
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
