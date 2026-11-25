from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.task import TaskModel

router = APIRouter()

@router.get("/")
async def list_tasks(
    status: Optional[str] = Query(None),
    agent_id: Optional[str] = Query(None),
    limit: int = Query(100),
    db: AsyncSession = Depends(get_db)
):
    """List recent autonomous tasks directly from PostgreSQL with filtering."""
    query = select(TaskModel)
    if status:
        query = query.where(TaskModel.status == status)
    if agent_id:
        query = query.where((TaskModel.agent_id == agent_id) | (TaskModel.execution_metadata["agent_id"].as_string() == agent_id))
    query = query.order_by(TaskModel.created_at.desc()).limit(limit)
    result = await db.execute(query)
    tasks = result.scalars().all()

    return [
        {
            "id": t.id,
            "workflow_id": t.workflow_id,
            "title": t.title,
            "objective": t.objective,
            "status": t.status,
            "priority": t.priority,
            "agent_id": t.agent_id or t.execution_metadata.get("agent_id"),
            "assigned_agent": t.execution_metadata.get("agent_id") or t.execution_metadata.get("assigned_agent") or "autonomous-agent",
            "confidence": t.confidence or 0.95,
            "input_data": t.input_data or {},
            "output_data": t.output_data or {},
            "constraints": t.constraints or [],
            "permissions": t.permissions or [],
            "execution_metadata": t.execution_metadata or {},
            "error_message": t.error_message,
            "created_at": t.created_at.isoformat() if t.created_at else None,
            "updated_at": t.updated_at.isoformat() if t.updated_at else None
        }
        for t in tasks
    ]

@router.get("/{task_id}")
async def get_task_details(task_id: str, db: AsyncSession = Depends(get_db)):
    """Retrieve full execution contract and output details for a specific task."""
    task = (await db.execute(select(TaskModel).where(TaskModel.id == task_id))).scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found.")
    return {
        "id": task.id,
        "workflow_id": task.workflow_id,
        "title": task.title,
        "objective": task.objective,
        "status": task.status,
        "priority": task.priority,
        "agent_id": task.agent_id,
        "assigned_agent": task.execution_metadata.get("agent_id") or "autonomous-agent",
        "confidence": task.confidence or 0.95,
        "input_data": task.input_data or {},
        "output_data": task.output_data or {},
        "constraints": task.constraints or [],
        "permissions": task.permissions or [],
        "execution_metadata": task.execution_metadata or {},
        "error_message": task.error_message,
        "created_at": task.created_at.isoformat() if task.created_at else None,
        "updated_at": task.updated_at.isoformat() if task.updated_at else None
    }
