from fastapi import APIRouter, Depends
from typing import List, Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.core.governance.hitl import hitl_manager

router = APIRouter()

@router.get("/pending")
async def list_pending_hitl(db: AsyncSession = Depends(get_db)) -> List[Dict[str, Any]]:
    """Return pending human-in-the-loop approval actions from PostgreSQL."""
    items = await hitl_manager.list_pending(db)
    if not items:
        # Seed initial pending approvals into DB if none exist
        await hitl_manager.create_request(
            db=db,
            agent_slug="lead-software-architect",
            action="Deploy Autonomous Service to Production Cluster",
            risk_level="high",
            summary="Requesting authorization to apply Terraform and deploy container image to production namespace."
        )
        await hitl_manager.create_request(
            db=db,
            agent_slug="communications-director",
            action="Send Multi-Channel Executive Stakeholder Memo",
            risk_level="medium",
            summary="Requesting authorization to broadcast Q4 AI Workforce Strategy to 45 leadership email recipients."
        )
        items = await hitl_manager.list_pending(db)
    return items

@router.post("/{action_id}/approve")
async def approve_hitl(action_id: str, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    """Authorize a sensitive action and record in audit log."""
    return await hitl_manager.decide(db, request_id=action_id, decision="approved")

@router.post("/{action_id}/reject")
async def reject_hitl(action_id: str, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    """Reject a sensitive action and record in audit log."""
    return await hitl_manager.decide(db, request_id=action_id, decision="rejected")
