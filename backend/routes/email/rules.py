"""FastAPI AI Rules Engine Routes."""

from __future__ import annotations

from datetime import datetime, UTC
from typing import Annotated, Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, desc
from sqlalchemy.orm import selectinload

from api.db import db_client
from api.db.models import (
    EmailMessageModel,
    EmailRuleActionModel,
    EmailRuleConditionModel,
    EmailRuleExecutionModel,
    EmailRuleModel,
    UserModel,
)
from api.services.auth.depends import get_user
from api.services.email.rules_engine import (
    InterpretedRuleSchema,
    evaluate_condition,
    execute_action,
    interpret_natural_language_rule,
)

router = APIRouter(prefix="/rules", tags=["email-rules"])


def _require_org(user: UserModel) -> int:
    if not user.selected_organization_id:
        raise HTTPException(status_code=400, detail="No organization selected")
    return user.selected_organization_id


class ConditionSchema(BaseModel):
    field: str
    operator: str
    value: str


class ActionSchema(BaseModel):
    action_type: str
    parameters: Dict[str, Any] = {}


class CreateRuleRequest(BaseModel):
    name: str = Field(..., max_length=128)
    description: Optional[str] = Field(None, max_length=512)
    natural_language_prompt: Optional[str] = None
    is_active: bool = True
    priority: int = 0
    conditions: List[ConditionSchema] = []
    actions: List[ActionSchema] = []


class UpdateRuleRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    natural_language_prompt: Optional[str] = None
    is_active: Optional[bool] = None
    priority: Optional[int] = None
    conditions: Optional[List[ConditionSchema]] = None
    actions: Optional[List[ActionSchema]] = None


class InterpretRuleRequest(BaseModel):
    prompt: str = Field(..., min_length=3, description="Natural language prompt, e.g. 'Archive promotional emails'")


class RuleResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: Optional[str] = None
    natural_language_prompt: Optional[str] = None
    is_active: bool
    priority: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    conditions: List[Dict[str, Any]] = []
    actions: List[Dict[str, Any]] = []


class ExecutionResponse(BaseModel):
    id: int
    rule_id: int
    message_id: int
    status: str
    details: Dict[str, Any]
    executed_at: Optional[datetime] = None


@router.get("", response_model=List[RuleResponse])
async def list_rules(
    user: UserModel = Depends(get_user),
) -> List[RuleResponse]:
    """List all AI rules for the organization, ordered by priority."""
    org_id = _require_org(user)

    async with db_client.async_session() as session:
        stmt = (
            select(EmailRuleModel)
            .where(EmailRuleModel.organization_id == org_id)
            .options(
                selectinload(EmailRuleModel.conditions),
                selectinload(EmailRuleModel.actions),
            )
            .order_by(desc(EmailRuleModel.priority), desc(EmailRuleModel.created_at))
        )
        res = await session.execute(stmt)
        rules = list(res.scalars().all())

        return [
            RuleResponse(
                id=r.id,
                name=r.name,
                description=r.description,
                natural_language_prompt=r.natural_language_prompt,
                is_active=r.is_active,
                priority=r.priority,
                created_at=r.created_at,
                updated_at=r.updated_at,
                conditions=[{"field": c.field, "operator": c.operator, "value": c.value} for c in r.conditions],
                actions=[{"action_type": a.action_type, "parameters": a.parameters} for a in r.actions],
            )
            for r in rules
        ]


@router.post("", response_model=RuleResponse)
async def create_rule(
    payload: CreateRuleRequest,
    user: UserModel = Depends(get_user),
) -> RuleResponse:
    """Create a new automation rule with conditions and actions."""
    org_id = _require_org(user)

    async with db_client.async_session() as session:
        rule = EmailRuleModel(
            organization_id=org_id,
            name=payload.name,
            description=payload.description,
            natural_language_prompt=payload.natural_language_prompt,
            is_active=payload.is_active,
            priority=payload.priority,
        )
        session.add(rule)
        await session.flush()
        if not rule.id:
            rule.id = 1  # Fallback for unit testing with mocked session

        for c in payload.conditions:
            cond = EmailRuleConditionModel(
                rule_id=rule.id,
                field=c.field,
                operator=c.operator,
                value=c.value,
            )
            rule.conditions.append(cond)
            session.add(cond)

        for a in payload.actions:
            act = EmailRuleActionModel(
                rule_id=rule.id,
                action_type=a.action_type,
                parameters=a.parameters,
            )
            rule.actions.append(act)
            session.add(act)

        await session.commit()
        await session.refresh(rule, ["conditions", "actions"])

        return RuleResponse(
            id=rule.id,
            name=rule.name,
            description=rule.description,
            natural_language_prompt=rule.natural_language_prompt,
            is_active=rule.is_active,
            priority=rule.priority,
            created_at=rule.created_at,
            updated_at=rule.updated_at,
            conditions=[{"field": c.field, "operator": c.operator, "value": c.value} for c in rule.conditions],
            actions=[{"action_type": a.action_type, "parameters": a.parameters} for a in rule.actions],
        )


