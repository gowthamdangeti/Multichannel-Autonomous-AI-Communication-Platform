"""FastAPI Reply Zero Follow-up Management Routes."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select, desc, and_, or_

from api.db import db_client
from api.db.models import EmailFollowUpModel, EmailMessageModel, UserModel
from api.services.auth.depends import get_user

router = APIRouter(prefix="/followups", tags=["email-reply-zero"])


def _require_org(user: UserModel) -> int:
    if not user.selected_organization_id:
        raise HTTPException(status_code=400, detail="No organization selected")
    return user.selected_organization_id


class FollowUpResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email_message_id: int
    message_id: Optional[int] = None
    thread_id: Optional[str] = None
    status: str  # needs_reply, awaiting_reply, completed, archived
    type: Optional[str] = None
    due_date: Optional[datetime] = None
    last_contact_at: Optional[datetime] = None
    suggested_followup: Optional[str] = None
    suggested_reply: Optional[str] = None
    notes: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    # Joined email snippet and subject for display
    subject: Optional[str] = None
    sender: Optional[str] = None
    snippet: Optional[str] = None


class UpdateFollowUpRequest(BaseModel):
    status: Optional[str] = None
    due_date: Optional[datetime] = None
    suggested_followup: Optional[str] = None
    notes: Optional[str] = None


@router.get("", response_model=List[FollowUpResponse])
async def list_followups(
    status: Annotated[Optional[str], Query(description="Filter by status: needs_reply, awaiting_reply, completed")] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    user: UserModel = Depends(get_user),
) -> List[FollowUpResponse]:
    """List all follow-up conversations in Reply Zero."""
    org_id = _require_org(user)

    now = datetime.now(UTC)

    async with db_client.async_session() as session:
        filters = [EmailFollowUpModel.organization_id == org_id]
        if status:
            s_lower = status.lower()
            if s_lower == "overdue":
                filters.append(
                    and_(
                        EmailFollowUpModel.status.in_(["needs_reply", "awaiting_reply"]),
                        or_(
                            EmailFollowUpModel.due_date < now,
                            EmailFollowUpModel.created_at < now - timedelta(days=3),
                            EmailFollowUpModel.status == "overdue",
                        ),
                    )
                )
            elif s_lower in ("completed", "resolved"):
                filters.append(EmailFollowUpModel.status.in_(["completed", "resolved"]))
            else:
                filters.append(EmailFollowUpModel.status == s_lower)

        stmt = (
            select(EmailFollowUpModel, EmailMessageModel)
            .join(EmailMessageModel, EmailFollowUpModel.email_message_id == EmailMessageModel.id)
            .where(and_(*filters))
            .order_by(desc(EmailFollowUpModel.created_at))
            .limit(limit)
            .offset(offset)
        )
        res = await session.execute(stmt)
        rows = res.all()

        results = []
        for fup, msg in rows:
            effective_status = fup.status
            if fup.status in ("needs_reply", "awaiting_reply"):
                if (fup.due_date and fup.due_date < now) or (fup.created_at and now - fup.created_at > timedelta(days=3)):
                    effective_status = "overdue"

            results.append(
                FollowUpResponse(
                    id=fup.id,
                    email_message_id=fup.email_message_id,
                    message_id=fup.email_message_id,
                    thread_id=fup.thread_id,
                    status=effective_status,
                    type=fup.status,
                    due_date=fup.due_date,
                    last_contact_at=fup.last_contact_at,
                    suggested_followup=fup.suggested_followup,
                    suggested_reply=fup.suggested_followup,
                    notes=fup.notes,
                    created_at=fup.created_at,
                    updated_at=fup.updated_at,
                    subject=msg.subject,
                    sender=msg.sender,
                    snippet=msg.snippet,
                )
            )
        return results


@router.get("/needs-reply", response_model=List[FollowUpResponse])
async def list_needs_reply(
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    user: UserModel = Depends(get_user),
) -> List[FollowUpResponse]:
    """List conversations requiring a reply from the user."""
    return await list_followups(status="needs_reply", limit=limit, offset=offset, user=user)


@router.get("/awaiting-reply", response_model=List[FollowUpResponse])
async def list_awaiting_reply(
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    user: UserModel = Depends(get_user),
) -> List[FollowUpResponse]:
    """List sent conversations awaiting a response from others."""
    return await list_followups(status="awaiting_reply", limit=limit, offset=offset, user=user)


@router.patch("/{followup_id}", response_model=FollowUpResponse)
async def update_followup(
    followup_id: int,
    payload: UpdateFollowUpRequest,
    user: UserModel = Depends(get_user),
) -> FollowUpResponse:
    """Update follow-up status, due date, or notes."""
    org_id = _require_org(user)

    async with db_client.async_session() as session:
        stmt = (
            select(EmailFollowUpModel, EmailMessageModel)
            .join(EmailMessageModel, EmailFollowUpModel.email_message_id == EmailMessageModel.id)
            .where(
                EmailFollowUpModel.id == followup_id,
                EmailFollowUpModel.organization_id == org_id,
            )
        )
        res = await session.execute(stmt)
        row = res.first()
        if not row:
            raise HTTPException(status_code=404, detail="Follow-up not found")

        fup, msg = row
        if payload.status is not None:
            fup.status = payload.status
        if payload.due_date is not None:
            fup.due_date = payload.due_date
        if payload.suggested_followup is not None:
            fup.suggested_followup = payload.suggested_followup
        if payload.notes is not None:
            fup.notes = payload.notes
        fup.updated_at = datetime.now(UTC)

        await session.commit()
        await session.refresh(fup)

        return FollowUpResponse(
            id=fup.id,
            email_message_id=fup.email_message_id,
            message_id=fup.email_message_id,
            thread_id=fup.thread_id,
            status=fup.status,
            type=fup.status,
            due_date=fup.due_date,
            last_contact_at=fup.last_contact_at,
            suggested_followup=fup.suggested_followup,
            suggested_reply=fup.suggested_followup,
            notes=fup.notes,
            created_at=fup.created_at,
            updated_at=fup.updated_at,
            subject=msg.subject,
            sender=msg.sender,
            snippet=msg.snippet,
        )


@router.post("/{followup_id}/resolve", response_model=FollowUpResponse)
async def resolve_followup(
    followup_id: int,
    user: UserModel = Depends(get_user),
) -> FollowUpResponse:
    """Mark a follow-up conversation as completed/resolved."""
    return await update_followup(
        followup_id=followup_id,
        payload=UpdateFollowUpRequest(status="completed"),
        user=user,
    )
