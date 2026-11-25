"""FastAPI Inbox, Messages, Threads, and AI Processing Routes."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import desc, asc, select, update, or_, and_

from api.db import db_client
from api.db.models import (
    EmailAgentModel,
    EmailAIRunModel,
    EmailAttachmentModel,
    EmailFollowUpModel,
    EmailMessageModel,
    UserModel,
)
from api.services.auth.depends import get_user
from api.services.email.ai_service import (
    analyze_and_draft_reply,
    classify_email_content,
    process_email_ai_pipeline,
)

router = APIRouter(tags=["email-messages"])


def _require_org(user: UserModel) -> int:
    if not user.selected_organization_id:
        raise HTTPException(status_code=400, detail="No organization selected")
    return user.selected_organization_id


class EmailMessageSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    provider: str
    gmail_account_id: Optional[int] = None
    outlook_account_id: Optional[int] = None
    gmail_message_id: str
    gmail_thread_id: Optional[str] = None
    subject: Optional[str] = None
    sender: Optional[str] = None
    snippet: Optional[str] = None
    internal_date: Optional[datetime] = None
    received_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    ai_category: Optional[str] = None
    ai_priority: Optional[str] = None
    is_read: bool = False
    is_archived: bool = False
    has_attachments: bool = False
    needs_reply: bool = False


class EmailMessageDetail(EmailMessageSummary):
    body_text: Optional[str] = None
    body_html: Optional[str] = None
    gmail_labels: List[str] = []
    headers: Dict[str, Any] = {}
    created_at: Optional[datetime] = None
    latest_ai_run: Optional[Dict[str, Any]] = None
    followup: Optional[Dict[str, Any]] = None
    attachments: List[Dict[str, Any]] = []


class UpdateMessageRequest(BaseModel):
    is_read: Optional[bool] = None
    is_archived: Optional[bool] = None
    ai_category: Optional[str] = None
    ai_priority: Optional[str] = None
    gmail_labels: Optional[List[str]] = None


class DraftReplyRequest(BaseModel):
    instructions: Optional[str] = Field(
        None, description="Optional extra guidance, e.g. 'Politely decline the meeting'"
    )


class PaginatedMessagesResponse(BaseModel):
    total: int
    limit: int
    offset: int
    messages: List[EmailMessageSummary]


@router.get("/messages", response_model=PaginatedMessagesResponse)
async def list_email_messages(
    account_id: Annotated[Optional[int], Query(description="Filter by Gmail account id")] = None,
    outlook_account_id: Annotated[Optional[int], Query(description="Filter by Outlook account id")] = None,
    provider: Annotated[Optional[str], Query(description="Filter by provider: 'gmail' or 'outlook'")] = None,
    category: Annotated[Optional[str], Query(description="Filter by AI category")] = None,
    priority: Annotated[Optional[str], Query(description="Filter by AI priority")] = None,
    is_read: Annotated[Optional[bool], Query(description="Filter by read state")] = None,
    is_archived: Annotated[Optional[bool], Query(description="Filter by archived state")] = None,
    sender: Annotated[Optional[str], Query(description="Filter by sender substring")] = None,
    search: Annotated[Optional[str], Query(description="Keyword search in subject or snippet")] = None,
    date_from: Annotated[Optional[datetime], Query(description="Internal date range start")] = None,
    date_to: Annotated[Optional[datetime], Query(description="Internal date range end")] = None,
    sort_by: Annotated[str, Query(description="Sort field: 'internal_date' or 'created_at'")] = "internal_date",
    order: Annotated[str, Query(description="Sort direction: 'asc' or 'desc'")] = "desc",
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    user: UserModel = Depends(get_user),
) -> PaginatedMessagesResponse:
    """List inbox and messages with filtering, searching, and pagination."""
    org_id = _require_org(user)

    filters = [EmailMessageModel.organization_id == org_id]
    if account_id:
        if provider == "outlook":
            filters.append(EmailMessageModel.outlook_account_id == account_id)
        elif provider == "gmail":
            filters.append(EmailMessageModel.gmail_account_id == account_id)
        else:
            filters.append(
                or_(
                    EmailMessageModel.gmail_account_id == account_id,
                    EmailMessageModel.outlook_account_id == account_id,
                )
            )
    if outlook_account_id:
        filters.append(EmailMessageModel.outlook_account_id == outlook_account_id)
    if provider:
        filters.append(EmailMessageModel.provider == provider.lower())
    if category:
        filters.append(EmailMessageModel.ai_category == category.lower())
    if priority:
        filters.append(EmailMessageModel.ai_priority == priority.lower())
    if is_read is not None:
        filters.append(EmailMessageModel.is_read == is_read)
    if is_archived is not None:
        filters.append(EmailMessageModel.is_archived == is_archived)
    if sender:
        filters.append(EmailMessageModel.sender.ilike(f"%{sender}%"))
    if search:
        search_filter = or_(
            EmailMessageModel.subject.ilike(f"%{search}%"),
            EmailMessageModel.snippet.ilike(f"%{search}%"),
        )
        filters.append(search_filter)
    if date_from:
        filters.append(EmailMessageModel.internal_date >= date_from)
    if date_to:
        filters.append(EmailMessageModel.internal_date <= date_to)

    sort_col = EmailMessageModel.internal_date if sort_by == "internal_date" else EmailMessageModel.created_at
    order_func = desc if order.lower() == "desc" else asc

    async with db_client.async_session() as session:
        # Query total count
        from sqlalchemy import func
        count_stmt = select(func.count(EmailMessageModel.id)).where(and_(*filters))
        total_res = await session.execute(count_stmt)
        total_count = total_res.scalar() or 0

        # Query messages
        stmt = (
            select(EmailMessageModel)
            .where(and_(*filters))
            .order_by(order_func(sort_col))
            .limit(limit)
            .offset(offset)
        )
        res = await session.execute(stmt)
        items = list(res.scalars().all())

        summaries = [
            EmailMessageSummary(
                id=m.id,
                provider=m.provider,
                gmail_message_id=m.gmail_message_id,
                gmail_thread_id=m.gmail_thread_id,
                subject=m.subject,
                sender=m.sender,
                snippet=m.snippet,
                internal_date=m.internal_date,
                received_at=m.internal_date or m.created_at,
                created_at=m.created_at,
                ai_category=m.ai_category,
                ai_priority=m.ai_priority,
                is_read=m.is_read,
                is_archived=m.is_archived,
                has_attachments=False,
                needs_reply=False,
            )
            for m in items
        ]

    return PaginatedMessagesResponse(
        total=total_count,
        limit=limit,
        offset=offset,
        messages=summaries,
    )


@router.get("/messages/{message_id}", response_model=EmailMessageDetail)
async def get_email_message(
    message_id: int,
    user: UserModel = Depends(get_user),
) -> EmailMessageDetail:
    """Get full details of a specific email message."""
    org_id = _require_org(user)

    async with db_client.async_session() as session:
        stmt = select(EmailMessageModel).where(
            EmailMessageModel.id == message_id,
            EmailMessageModel.organization_id == org_id,
        )
        res = await session.execute(stmt)
        msg = res.scalar_one_or_none()
        if not msg:
            raise HTTPException(status_code=404, detail="Email message not found")

        # Load latest AI run
        ai_stmt = select(EmailAIRunModel).where(
            EmailAIRunModel.email_message_id == message_id,
            EmailAIRunModel.organization_id == org_id,
        ).order_by(EmailAIRunModel.created_at.desc()).limit(1)
        ai_res = await session.execute(ai_stmt)
        latest_ai = ai_res.scalar_one_or_none()

        # Load followup
        fup_stmt = select(EmailFollowUpModel).where(
            EmailFollowUpModel.email_message_id == message_id,
            EmailFollowUpModel.organization_id == org_id,
        ).limit(1)
        fup_res = await session.execute(fup_stmt)
        followup = fup_res.scalar_one_or_none()

        # Load attachments
        att_stmt = select(EmailAttachmentModel).where(
            EmailAttachmentModel.email_message_id == message_id,
            EmailAttachmentModel.organization_id == org_id,
        )
        att_res = await session.execute(att_stmt)
        attachments = list(att_res.scalars().all())

        return EmailMessageDetail(
            id=msg.id,
            provider=msg.provider,
            gmail_message_id=msg.gmail_message_id,
            gmail_thread_id=msg.gmail_thread_id,
            subject=msg.subject,
            sender=msg.sender,
            snippet=msg.snippet,
            body_text=msg.body_text,
            body_html=msg.body_html,
            internal_date=msg.internal_date,
            received_at=msg.internal_date or msg.created_at,
            created_at=msg.created_at,
            ai_category=msg.ai_category,
            ai_priority=msg.ai_priority,
            is_read=msg.is_read,
            is_archived=msg.is_archived,
            gmail_labels=list(msg.gmail_labels or []),
            headers=dict(msg.headers or {}),
            has_attachments=len(attachments) > 0,
            needs_reply=bool(followup and followup.status == "needs_reply"),
            latest_ai_run={
                "id": latest_ai.id,
                "summary": latest_ai.summary,
                "draft_reply": latest_ai.draft_reply,
                "key_points": latest_ai.key_points,
                "suggested_action": latest_ai.suggested_action,
                "model": latest_ai.model,
                "status": latest_ai.status,
                "created_at": latest_ai.created_at,
            } if latest_ai else None,
            followup={
                "id": followup.id,
                "status": followup.status,
                "due_date": followup.due_date,
                "suggested_followup": followup.suggested_followup,
                "notes": followup.notes,
            } if followup else None,
            attachments=[
                {
                    "id": a.id,
                    "filename": a.filename,
                    "content_type": a.content_type,
                    "file_size": a.file_size,
                    "is_uploaded": a.is_uploaded,
                    "created_at": a.created_at,
                }
                for a in attachments
            ],
        )


@router.get("/threads/{thread_id}", response_model=List[EmailMessageSummary])
async def get_email_thread(
    thread_id: str,
    user: UserModel = Depends(get_user),
) -> List[EmailMessageSummary]:
    """Retrieve all messages in an email conversation thread ordered chronologically."""
    org_id = _require_org(user)

    async with db_client.async_session() as session:
        stmt = (
            select(EmailMessageModel)
            .where(
                EmailMessageModel.organization_id == org_id,
                EmailMessageModel.gmail_thread_id == thread_id,
            )
            .order_by(EmailMessageModel.internal_date.asc())
        )
        res = await session.execute(stmt)
        messages = list(res.scalars().all())

    return [
        EmailMessageSummary(
            id=m.id,
            provider=m.provider,
            gmail_message_id=m.gmail_message_id,
            gmail_thread_id=m.gmail_thread_id,
            subject=m.subject,
            sender=m.sender,
            snippet=m.snippet,
            internal_date=m.internal_date,
            received_at=m.internal_date or m.created_at,
            created_at=m.created_at,
            ai_category=m.ai_category,
            ai_priority=m.ai_priority,
            is_read=m.is_read,
            is_archived=m.is_archived,
        )
        for m in messages
    ]


@router.patch("/messages/{message_id}", response_model=EmailMessageSummary)
async def update_email_message(
    message_id: int,
    payload: UpdateMessageRequest,
    user: UserModel = Depends(get_user),
) -> EmailMessageSummary:
    """Update message triage flags: mark read/unread, archive, category, or priority."""
    org_id = _require_org(user)

    async with db_client.async_session() as session:
        stmt = select(EmailMessageModel).where(
            EmailMessageModel.id == message_id,
            EmailMessageModel.organization_id == org_id,
        )
        res = await session.execute(stmt)
        msg = res.scalar_one_or_none()
        if not msg:
            raise HTTPException(status_code=404, detail="Email message not found")

        if payload.is_read is not None:
            msg.is_read = payload.is_read
        if payload.is_archived is not None:
            msg.is_archived = payload.is_archived
        if payload.ai_category is not None:
            msg.ai_category = payload.ai_category
        if payload.ai_priority is not None:
            msg.ai_priority = payload.ai_priority
        if payload.gmail_labels is not None:
            msg.gmail_labels = payload.gmail_labels

        await session.commit()
        await session.refresh(msg)

        return EmailMessageSummary(
            id=msg.id,
            provider=msg.provider,
            gmail_message_id=msg.gmail_message_id,
            gmail_thread_id=msg.gmail_thread_id,
            subject=msg.subject,
            sender=msg.sender,
            snippet=msg.snippet,
            internal_date=msg.internal_date,
            received_at=msg.internal_date or msg.created_at,
            created_at=msg.created_at,
            ai_category=msg.ai_category,
            ai_priority=msg.ai_priority,
            is_read=msg.is_read,
            is_archived=msg.is_archived,
        )


@router.post("/messages/{message_id}/analyze")
async def trigger_ai_analysis(
    message_id: int,
    user: UserModel = Depends(get_user),
) -> Dict[str, Any]:
    """Run full AI classification, summarization, and reply drafting for an email."""
    org_id = _require_org(user)

    async with db_client.async_session() as session:
        stmt = select(EmailMessageModel).where(
            EmailMessageModel.id == message_id,
            EmailMessageModel.organization_id == org_id,
        )
        res = await session.execute(stmt)
        msg = res.scalar_one_or_none()
        if not msg:
            raise HTTPException(status_code=404, detail="Email message not found")

        ai_run = await process_email_ai_pipeline(session, msg)
        await session.commit()

        return {
            "status": "completed",
            "message_id": msg.id,
            "ai_category": msg.ai_category,
            "ai_priority": msg.ai_priority,
            "summary": ai_run.summary,
            "key_points": ai_run.key_points,
            "suggested_action": ai_run.suggested_action,
            "draft_reply": ai_run.draft_reply,
        }


@router.post("/messages/{message_id}/draft-reply")
async def generate_draft_reply(
    message_id: int,
    payload: DraftReplyRequest,
    user: UserModel = Depends(get_user),
) -> Dict[str, Any]:
    """Generate a contextual polite AI draft reply for an email."""
    org_id = _require_org(user)

    async with db_client.async_session() as session:
        stmt = select(EmailMessageModel).where(
            EmailMessageModel.id == message_id,
            EmailMessageModel.organization_id == org_id,
        )
        res = await session.execute(stmt)
        msg = res.scalar_one_or_none()
        if not msg:
            raise HTTPException(status_code=404, detail="Email message not found")

        # Check if an EmailAgent is associated with this account or organization
        agent = None
        agent_conds = []
        if msg.gmail_account_id:
            agent_conds.append(EmailAgentModel.gmail_account_id == msg.gmail_account_id)
        if msg.outlook_account_id:
            agent_conds.append(EmailAgentModel.outlook_account_id == msg.outlook_account_id)

        if agent_conds:
            agent_stmt = (
                select(EmailAgentModel)
                .where(
                    EmailAgentModel.organization_id == org_id,
                    or_(*agent_conds),
                )
                .limit(1)
            )
            agent_res = await session.execute(agent_stmt)
            agent = agent_res.scalar_one_or_none()

        system_prompt = agent.system_prompt if agent else None
        model_config_ref = agent.model_config_ref if agent else None

        analysis = await analyze_and_draft_reply(
            organization_id=org_id,
            subject=msg.subject,
            sender=msg.sender,
            body_text=msg.body_text,
            system_prompt=system_prompt,
            instructions=payload.instructions,
            model_config_ref=model_config_ref,
        )

        # Save or update email_ai_runs
        run_stmt = select(EmailAIRunModel).where(
            EmailAIRunModel.email_message_id == msg.id,
        )
        if agent:
            run_stmt = run_stmt.where(EmailAIRunModel.email_agent_id == agent.id)
        else:
            run_stmt = run_stmt.where(EmailAIRunModel.email_agent_id.is_(None))

        existing_run = (await session.execute(run_stmt.limit(1))).scalar_one_or_none()
        if existing_run:
            existing_run.summary = analysis.summary
            existing_run.draft_reply = analysis.draft_reply
            existing_run.key_points = analysis.key_points
            existing_run.suggested_action = analysis.suggested_action
            existing_run.status = "completed"
            run = existing_run
        else:
            run = EmailAIRunModel(
                organization_id=org_id,
                email_message_id=msg.id,
                email_agent_id=agent.id if agent else None,
                summary=analysis.summary,
                draft_reply=analysis.draft_reply,
                key_points=analysis.key_points,
                suggested_action=analysis.suggested_action,
                status="completed",
            )
            session.add(run)

        await session.commit()
        await session.refresh(run)

        return {
            "status": "success",
            "ai_run_id": run.id,
            "summary": run.summary,
            "draft_reply": run.draft_reply,
            "suggested_action": run.suggested_action,
            "key_points": run.key_points,
        }


@router.post("/messages/{message_id}/regenerate-reply")
async def regenerate_reply(
    message_id: int,
    payload: DraftReplyRequest,
    user: UserModel = Depends(get_user),
) -> Dict[str, Any]:
    """Regenerate draft reply with updated guidance or fresh wording."""
    return await generate_draft_reply(message_id, payload, user)


@router.get("/messages/{message_id}/ai-history")
async def get_ai_history(
    message_id: int,
    user: UserModel = Depends(get_user),
) -> List[Dict[str, Any]]:
    """Retrieve historical AI analysis runs and drafts for a message."""
    org_id = _require_org(user)

    async with db_client.async_session() as session:
        # Verify ownership
        chk = select(EmailMessageModel.id).where(
            EmailMessageModel.id == message_id,
            EmailMessageModel.organization_id == org_id,
        )
        if not (await session.execute(chk)).scalar():
            raise HTTPException(status_code=404, detail="Email message not found")

        stmt = (
            select(EmailAIRunModel)
            .where(
                EmailAIRunModel.email_message_id == message_id,
                EmailAIRunModel.organization_id == org_id,
            )
            .order_by(EmailAIRunModel.created_at.desc())
        )
        res = await session.execute(stmt)
        runs = list(res.scalars().all())

    return [
        {
            "id": r.id,
            "summary": r.summary,
            "draft_reply": r.draft_reply,
            "key_points": r.key_points,
            "suggested_action": r.suggested_action,
            "model": r.model,
            "status": r.status,
            "created_at": r.created_at,
        }
        for r in runs
    ]
