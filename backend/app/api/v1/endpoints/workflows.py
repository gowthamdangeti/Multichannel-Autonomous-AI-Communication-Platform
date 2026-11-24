from typing import List, Dict, Any
from fastapi import APIRouter, HTTPException
from app.schemas.orchestrator import ObjectiveSubmission, ExecutionPlan
from app.core.orchestrator.planner import StrategicPlanner
from app.core.orchestrator.master import orchestrator

router = APIRouter()

@router.post("/plan", response_model=ExecutionPlan)
async def generate_workflow_plan(submission: ObjectiveSubmission):
    """
    Generate an autonomous execution plan from a natural-language objective
    without executing it.
    """
    return StrategicPlanner.plan(submission)

@router.post("/execute", response_model=Dict[str, Any])
async def execute_objective(submission: ObjectiveSubmission):
    """
    Execute a natural-language objective end-to-end through the Master Orchestrator.
    Decomposes objective, coordinates agents, executes tasks, recovers errors, and delivers artifacts.
    """
    return await orchestrator.execute_objective(submission)

@router.get("/")
async def list_recent_workflows():
    """List recent autonomous workflows."""
    return [
        {
            "id": "wf-seed-001",
            "name": "Autonomous Market Intelligence & Analysis",
            "status": "completed",
            "steps_count": 3,
            "confidence": 0.98,
            "created_at": "2026-11-24T12:00:00Z"
        }
    ]
