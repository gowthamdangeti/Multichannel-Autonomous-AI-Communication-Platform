"""AI Rules Engine for email automation.

Translates natural language instructions into structured conditions/actions,
evaluates rules against incoming messages, executes authorized actions,
and maintains complete audit execution logs.
"""

from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional, Tuple

import httpx
from loguru import logger
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.db.models import (
    EmailAIRunModel,
    EmailMessageModel,
    EmailRuleActionModel,
    EmailRuleConditionModel,
    EmailRuleExecutionModel,
    EmailRuleModel,
)
from api.services.email.ai_service import get_email_llm_client, sanitize_email_content
from api.services.gen_ai.temperature import create_chat_completion

ALLOWED_FIELDS = {"sender", "sender_domain", "subject", "content", "category", "importance"}
ALLOWED_OPERATORS = {"contains", "equals", "starts_with", "ends_with", "matches_regex", "is", "not_equals"}
ALLOWED_ACTION_TYPES = {
    "mark_important",
    "apply_label",
    "archive",
    "generate_reply",
    "save_draft",
    "send_reply",
    "forward",
    "notify_user",
    "trigger_webhook",
}


class RuleConditionSchema(BaseModel):
    field: str = Field(..., description="Field to test: sender, sender_domain, subject, content, category, importance")
    operator: str = Field("contains", description="Operator: contains, equals, starts_with, ends_with, matches_regex, is, not_equals")
    value: str = Field(..., description="Value or pattern to compare against")


class RuleActionSchema(BaseModel):
    action_type: str = Field(..., description="Type of action: mark_important, apply_label, archive, generate_reply, save_draft, send_reply, forward, notify_user, trigger_webhook")
    parameters: Dict[str, Any] = Field(default_factory=dict, description="Action-specific parameters")


class InterpretedRuleSchema(BaseModel):
    name: str = Field(..., description="Short descriptive rule name")
    description: str = Field("", description="Rule summary")
    priority: int = Field(0, description="Rule execution priority, higher runs first")
    conditions: List[RuleConditionSchema] = Field(..., description="Matching conditions")
    actions: List[RuleActionSchema] = Field(..., description="Actions to execute")


async def interpret_natural_language_rule(
    organization_id: int,
    prompt: str,
) -> InterpretedRuleSchema:
    """Use LLM to translate a natural language rule prompt into structured conditions and actions."""
    client, model_name = await get_email_llm_client(organization_id)
    safe_prompt = sanitize_email_content(prompt, 2000)

    system_instruction = f"""You are a compiler for email automation rules.
Translate the user's natural language instruction into structured JSON conditions and actions.

Allowed condition fields: sender, sender_domain, subject, content, category, importance
Allowed operators: contains, equals, starts_with, ends_with, matches_regex, is, not_equals
Allowed action types: mark_important, apply_label, archive, generate_reply, save_draft, send_reply, forward, notify_user, trigger_webhook

Examples:
- Prompt: "When I get an email about a job interview, mark it important and draft a reply"
  Output:
  {{
    "name": "Interview Emails",
    "description": "Mark interviews important and draft reply",
    "priority": 10,
    "conditions": [
      {{"field": "subject", "operator": "contains", "value": "interview"}},
      {{"field": "category", "operator": "equals", "value": "job_opportunity"}}
    ],
    "actions": [
      {{"action_type": "mark_important", "parameters": {{}}}},
      {{"action_type": "generate_reply", "parameters": {{"tone": "professional and enthusiastic"}}}}
    ]
  }}

Respond ONLY with a valid JSON object matching the InterpretedRuleSchema.
"""

    response = await create_chat_completion(client,
        model=model_name,
        messages=[
            {"role": "system", "content": system_instruction},
            {"role": "user", "content": safe_prompt},
        ],
        response_format={"type": "json_object"},
        temperature=0.1,
    )
    content = response.choices[0].message.content or "{}"
    data = json.loads(content)
    return InterpretedRuleSchema(**data)


def evaluate_condition(message: EmailMessageModel, condition: EmailRuleConditionModel) -> bool:
    """Evaluate a single rule condition against an email message."""
    field = condition.field.lower()
    op = condition.operator.lower()
    target_val = (condition.value or "").strip().lower()

    # Extract field value from message
    actual_val = ""
    if field == "sender":
        actual_val = (message.sender or "").lower()
    elif field == "sender_domain":
        sender = (message.sender or "").lower()
        if "@" in sender:
            actual_val = sender.split("@")[-1].replace(">", "").strip()
    elif field == "subject":
        actual_val = (message.subject or "").lower()
    elif field == "content":
        actual_val = (message.body_text or "").lower()
    elif field == "category":
        actual_val = (message.ai_category or "").lower()
    elif field == "importance":
        actual_val = (message.ai_priority or "").lower()

    if op in ("contains", "is"):
        return target_val in actual_val
    elif op == "equals":
        return actual_val == target_val
    elif op == "not_equals":
        return actual_val != target_val
    elif op == "starts_with":
        return actual_val.startswith(target_val)
    elif op == "ends_with":
        return actual_val.endswith(target_val)
    elif op == "matches_regex":
        try:
            return bool(re.search(target_val, actual_val, re.IGNORECASE))
        except Exception:
            return False
    return False


