from typing import List, Dict, Any, Optional
from datetime import datetime
from pydantic import BaseModel, Field

class WorkflowNode(BaseModel):
    id: str
    type: str = Field(..., description="agent, llm, tool, conditional, parallel, human_approval, verification, completion")
    title: str
    config: Dict[str, Any] = Field(default_factory=dict)
    position: Dict[str, float] = Field(default_factory=lambda: {"x": 0, "y": 0})

class WorkflowEdge(BaseModel):
    id: str
    source: str
    target: str
    condition: Optional[str] = None

class WorkflowGraph(BaseModel):
    nodes: List[WorkflowNode] = Field(default_factory=list)
    edges: List[WorkflowEdge] = Field(default_factory=list)

class WorkflowCreate(BaseModel):
    name: str
    description: Optional[str] = None
    graph: WorkflowGraph

class WorkflowResponse(BaseModel):
    id: str
    org_id: str
    name: str
    description: Optional[str] = None
    status: str
    version: int
    graph: Dict[str, Any]
    checkpoints: List[Dict[str, Any]] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
