import uuid
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.task import TaskModel
from app.models.audit import AuditLog
from app.core.events import ws_manager

logger = logging.getLogger(__name__)

class HITLManager:
    """Enterprise Human-in-the-Loop Gating and Governance Manager."""

    async def create_request(
        self,
        db: AsyncSession,
        agent_slug: str,
        action: str,
        risk_level: str,
        summary: str,
        payload: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        task_id = f"appr-{uuid.uuid4().hex[:6]}"
        task = TaskModel(
            id=task_id,
            title=action,
            objective=summary,
            status="waiting_approval",
            priority=risk_level,
            input_data=payload or {},
            execution_metadata={
                "agent": agent_slug,
                "risk_level": risk_level,
                "summary": summary
            }
        )
        db.add(task)

        audit = AuditLog(
            org_id="org-default",
            action="hitl_request_created",
            entity_type="task",
            entity_id=task_id,
            details={"agent": agent_slug, "action": action, "risk_level": risk_level}
        )
        db.add(audit)
        await db.commit()

        req_data = {
            "id": task_id,
            "agent": agent_slug,
            "action": action,
            "risk_level": risk_level,
            "summary": summary,
            "status": "pending",
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        await ws_manager.broadcast({"type": "hitl_request_pending", "data": req_data})
        return req_data

    async def list_pending(self, db: AsyncSession) -> List[Dict[str, Any]]:
        query = select(TaskModel).where(TaskModel.status == "waiting_approval").order_by(TaskModel.created_at.desc())
        res = await db.execute(query)
        tasks = res.scalars().all()
        return [
            {
                "id": t.id,
                "agent": t.execution_metadata.get("agent", "autonomous-agent"),
                "action": t.title,
                "risk_level": t.execution_metadata.get("risk_level", "medium"),
                "summary": t.objective,
                "status": "pending",
                "created_at": t.created_at.isoformat() if t.created_at else None
            }
            for t in tasks
        ]

    async def decide(
        self,
        db: AsyncSession,
        request_id: str,
        decision: str,  # 'approved' or 'rejected'
        decided_by: str = "security-officer",
        comment: str = ""
    ) -> Dict[str, Any]:
        task = (await db.execute(select(TaskModel).where(TaskModel.id == request_id))).scalar_one_or_none()
        if not task:
            return {"status": "error", "message": f"Approval request {request_id} not found."}

        new_status = "completed" if decision == "approved" else "failed"
        task.status = new_status
        task.execution_metadata["decision"] = decision
        task.execution_metadata["decided_by"] = decided_by
        task.execution_metadata["decision_comment"] = comment

        audit = AuditLog(
            org_id="org-default",
            action=f"hitl_{decision}",
            entity_type="task",
            entity_id=request_id,
            details={"decided_by": decided_by, "comment": comment}
        )
        db.add(audit)
        await db.commit()

        event_data = {"type": f"hitl_{decision}", "request_id": request_id, "decided_by": decided_by}
        await ws_manager.broadcast(event_data)
        return {"status": decision, "request_id": request_id}

hitl_manager = HITLManager()