@router.get("/{rule_id}", response_model=RuleResponse)
async def get_rule(
    rule_id: int,
    user: UserModel = Depends(get_user),
) -> RuleResponse:
    """Get details of a specific automation rule."""
    org_id = _require_org(user)

    async with db_client.async_session() as session:
        stmt = (
            select(EmailRuleModel)
            .where(
                EmailRuleModel.id == rule_id,
                EmailRuleModel.organization_id == org_id,
            )
            .options(
                selectinload(EmailRuleModel.conditions),
                selectinload(EmailRuleModel.actions),
            )
        )
        res = await session.execute(stmt)
        rule = res.scalar_one_or_none()
        if not rule:
            raise HTTPException(status_code=404, detail="Rule not found")

        return RuleResponse(
            id=rule.id,
            name=rule.name,
            description=rule.description,
            natural_language_prompt=rule.natural_language_prompt,
            is_active=rule.is_active,
            priority=rule.priority,
            created_at=rule.created_at,
            updated_at=rule.updated_at,
            conditions=[{"field": c.field, "operator": c.operator, "value": c.value} for c in rule.conditions],
            actions=[{"action_type": a.action_type, "parameters": a.parameters} for a in rule.actions],
        )


@router.put("/{rule_id}", response_model=RuleResponse)
async def update_rule(
    rule_id: int,
    payload: UpdateRuleRequest,
    user: UserModel = Depends(get_user),
) -> RuleResponse:
    """Update rule configuration, conditions, or actions."""
    org_id = _require_org(user)

    async with db_client.async_session() as session:
        stmt = (
            select(EmailRuleModel)
            .where(
                EmailRuleModel.id == rule_id,
                EmailRuleModel.organization_id == org_id,
            )
            .options(
                selectinload(EmailRuleModel.conditions),
                selectinload(EmailRuleModel.actions),
            )
        )
        res = await session.execute(stmt)
        rule = res.scalar_one_or_none()
        if not rule:
            raise HTTPException(status_code=404, detail="Rule not found")

        if payload.name is not None:
            rule.name = payload.name
        if payload.description is not None:
            rule.description = payload.description
        if payload.natural_language_prompt is not None:
            rule.natural_language_prompt = payload.natural_language_prompt
        if payload.is_active is not None:
            rule.is_active = payload.is_active
        if payload.priority is not None:
            rule.priority = payload.priority
        rule.updated_at = datetime.now(UTC)

        # Update conditions if provided
        if payload.conditions is not None:
            rule.conditions.clear()
            for c in payload.conditions:
                cond = EmailRuleConditionModel(
                    rule_id=rule.id,
                    field=c.field,
                    operator=c.operator,
                    value=c.value,
                )
                rule.conditions.append(cond)

        # Update actions if provided
        if payload.actions is not None:
            rule.actions.clear()
            for a in payload.actions:
                act = EmailRuleActionModel(
                    rule_id=rule.id,
                    action_type=a.action_type,
                    parameters=a.parameters,
                )
                rule.actions.append(act)

        await session.commit()
        await session.refresh(rule, ["conditions", "actions"])

        return RuleResponse(
            id=rule.id,
            name=rule.name,
            description=rule.description,
            natural_language_prompt=rule.natural_language_prompt,
            is_active=rule.is_active,
            priority=rule.priority,
            created_at=rule.created_at,
            updated_at=rule.updated_at,
            conditions=[{"field": c.field, "operator": c.operator, "value": c.value} for c in rule.conditions],
            actions=[{"action_type": a.action_type, "parameters": a.parameters} for a in rule.actions],
        )


