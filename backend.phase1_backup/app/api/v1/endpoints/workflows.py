from typing import List, Dict, Any
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.workflow import WorkflowModel
from app.models.task import TaskModel
from app.models.audit import AuditLog
from app.models.agent import AgentModel
from app.schemas.orchestrator import ObjectiveSubmission, ExecutionPlan
from app.core.orchestrator.planner import StrategicPlanner
from app.core.orchestrator.master import orchestrator
from app.core.events import ws_manager

from app.workers.client import enqueue_objective_job

router = APIRouter()

@router.post("/enqueue")
async def enqueue_workflow(submission: ObjectiveSubmission):
    """Enqueue an autonomous objective to ARQ background worker."""
    job_id = await enqueue_objective_job(submission.objective)
    return {
        "status": "queued",
        "job_id": job_id,
        "objective": submission.objective,
        "mode": "background_arq_worker"
    }

@router.post("/{workflow_id}/pause")
async def pause_workflow(workflow_id: str, db: AsyncSession = Depends(get_db)):
    """Pause an active workflow."""
    wf = (await db.execute(select(WorkflowModel).where(WorkflowModel.id == workflow_id))).scalar_one_or_none()
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found.")
    wf.status = "paused"
    await db.commit()
    await ws_manager.broadcast({"type": "workflow_paused", "workflow_id": workflow_id})
    return {"status": "paused", "workflow_id": workflow_id}

@router.post("/{workflow_id}/resume")
async def resume_workflow(workflow_id: str, db: AsyncSession = Depends(get_db)):
    """Resume a paused workflow."""
    wf = (await db.execute(select(WorkflowModel).where(WorkflowModel.id == workflow_id))).scalar_one_or_none()
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found.")
    wf.status = "running"
    await db.commit()
    await ws_manager.broadcast({"type": "workflow_resumed", "workflow_id": workflow_id})
    return {"status": "resumed", "workflow_id": workflow_id}

@router.post("/{workflow_id}/cancel")
async def cancel_workflow(workflow_id: str, db: AsyncSession = Depends(get_db)):
    """Cancel a workflow."""
    wf = (await db.execute(select(WorkflowModel).where(WorkflowModel.id == workflow_id))).scalar_one_or_none()
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found.")
    wf.status = "failed"
    await db.commit()
    await ws_manager.broadcast({"type": "workflow_cancelled", "workflow_id": workflow_id})
    return {"status": "cancelled", "workflow_id": workflow_id}

@router.post("/plan", response_model=ExecutionPlan)
async def generate_workflow_plan(submission: ObjectiveSubmission):
    """
    Generate an autonomous execution plan from a natural-language objective
    without executing it.
    """
    return StrategicPlanner.plan(submission)

@router.post("/execute", response_model=Dict[str, Any])
async def execute_objective(
    submission: ObjectiveSubmission,
    db: AsyncSession = Depends(get_db)
):
    """
    Execute a natural-language objective end-to-end through the Master Orchestrator,
    persist the execution and tasks to PostgreSQL, and broadcast events in real-time.
    """
    await ws_manager.broadcast({
        "type": "workflow_started",
        "objective": submission.objective,
        "constraints": submission.constraints
    })

    result = await orchestrator.execute_objective(submission)
    workflow_id = result.get("workflow_id")

    # Persist artifacts to MinIO
    from app.core.storage.minio_client import storage_client
    for i, art in enumerate(result.get("artifacts", [])):
        art_title = art.get("title", f"artifact_{i}").replace(" ", "_").replace("/", "_")[:35]
        ext = ".py" if art.get("type") == "code" else ".json" if art.get("type") == "json" else ".md"
        filename = f"{art_title}{ext}"
        storage_url = await storage_client.upload_artifact(
            workflow_id=workflow_id,
            filename=filename,
            content=art.get("content", ""),
            content_type="text/plain"
        )
        if storage_url:
            art["storage_url"] = storage_url

    # Persist workflow to PostgreSQL
    try:
        db_workflow = WorkflowModel(
            id=workflow_id,
            org_id="org-default",
            name=submission.objective[:200],
            description=submission.objective,
            status=result.get("status", "completed"),
            execution_context={
                "category": result.get("category"),
                "confidence": result.get("confidence"),
                "duration_sec": result.get("duration_sec"),
                "artifacts_count": len(result.get("artifacts", [])),
                "summary": result.get("summary")
            }
        )
        db.add(db_workflow)

        # Persist associated tasks
        step_results = result.get("step_results", {})
        for step_id, step_data in step_results.items():
            agent_slug = step_data.get("agent_id")
            db_task = TaskModel(
                id=step_data.get("task_id", f"task-{step_id}"),
                workflow_id=workflow_id,
                title=f"Execute: {agent_slug}",
                objective=submission.objective,
                status=step_data.get("status", "completed"),
                priority="high",
                input_data=step_data.get("structured_result", {}),
                output_data={"evidence": step_data.get("evidence", []), "artifacts": step_data.get("artifacts", [])},
                confidence=step_data.get("confidence", 1.0),
                execution_metadata={"duration_ms": step_data.get("structured_result", {}).get("_meta", {}).get("duration_ms", 0)}
            )
            db.add(db_task)

            # Update agent statistics in DB
            if agent_slug:
                agent_query = await db.execute(select(AgentModel).where(AgentModel.slug == agent_slug))
                agent_row = agent_query.scalar_one_or_none()
                if agent_row:
                    agent_row.total_tasks_completed = (agent_row.total_tasks_completed or 0) + 1
                    agent_row.status = "idle"

        # Record audit log
        audit_entry = AuditLog(
            org_id="org-default",
            action="workflow_execution",
            entity_type="workflow",
            entity_id=workflow_id,
            details={"status": result.get("status"), "objective": submission.objective[:100]}
        )
        db.add(audit_entry)
        await db.commit()
    except Exception as e:
        await db.rollback()

    await ws_manager.broadcast({
        "type": "workflow_completed",
        "workflow_id": workflow_id,
        "status": result.get("status"),
        "duration_sec": result.get("duration_sec")
    })

    return result

@router.get("/")
async def list_recent_workflows(db: AsyncSession = Depends(get_db)):
    """List recent autonomous workflows from PostgreSQL."""
    query = select(WorkflowModel).order_by(WorkflowModel.created_at.desc()).limit(50)
    result = await db.execute(query)
    workflows = result.scalars().all()

    return [
        {
            "id": wf.id,
            "name": wf.name,
            "status": wf.status,
            "confidence": wf.execution_context.get("confidence", 0.95) if wf.execution_context else 0.95,
            "steps_count": len(wf.tasks) if wf.tasks else 3,
            "created_at": wf.created_at.isoformat() if wf.created_at else None,
            "summary": wf.execution_context.get("summary") if wf.execution_context else None
        }
        for wf in workflows
    ]