async def execute_action(
    session: AsyncSession,
    message: EmailMessageModel,
    action: EmailRuleActionModel,
    dry_run: bool = False,
) -> Dict[str, Any]:
    """Execute or simulate an individual rule action on an email message."""
    action_type = action.action_type
    params = action.parameters or {}

    if dry_run:
        return {"action": action_type, "status": "simulated", "parameters": params}

    if action_type == "mark_important":
        message.ai_priority = "high"
        return {"action": action_type, "status": "executed", "priority": "high"}

    elif action_type == "archive":
        message.is_archived = True
        return {"action": action_type, "status": "executed", "archived": True}

    elif action_type == "apply_label":
        label = params.get("label", "Automated")
        labels = list(message.gmail_labels or [])
        if label not in labels:
            labels.append(label)
            message.gmail_labels = labels
        return {"action": action_type, "status": "executed", "applied_label": label}

    elif action_type == "save_draft":
        draft_text = params.get("text", "Draft reply")
        run = EmailAIRunModel(
            organization_id=message.organization_id,
            email_message_id=message.id,
            draft_reply=draft_text,
            status="completed",
            auto_send_status="draft_saved",
        )
        session.add(run)
        return {"action": action_type, "status": "executed", "draft": draft_text}

    elif action_type == "trigger_webhook":
        webhook_url = params.get("url")
        if webhook_url:
            async with httpx.AsyncClient(timeout=10.0) as http:
                await http.post(
                    webhook_url,
                    json={
                        "event": "email_rule_action",
                        "message_id": message.id,
                        "subject": message.subject,
                        "sender": message.sender,
                    },
                )
            return {"action": action_type, "status": "executed", "webhook_url": webhook_url}

    elif action_type == "send_reply":
        # Enforce security barrier: Only execute if explicitly approved
        if not params.get("authorized", False):
            return {
                "action": action_type,
                "status": "blocked",
                "reason": "Automatic email sending requires explicit authorization parameter: authorized=true",
            }
        return {"action": action_type, "status": "authorized_send_queued"}

    return {"action": action_type, "status": "no_op", "parameters": params}


async def evaluate_rules_for_message(
    session: AsyncSession,
    message: EmailMessageModel,
    dry_run: bool = False,
) -> List[Dict[str, Any]]:
    """Evaluate all active rules for the organization against a message and execute matching actions."""
    rules_stmt = (
        select(EmailRuleModel)
        .options(
            selectinload(EmailRuleModel.conditions),
            selectinload(EmailRuleModel.actions),
        )
        .where(
            EmailRuleModel.organization_id == message.organization_id,
            EmailRuleModel.is_active == True,
        )
        .order_by(EmailRuleModel.priority.desc())
    )
    res = await session.execute(rules_stmt)
    rules = res.scalars().all()

    execution_results = []

    for rule in rules:
        # Check for previous execution to prevent duplicates
        if not dry_run:
            dup_stmt = select(EmailRuleExecutionModel).where(
                EmailRuleExecutionModel.rule_id == rule.id,
                EmailRuleExecutionModel.message_id == message.id,
            )
            already_run = (await session.execute(dup_stmt)).scalars().first()
            if already_run:
                continue

        # Evaluate conditions (AND logic: all conditions in rule must match)
        conditions_met = True
        for cond in rule.conditions:
            if not evaluate_condition(message, cond):
                conditions_met = False
                break

        if conditions_met and rule.actions:
            action_reports = []
            for action in rule.actions:
                report = await execute_action(session, message, action, dry_run=dry_run)
                action_reports.append(report)

            if not dry_run:
                execution_record = EmailRuleExecutionModel(
                    rule_id=rule.id,
                    message_id=message.id,
                    organization_id=message.organization_id,
                    status="success",
                    details={"actions": action_reports},
                )
                session.add(execution_record)

            execution_results.append({
                "rule_id": rule.id,
                "rule_name": rule.name,
                "actions": action_reports,
            })

    if not dry_run:
        await session.commit()

    return execution_results

