"""FastAPI Endpoints for Email Agents Management."""

from __future__ import annotations

from datetime import datetime, UTC
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import desc, select

from api.db import db_client
from api.db.models import (
    EmailAgentModel,
    GmailAccountModel,
    OutlookAccountModel,
    UserModel,
)
from api.services.auth.depends import get_user

router = APIRouter(prefix="/agents", tags=["email-agents"])


def _require_org(user: UserModel) -> int:
    if not user.selected_organization_id:
        raise HTTPException(status_code=400, detail="No organization selected")
    return user.selected_organization_id


# ==============================================================================
# Pydantic Request & Response Schemas
# ==============================================================================

class EmailAgentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: Optional[str] = None
    system_prompt: str = ""
    gmail_account_id: Optional[int] = None
    outlook_account_id: Optional[int] = None
    assigned_email: Optional[str] = None
    assigned_provider: Optional[str] = None
    model_config_ref: Dict[str, Any] = Field(default_factory=dict)
    is_active: bool = True
    auto_reply_enabled: bool = False
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class CreateEmailAgentRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=64, description="Unique agent name")
    description: Optional[str] = Field(None, max_length=512)
    system_prompt: str = Field("", description="System instructions / persona for the AI")
    gmail_account_id: Optional[int] = None
    outlook_account_id: Optional[int] = None
    model_config_ref: Optional[Dict[str, Any]] = None
    is_active: bool = True
    auto_reply_enabled: bool = False


class UpdateEmailAgentRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=64)
    description: Optional[str] = Field(None, max_length=512)
    system_prompt: Optional[str] = None
    gmail_account_id: Optional[int] = None
    outlook_account_id: Optional[int] = None
    model_config_ref: Optional[Dict[str, Any]] = None
    is_active: Optional[bool] = None
    auto_reply_enabled: Optional[bool] = None


def _format_agent_response(
    agent: EmailAgentModel,
    gmail_acc: Optional[GmailAccountModel] = None,
    outlook_acc: Optional[OutlookAccountModel] = None,
    assigned_email: Optional[str] = None,
    assigned_provider: Optional[str] = None,
) -> EmailAgentResponse:
    if not assigned_email:
        if agent.gmail_account_id and gmail_acc:
            assigned_email = getattr(gmail_acc, "email", None)
            assigned_provider = "gmail"
        elif agent.outlook_account_id and outlook_acc:
            assigned_email = getattr(outlook_acc, "email", None)
            assigned_provider = "outlook"

    return EmailAgentResponse(
        id=agent.id or 1,
        name=agent.name,
        description=agent.description,
        system_prompt=agent.system_prompt or "",
        gmail_account_id=agent.gmail_account_id,
        outlook_account_id=agent.outlook_account_id,
        assigned_email=assigned_email,
        assigned_provider=assigned_provider,
        model_config_ref=agent.model_config_ref or {},
        is_active=agent.is_active,
        auto_reply_enabled=agent.auto_reply_enabled,
        created_at=agent.created_at,
        updated_at=agent.updated_at,
    )


# ==============================================================================
# Routes
# ==============================================================================

@router.get("", response_model=List[EmailAgentResponse])
async def list_email_agents(
    user: UserModel = Depends(get_user),
) -> List[EmailAgentResponse]:
    """List all email agents for the user's organization."""
    org_id = _require_org(user)

    async with db_client.async_session() as session:
        stmt = (
            select(EmailAgentModel, GmailAccountModel, OutlookAccountModel)
            .outerjoin(GmailAccountModel, EmailAgentModel.gmail_account_id == GmailAccountModel.id)
            .outerjoin(OutlookAccountModel, EmailAgentModel.outlook_account_id == OutlookAccountModel.id)
            .where(EmailAgentModel.organization_id == org_id)
            .order_by(desc(EmailAgentModel.created_at))
        )
        res = await session.execute(stmt)
        rows = res.all()

        return [
            _format_agent_response(agent, g_acc, o_acc)
            for agent, g_acc, o_acc in rows
        ]