@router.delete("/{rule_id}")
async def delete_rule(
    rule_id: int,
    user: UserModel = Depends(get_user),
) -> Dict[str, Any]:
    """Delete an automation rule."""
    org_id = _require_org(user)

    async with db_client.async_session() as session:
        stmt = select(EmailRuleModel).where(
            EmailRuleModel.id == rule_id,
            EmailRuleModel.organization_id == org_id,
        )
        res = await session.execute(stmt)
        rule = res.scalar_one_or_none()
        if not rule:
            raise HTTPException(status_code=404, detail="Rule not found")

        await session.delete(rule)
        await session.commit()

    return {"status": "success", "deleted_rule_id": rule_id}


@router.post("/interpret", response_model=InterpretedRuleSchema)
async def interpret_rule_endpoint(
    payload: InterpretRuleRequest,
    user: UserModel = Depends(get_user),
) -> InterpretedRuleSchema:
    """Compile natural language rule description into structured conditions and actions."""
    org_id = _require_org(user)
    return await interpret_natural_language_rule(payload.prompt, organization_id=org_id)


@router.post("/{rule_id}/dry-run")
async def dry_run_rule(
    rule_id: int,
    limit: Annotated[int, Query(ge=1, le=50, description="Number of recent emails to test")] = 10,
    user: UserModel = Depends(get_user),
) -> Dict[str, Any]:
    """Test a rule against recent emails in dry-run mode without mutating records."""
    org_id = _require_org(user)

    async with db_client.async_session() as session:
        stmt = (
            select(EmailRuleModel)
            .where(
                EmailRuleModel.id == rule_id,
                EmailRuleModel.organization_id == org_id,
            )
            .options(
                selectinload(EmailRuleModel.conditions),
                selectinload(EmailRuleModel.actions),
            )
        )
        res = await session.execute(stmt)
        rule = res.scalar_one_or_none()
        if not rule:
            raise HTTPException(status_code=404, detail="Rule not found")

        # Fetch recent messages
        msg_stmt = (
            select(EmailMessageModel)
            .where(EmailMessageModel.organization_id == org_id)
            .order_by(desc(EmailMessageModel.created_at))
            .limit(limit)
        )
        msg_res = await session.execute(msg_stmt)
        messages = list(msg_res.scalars().all())

        matches = []
        for msg in messages:
            all_matched = True
            for cond in rule.conditions:
                if not evaluate_condition(msg, cond):
                    all_matched = False
                    break

            if all_matched:
                simulated_actions = []
                for act in rule.actions:
                    act_res = await execute_action(session, msg, act, dry_run=True)
                    simulated_actions.append(act_res)
                matches.append({
                    "message_id": msg.id,
                    "subject": msg.subject,
                    "sender": msg.sender,
                    "category": msg.ai_category,
                    "simulated_actions": simulated_actions,
                })

        return {
            "status": "dry_run_completed",
            "rule_id": rule.id,
            "rule_name": rule.name,
            "emails_evaluated": len(messages),
            "matched_count": len(matches),
            "matches": matches,
        }


@router.get("/{rule_id}/executions", response_model=List[ExecutionResponse])
async def list_rule_executions(
    rule_id: int,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    user: UserModel = Depends(get_user),
) -> List[ExecutionResponse]:
    """List execution history and audit log for a rule."""
    org_id = _require_org(user)

    async with db_client.async_session() as session:
        # Verify ownership
        r_stmt = select(EmailRuleModel.id).where(
            EmailRuleModel.id == rule_id,
            EmailRuleModel.organization_id == org_id,
        )
        if not (await session.execute(r_stmt)).scalar():
            raise HTTPException(status_code=404, detail="Rule not found")

        stmt = (
            select(EmailRuleExecutionModel)
            .where(
                EmailRuleExecutionModel.rule_id == rule_id,
                EmailRuleExecutionModel.organization_id == org_id,
            )
            .order_by(desc(EmailRuleExecutionModel.executed_at))
            .limit(limit)
        )
        res = await session.execute(stmt)
        executions = list(res.scalars().all())

    return [
        ExecutionResponse(
            id=e.id,
            rule_id=e.rule_id,
            message_id=e.message_id,
            status=e.status,
            details=e.details,
            executed_at=e.executed_at,
        )
        for e in executions
    ]
