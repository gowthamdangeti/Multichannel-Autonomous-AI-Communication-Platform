"""FastAPI AI Email Analytics Routes."""

from __future__ import annotations

from datetime import datetime, timedelta, UTC
from typing import Annotated, Any, Dict, List
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select, and_, or_

from api.db import db_client
from api.db.models import (
    EmailAIRunModel,
    EmailAttachmentModel,
    EmailFollowUpModel,
    EmailMessageModel,
    EmailRuleExecutionModel,
    UserModel,
)
from api.services.auth.depends import get_user

router = APIRouter(prefix="/analytics", tags=["email-analytics"])


def _require_org(user: UserModel) -> int:
    if not user.selected_organization_id:
        raise HTTPException(status_code=400, detail="No organization selected")
    return user.selected_organization_id


class OverviewAnalyticsResponse(BaseModel):
    total_emails: int
    unread_emails: int
    archived_emails: int
    needs_reply_count: int
    awaiting_reply_count: int
    total_attachments: int
    total_ai_runs: int
    total_rules_applied: int


class CategoryCountResponse(BaseModel):
    category: str
    count: int
    percentage: float


class DailyActivityResponse(BaseModel):
    date: str
    received_count: int
    processed_count: int


class ResponseTimesResponse(BaseModel):
    average_response_hours: float
    total_resolved: int
    pending_overdue_count: int


@router.get("/overview", response_model=OverviewAnalyticsResponse)
async def get_analytics_overview(
    user: UserModel = Depends(get_user),
) -> OverviewAnalyticsResponse:
    """Get high-level email automation overview metrics for the organization."""
    org_id = _require_org(user)

    async with db_client.async_session() as session:
        # Total, unread, archived
        msg_counts = await session.execute(
            select(
                func.count(EmailMessageModel.id),
                func.count(EmailMessageModel.id).filter(EmailMessageModel.is_read.is_(False)),
                func.count(EmailMessageModel.id).filter(EmailMessageModel.is_archived.is_(True)),
            ).where(EmailMessageModel.organization_id == org_id)
        )
        total, unread, archived = msg_counts.one()

        # Followups
        fup_counts = await session.execute(
            select(
                func.count(EmailFollowUpModel.id).filter(
                    EmailFollowUpModel.status.in_(["needs_reply", "pending"])
                ),
                func.count(EmailFollowUpModel.id).filter(
                    EmailFollowUpModel.status == "awaiting_reply"
                ),
            ).where(EmailFollowUpModel.organization_id == org_id)
        )
        needs_reply, awaiting_reply = fup_counts.one()

        # Attachments
        att_count = (await session.execute(
            select(func.count(EmailAttachmentModel.id)).where(EmailAttachmentModel.organization_id == org_id)
        )).scalar() or 0

        # AI Runs
        ai_count = (await session.execute(
            select(func.count(EmailAIRunModel.id)).where(EmailAIRunModel.organization_id == org_id)
        )).scalar() or 0

        # Rule executions
        rules_count = (await session.execute(
            select(func.count(EmailRuleExecutionModel.id)).where(
                EmailRuleExecutionModel.organization_id == org_id,
                EmailRuleExecutionModel.status.in_(["applied", "success"]),
            )
        )).scalar() or 0

        return OverviewAnalyticsResponse(
            total_emails=total or 0,
            unread_emails=unread or 0,
            archived_emails=archived or 0,
            needs_reply_count=needs_reply or 0,
            awaiting_reply_count=awaiting_reply or 0,
            total_attachments=att_count,
            total_ai_runs=ai_count,
            total_rules_applied=rules_count,
        )


@router.get("/categories", response_model=List[CategoryCountResponse])
async def get_analytics_categories(
    user: UserModel = Depends(get_user),
) -> List[CategoryCountResponse]:
    """Get email distribution by AI category."""
    org_id = _require_org(user)

    async with db_client.async_session() as session:
        stmt = (
            select(
                EmailMessageModel.ai_category,
                func.count(EmailMessageModel.id).label("count"),
            )
            .where(EmailMessageModel.organization_id == org_id)
            .group_by(EmailMessageModel.ai_category)
        )
        res = await session.execute(stmt)
        rows = res.all()

        total = sum(r[1] for r in rows) or 1
        return [
            CategoryCountResponse(
                category=r[0] or "unclassified",
                count=r[1],
                percentage=round((r[1] / total) * 100, 1),
            )
            for r in rows
        ]


@router.get("/activity", response_model=List[DailyActivityResponse])
async def get_analytics_activity(
    days: Annotated[int, Query(ge=1, le=90, description="Number of past days to aggregate")] = 7,
    user: UserModel = Depends(get_user),
) -> List[DailyActivityResponse]:
    """Get daily email activity for the past N days."""
    org_id = _require_org(user)
    start_date = datetime.now(UTC) - timedelta(days=days)

    async with db_client.async_session() as session:
        # Group messages by date
        day_col = func.date(EmailMessageModel.created_at)
        stmt = (
            select(
                day_col.label("day"),
                func.count(EmailMessageModel.id).label("received"),
                func.count(EmailMessageModel.id).filter(EmailMessageModel.ai_category.isnot(None)).label("processed"),
            )
            .where(
                EmailMessageModel.organization_id == org_id,
                EmailMessageModel.created_at >= start_date,
            )
            .group_by(day_col)
            .order_by(day_col)
        )
        res = await session.execute(stmt)
        rows = res.all()

        return [
            DailyActivityResponse(
                date=str(r[0]),
                received_count=r[1] or 0,
                processed_count=r[2] or 0,
            )
            for r in rows
        ]


@router.get("/response-times", response_model=ResponseTimesResponse)
async def get_analytics_response_times(
    user: UserModel = Depends(get_user),
) -> ResponseTimesResponse:
    """Calculate average response times and overdue conversation counts."""
    org_id = _require_org(user)
    now = datetime.now(UTC)

    async with db_client.async_session() as session:
        # Completed follow-ups
        stmt = select(EmailFollowUpModel).where(
            EmailFollowUpModel.organization_id == org_id,
            EmailFollowUpModel.status.in_(["completed", "resolved"]),
        )
        res = await session.execute(stmt)
        resolved = list(res.scalars().all())

        durations_hours = []
        for f in resolved:
            if f.created_at and f.updated_at and f.updated_at > f.created_at:
                diff = (f.updated_at - f.created_at).total_seconds() / 3600.0
                durations_hours.append(diff)

        avg_hours = round(sum(durations_hours) / len(durations_hours), 1) if durations_hours else 0.0

        # Overdue count
        overdue_stmt = select(func.count(EmailFollowUpModel.id)).where(
            EmailFollowUpModel.organization_id == org_id,
            EmailFollowUpModel.status.in_(["needs_reply", "awaiting_reply"]),
            or_(
                EmailFollowUpModel.due_date < now,
                EmailFollowUpModel.created_at < now - timedelta(days=3),
            ),
        )
        overdue_count = (await session.execute(overdue_stmt)).scalar() or 0

        return ResponseTimesResponse(
            average_response_hours=avg_hours,
            total_resolved=len(resolved),
            pending_overdue_count=overdue_count,
        )