@router.post("", response_model=EmailAgentResponse, status_code=status.HTTP_201_CREATED)
async def create_email_agent(
    payload: CreateEmailAgentRequest,
    user: UserModel = Depends(get_user),
) -> EmailAgentResponse:
    """Create a new email agent for the organization."""
    org_id = _require_org(user)

    async with db_client.async_session() as session:
        # Check unique name within organization
        name_check = await session.execute(
            select(EmailAgentModel).where(
                EmailAgentModel.organization_id == org_id,
                EmailAgentModel.name == payload.name.strip(),
            )
        )
        if name_check.scalar_one_or_none():
            raise HTTPException(
                status_code=400,
                detail=f"An email agent named '{payload.name.strip()}' already exists in your organization",
            )

        # Validate linked accounts if provided
        gmail_acc = None
        if payload.gmail_account_id:
            g_res = await session.execute(
                select(GmailAccountModel).where(
                    GmailAccountModel.id == payload.gmail_account_id,
                    GmailAccountModel.organization_id == org_id,
                )
            )
            gmail_acc = g_res.scalar_one_or_none()
            if not gmail_acc:
                raise HTTPException(status_code=400, detail="Specified Gmail account does not exist or belong to your organization")

        outlook_acc = None
        if payload.outlook_account_id:
            o_res = await session.execute(
                select(OutlookAccountModel).where(
                    OutlookAccountModel.id == payload.outlook_account_id,
                    OutlookAccountModel.organization_id == org_id,
                )
            )
            outlook_acc = o_res.scalar_one_or_none()
            if not outlook_acc:
                raise HTTPException(status_code=400, detail="Specified Outlook account does not exist or belong to your organization")

        assigned_email = gmail_acc.email if gmail_acc else (outlook_acc.email if outlook_acc else None)
        assigned_provider = "gmail" if gmail_acc else ("outlook" if outlook_acc else None)

        new_agent = EmailAgentModel(
            organization_id=org_id,
            name=payload.name.strip(),
            description=payload.description,
            system_prompt=payload.system_prompt,
            gmail_account_id=payload.gmail_account_id,
            outlook_account_id=payload.outlook_account_id,
            model_config_ref=payload.model_config_ref or {},
            is_active=payload.is_active,
            auto_reply_enabled=payload.auto_reply_enabled,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        session.add(new_agent)
        await session.commit()
        await session.refresh(new_agent)

        return _format_agent_response(
            new_agent,
            gmail_acc,
            outlook_acc,
            assigned_email=assigned_email,
            assigned_provider=assigned_provider,
        )


@router.get("/{agent_id}", response_model=EmailAgentResponse)
async def get_email_agent(
    agent_id: int,
    user: UserModel = Depends(get_user),
) -> EmailAgentResponse:
    """Retrieve details of a specific email agent."""
    org_id = _require_org(user)

    async with db_client.async_session() as session:
        stmt = (
            select(EmailAgentModel, GmailAccountModel, OutlookAccountModel)
            .outerjoin(GmailAccountModel, EmailAgentModel.gmail_account_id == GmailAccountModel.id)
            .outerjoin(OutlookAccountModel, EmailAgentModel.outlook_account_id == OutlookAccountModel.id)
            .where(
                EmailAgentModel.id == agent_id,
                EmailAgentModel.organization_id == org_id,
            )
        )
        res = await session.execute(stmt)
        row = res.first()
        if not row:
            raise HTTPException(status_code=404, detail="Email agent not found")

        agent, g_acc, o_acc = row
        return _format_agent_response(agent, g_acc, o_acc)


@router.put("/{agent_id}", response_model=EmailAgentResponse)
async def update_email_agent(
    agent_id: int,
    payload: UpdateEmailAgentRequest,
    user: UserModel = Depends(get_user),
) -> EmailAgentResponse:
    """Update configuration of an email agent."""
    org_id = _require_org(user)

    async with db_client.async_session() as session:
        stmt = (
            select(EmailAgentModel)
            .where(
                EmailAgentModel.id == agent_id,
                EmailAgentModel.organization_id == org_id,
            )
        )
        res = await session.execute(stmt)
        agent = res.scalar_one_or_none()
        if not agent:
            raise HTTPException(status_code=404, detail="Email agent not found")

        # Name collision check
        if payload.name is not None and payload.name.strip() != agent.name:
            name_check = await session.execute(
                select(EmailAgentModel).where(
                    EmailAgentModel.organization_id == org_id,
                    EmailAgentModel.name == payload.name.strip(),
                    EmailAgentModel.id != agent_id,
                )
            )
            if name_check.scalar_one_or_none():
                raise HTTPException(
                    status_code=400,
                    detail=f"An email agent named '{payload.name.strip()}' already exists",
                )
            agent.name = payload.name.strip()

        if payload.description is not None:
            agent.description = payload.description
        if payload.system_prompt is not None:
            agent.system_prompt = payload.system_prompt
        if payload.is_active is not None:
            agent.is_active = payload.is_active
        if payload.auto_reply_enabled is not None:
            agent.auto_reply_enabled = payload.auto_reply_enabled
        if payload.model_config_ref is not None:
            agent.model_config_ref = payload.model_config_ref

        gmail_acc = None
        if payload.gmail_account_id is not None:
            if payload.gmail_account_id == 0:
                agent.gmail_account_id = None
            else:
                g_res = await session.execute(
                    select(GmailAccountModel).where(
                        GmailAccountModel.id == payload.gmail_account_id,
                        GmailAccountModel.organization_id == org_id,
                    )
                )
                gmail_acc = g_res.scalar_one_or_none()
                if not gmail_acc:
                    raise HTTPException(status_code=400, detail="Gmail account not found in organization")
                agent.gmail_account_id = payload.gmail_account_id

        outlook_acc = None
        if payload.outlook_account_id is not None:
            if payload.outlook_account_id == 0:
                agent.outlook_account_id = None
            else:
                o_res = await session.execute(
                    select(OutlookAccountModel).where(
                        OutlookAccountModel.id == payload.outlook_account_id,
                        OutlookAccountModel.organization_id == org_id,
                    )
                )
                outlook_acc = o_res.scalar_one_or_none()
                if not outlook_acc:
                    raise HTTPException(status_code=400, detail="Outlook account not found in organization")
                agent.outlook_account_id = payload.outlook_account_id

        agent.updated_at = datetime.now(UTC)
        await session.commit()
        await session.refresh(agent)

        # Fetch linked accounts for response if not already fetched
        if agent.gmail_account_id and not gmail_acc:
            g_res = await session.execute(select(GmailAccountModel).where(GmailAccountModel.id == agent.gmail_account_id))
            gmail_acc = g_res.scalar_one_or_none()
        if agent.outlook_account_id and not outlook_acc:
            o_res = await session.execute(select(OutlookAccountModel).where(OutlookAccountModel.id == agent.outlook_account_id))
            outlook_acc = o_res.scalar_one_or_none()

        assigned_email = getattr(gmail_acc, "email", None) if gmail_acc else getattr(outlook_acc, "email", None)
        assigned_provider = "gmail" if gmail_acc else ("outlook" if outlook_acc else None)

        return _format_agent_response(
            agent,
            gmail_acc,
            outlook_acc,
            assigned_email=assigned_email,
            assigned_provider=assigned_provider,
        )


@router.delete("/{agent_id}")
async def delete_email_agent(
    agent_id: int,
    user: UserModel = Depends(get_user),
) -> Dict[str, Any]:
    """Delete an email agent for the organization."""
    org_id = _require_org(user)

    async with db_client.async_session() as session:
        stmt = select(EmailAgentModel).where(
            EmailAgentModel.id == agent_id,
            EmailAgentModel.organization_id == org_id,
        )
        res = await session.execute(stmt)
        agent = res.scalar_one_or_none()
        if not agent:
            raise HTTPException(status_code=404, detail="Email agent not found")

        await session.delete(agent)
        await session.commit()

        return {"status": "deleted", "agent_id": agent_id, "name": agent.name}
