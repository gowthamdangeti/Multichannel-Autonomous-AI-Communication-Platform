from typing import List
from fastapi import APIRouter, HTTPException
from app.core.agents.registry import registry
from app.schemas.agent import AgentResponse, AgentExecutionResult
from app.schemas.task import TaskContract

router = APIRouter()

@router.get("/", response_model=List[dict])
async def list_agents():
    """List all registered autonomous agents across departments."""
    agents = registry.list_all()
    return [
        {
            "id": a.slug,
            "slug": a.slug,
            "name": a.name,
            "department": a.department,
            "role": a.role,
            "description": a.description,
            "capabilities": a.capabilities,
            "tools": a.tools,
            "status": "idle",
            "is_active": True,
            "success_rate": 98.5,
            "total_tasks_completed": 128,
            "average_duration_ms": 320.0
        }
        for a in agents
    ]

@router.get("/{slug}")
async def get_agent(slug: str):
    """Retrieve details for a specific autonomous agent."""
    agent = registry.get(slug)
    if not agent:
        raise HTTPException(status_code=404, detail=f"Agent '{slug}' not found.")
    return {
        "id": agent.slug,
        "slug": agent.slug,
        "name": agent.name,
        "department": agent.department,
        "role": agent.role,
        "description": agent.description,
        "system_prompt": agent.system_prompt,
        "capabilities": agent.capabilities,
        "tools": agent.tools,
        "model_provider": agent.model_provider,
        "model_name": agent.model_name
    }

@router.post("/{slug}/execute", response_model=AgentExecutionResult)
async def execute_agent_task(slug: str, task: TaskContract):
    """Execute a specific task directly against a specialized agent."""
    agent = registry.get(slug)
    if not agent:
        raise HTTPException(status_code=404, detail=f"Agent '{slug}' not found.")
    return await agent.run(task)
