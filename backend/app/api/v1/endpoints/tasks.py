from typing import List
from fastapi import APIRouter
from app.schemas.task import TaskResponse

router = APIRouter()

@router.get("/")
async def list_tasks():
    """List recent autonomous tasks."""
    return [
        {
            "id": "task-001",
            "title": "Analyze Enterprise LLM Evaluation Frameworks",
            "objective": "Survey current benchmarks for autonomous agents in production",
            "status": "completed",
            "priority": "high",
            "assigned_agent": "senior-researcher",
            "confidence": 0.96,
            "created_at": "2026-11-24T14:30:00Z",
            "updated_at": "2026-11-24T14:30:02Z"
        },
        {
            "id": "task-002",
            "title": "Autonomous Backend Architecture Verification",
            "objective": "Verify type safety and hexagonal port contracts",
            "status": "completed",
            "priority": "medium",
            "assigned_agent": "lead-software-architect",
            "confidence": 0.98,
            "created_at": "2026-11-24T14:35:00Z",
            "updated_at": "2026-11-24T14:35:01Z"
        }
    ]
