from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from api.constants import MAX_RANGE_DAYS
from api.db import db_client
from api.db.models import UserModel
from api.services.auth.depends import get_user
from api.schemas.chat_agent_overview import ChatAgentOverviewResponse
from api.schemas.voice_agent_overview import VoiceAgentOverviewResponse
from api.schemas.whatsapp_agent_overview import WhatsAppAgentOverviewResponse
from api.services.reports import DailyReportService
from api.services.reports.chat_agent_overview import get_chat_agent_overview
from api.services.reports.voice_agent_overview import get_voice_agent_overview
from api.services.workflow.agent_utilization import AgentUtilisationService
from api.services.reports.whatsapp_agent_overview import get_whatsapp_agent_overview

router = APIRouter(prefix="/organizations/reports")


class DailyReportResponse(BaseModel):
    date: str
    timezone: str
    workflow_id: Optional[int]
    metrics: Dict[str, int]
    disposition_distribution: List[Dict[str, Any]]
    call_duration_distribution: List[Dict[str, Any]]


class WorkflowOption(BaseModel):
    id: int
    name: str


class WorkflowRunDetail(BaseModel):
    phone_number: str
    disposition: str
    duration_seconds: float
    workflow_id: int
    run_id: int
    workflow_name: str
    created_at: str


@router.get("/daily", response_model=DailyReportResponse)
async def get_daily_report(
    date: str = Query(..., description="Date in YYYY-MM-DD format"),
    timezone: str = Query(..., description="IANA timezone (e.g., 'America/New_York')"),
    workflow_id: Optional[int] = Query(
        None, description="Optional workflow ID to filter by"
    ),
    user: UserModel = Depends(get_user),
) -> DailyReportResponse:
    """
    Get daily report for the specified date and timezone.
    If workflow_id is provided, filters results to that specific workflow.
    If workflow_id is None, includes all workflows for the organization.
    """
    if not user.selected_organization_id:
        raise HTTPException(status_code=400, detail="No organization selected")

    # Validate date format
    try:
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(
            status_code=400, detail="Invalid date format. Use YYYY-MM-DD"
        )

    if workflow_id is not None:
        await AgentUtilisationService.require_agent(user, workflow_id)

    report_service = DailyReportService()

    try:
        report = await report_service.get_daily_report(
            organization_id=user.selected_organization_id,
            date=date,
            timezone=timezone,
            workflow_id=workflow_id,
        )
        return DailyReportResponse(**report)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/workflows", response_model=List[WorkflowOption])
async def get_workflow_options(
    user: UserModel = Depends(get_user),
) -> List[WorkflowOption]:
    """
    Get all workflows for the user's organization.
    Used to populate the workflow selector dropdown in the reports page.
    """
    if not user.selected_organization_id:
        raise HTTPException(status_code=400, detail="No organization selected")

    report_service = DailyReportService()

    workflows = await report_service.get_workflows_for_organization(
        organization_id=user.selected_organization_id
    )
    accessible_ids = await AgentUtilisationService.get_accessible_agents(user)
    return [WorkflowOption(**w) for w in workflows if w["id"] in accessible_ids]


@router.get("/daily/runs", response_model=List[WorkflowRunDetail])
async def get_daily_runs_detail(
    date: str = Query(..., description="Date in YYYY-MM-DD format"),
    timezone: str = Query(..., description="IANA timezone (e.g., 'America/New_York')"),
    workflow_id: Optional[int] = Query(
        None, description="Optional workflow ID to filter by"
    ),
    user: UserModel = Depends(get_user),
) -> List[WorkflowRunDetail]:
    """
    Get detailed workflow runs for the specified date.
    Used for CSV export functionality.
    """
    if not user.selected_organization_id:
        raise HTTPException(status_code=400, detail="No organization selected")

    # Validate date format
    try:
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(
            status_code=400, detail="Invalid date format. Use YYYY-MM-DD"
        )

    if workflow_id is not None:
        await AgentUtilisationService.require_agent(user, workflow_id)

    report_service = DailyReportService()

    try:
        runs = await report_service.get_daily_runs_detail(
            organization_id=user.selected_organization_id,
            date=date,
            timezone=timezone,
            workflow_id=workflow_id,
        )
        return [WorkflowRunDetail(**run) for run in runs]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/stats")
async def get_org_stats(
    days: int = Query(default=30, ge=0, le=MAX_RANGE_DAYS, description="0 means all time"),
    user: UserModel = Depends(get_user),
):
    """Summary stats for the org dashboard over the last N days."""
    if not user.selected_organization_id:
        raise HTTPException(status_code=400, detail="No organization selected")
    return await db_client.get_org_stats(user.selected_organization_id, days=days)


@router.get("/voice-agents/overview", response_model=VoiceAgentOverviewResponse)
async def get_voice_agents_overview(
    days: int = Query(default=30, ge=0, le=MAX_RANGE_DAYS, description="0 means all time"),
    user: UserModel = Depends(get_user),
) -> VoiceAgentOverviewResponse:
    """KPIs, call trend and the full voice-agent roster for the overview page."""
    if not user.selected_organization_id:
        raise HTTPException(status_code=400, detail="No organization selected")
    return await get_voice_agent_overview(
        organization_id=user.selected_organization_id,
        days=days,
        # Dashboard respects the utilisation policy: no roster row, KPI or
        # trend point for an agent the caller may not access.
        agent_ids=await AgentUtilisationService.get_accessible_agents(user),
    )


@router.get("/chat-agents/overview", response_model=ChatAgentOverviewResponse)
async def get_chat_agents_overview(
    days: int = Query(default=30, ge=0, le=MAX_RANGE_DAYS, description="0 means all time"),
    user: UserModel = Depends(get_user),
) -> ChatAgentOverviewResponse:
    """KPIs, conversation trend and the website-chat agent roster for the overview page."""
    if not user.selected_organization_id:
        raise HTTPException(status_code=400, detail="No organization selected")
    return await get_chat_agent_overview(
        organization_id=user.selected_organization_id, days=days
    )


@router.get("/whatsapp-agents/overview", response_model=WhatsAppAgentOverviewResponse)
async def get_whatsapp_agents_overview(
    days: int = Query(default=30, ge=0, le=MAX_RANGE_DAYS, description="0 means all time"),
    user: UserModel = Depends(get_user),
) -> WhatsAppAgentOverviewResponse:
    """Contacts, numbers and the WhatsApp agent roster for the overview page."""
    if not user.selected_organization_id:
        raise HTTPException(status_code=400, detail="No organization selected")
    return await get_whatsapp_agent_overview(
        organization_id=user.selected_organization_id, days=days
    )
