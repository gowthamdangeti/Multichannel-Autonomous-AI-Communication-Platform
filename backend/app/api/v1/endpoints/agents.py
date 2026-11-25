from typing import List
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.agent import AgentModel
from app.core.agents.registry import registry
from app.schemas.agent import AgentResponse, AgentExecutionResult
from app.schemas.task import TaskContract

router = APIRouter()

@router.get("/", response_model=List[dict])
async def list_agents(db: AsyncSession = Depends(get_db)):
    """List all registered autonomous agents enriched with real PostgreSQL runtime statistics."""
    db_result = await db.execute(select(AgentModel))
    db_agents = {a.slug: a for a in db_result.scalars().all()}
    agents = registry.list_all()

    response = []
    for a in agents:
        db_rec = db_agents.get(a.slug)
        response.append({
            "id": a.slug,
            "slug": a.slug,
            "name": a.name,
            "department": a.department,
            "role": a.role,
            "description": a.description,
            "capabilities": a.capabilities,
            "tools": a.tools,
            "status": db_rec.status if db_rec else "idle",
            "is_active": db_rec.is_active if db_rec else True,
            "success_rate": db_rec.success_rate if db_rec else 100.0,
            "total_tasks_completed": int(db_rec.total_tasks_completed) if db_rec and db_rec.total_tasks_completed else 0,
            "average_duration_ms": db_rec.average_duration_ms if db_rec else 0.0
        })
    return response

@router.post("/", response_model=dict)
async def create_custom_agent(payload: dict, db: AsyncSession = Depends(get_db)):
    """Dynamically register a new custom agent in PostgreSQL."""
    slug = payload.get("slug") or payload.get("name", "").lower().replace(" ", "-")
    db_agent = AgentModel(
        id=f"agent-{slug}",
        org_id="org-default",
        name=payload["name"],
        slug=slug,
        department=payload.get("department", "Custom Workforce"),
        role=payload.get("role", "Specialized Autonomous Agent"),
        description=payload.get("description", ""),
        system_prompt=payload.get("system_prompt", "You are an autonomous AI OS agent."),
        model_provider=payload.get("model_provider", "openai"),
        model_name=payload.get("model_name", "gpt-4o"),
        capabilities=payload.get("capabilities", ["task_execution"]),
        tools=payload.get("tools", ["web_search", "document_parser"]),
        is_active=True
    )
    db.add(db_agent)
    await db.commit()
    return {"status": "created", "slug": slug, "name": payload["name"]}

@router.get("/{slug}")
async def get_agent(slug: str, db: AsyncSession = Depends(get_db)):
    """Retrieve details for a specific autonomous agent."""
    agent = registry.get(slug)
    if not agent:
        raise HTTPException(status_code=404, detail=f"Agent '{slug}' not found.")
    
    agent_rec = (await db.execute(select(AgentModel).where(AgentModel.slug == slug))).scalar_one_or_none()

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
        "model_name": agent.model_name,
        "status": agent_rec.status if agent_rec else "idle",
        "total_tasks_completed": int(agent_rec.total_tasks_completed) if agent_rec and agent_rec.total_tasks_completed else 0,
        "success_rate": agent_rec.success_rate if agent_rec else 100.0
    }

@router.post("/{slug}/execute", response_model=AgentExecutionResult)
async def execute_agent_task(slug: str, task: TaskContract, db: AsyncSession = Depends(get_db)):
    """Execute a specific task directly against a specialized agent and log execution."""
    agent = registry.get(slug)
    if not agent:
        raise HTTPException(status_code=404, detail=f"Agent '{slug}' not found.")
    
    result = await agent.run(task)
    
    # Update stats in database
    agent_rec = (await db.execute(select(AgentModel).where(AgentModel.slug == slug))).scalar_one_or_none()
    if agent_rec:
        agent_rec.total_tasks_completed = (agent_rec.total_tasks_completed or 0) + 1
        await db.commit()

    return result
