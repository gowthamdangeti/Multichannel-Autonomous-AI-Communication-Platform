"""Chat-agent routes (authenticated dashboard API).

Create and manage embeddable chat agents (a persona/system prompt + shared model
configuration), fetch the character presets, read conversation transcripts, and
get the widget embed snippet. The public widget endpoints live in
``routes/public_embed.py`` (unauthenticated, domain-gated).
"""

from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query

from api.constants import BACKEND_API_ENDPOINT, ENVIRONMENT, MAX_RANGE_DAYS, UI_APP_URL
from api.db import db_client
from api.db.models import ChatAgentModel, ChatConversationModel, UserModel
from api.schemas.chat import (
    ChatAgentCreate,
    ChatAgentResponse,
    ChatAgentUpdate,
    ChatCharacter,
    ChatConversationDetail,
    ChatConversationSummary,
    ChatMessage,
)
from api.schemas.chat_agent_overview import ChatAgentAnalyticsResponse
from api.services.auth.depends import get_user
from api.services.chat.completeness_evaluator import evaluate_chat_completeness
from api.services.chat.auto_evaluation import queue_chat_finish_jobs
from api.services.chat.conversation_title import resolve_chat_display_title
from api.services.chat.conversation_stats import (
    conversation_status,
    gathered_context,
    summarize_conversation,
)
from api.services.reports.chat_agent_overview import get_chat_agent_analytics
from api.services.whatsapp.characters import DEFAULT_CHARACTERS

router = APIRouter(prefix="/chat")


def _require_org(user: UserModel) -> int:
    if not user.selected_organization_id:
        raise HTTPException(status_code=400, detail="No organization selected")
    return user.selected_organization_id


def _embed_script(agent: ChatAgentModel) -> str:
    """The <script> snippet a customer pastes into their site."""
    base_url = str(UI_APP_URL).rstrip("/")
    return f"""<!-- Convozent Chat Widget -->
<script>
  (function(d, s, id) {{
    var js, fjs = d.getElementsByTagName(s)[0];
    if (d.getElementById(id)) return;
    js = d.createElement(s); js.id = id;
    js.src = '{base_url}/embed/convozent-widget.js?token={agent.public_key}&channel=chat&environment={ENVIRONMENT}&apiEndpoint={BACKEND_API_ENDPOINT}';
    js.async = true;
    fjs.parentNode.insertBefore(js, fjs);
  }}(document, 'script', 'convozent-chat-widget'));
</script>"""


def _agent_response(agent: ChatAgentModel, total_runs: int = 0) -> ChatAgentResponse:
    config_ref = dict(agent.model_config_ref or {})
    tool_ids = list(config_ref.get("tool_ids") or [])
    document_uuids = list(config_ref.get("document_uuids") or [])
    return ChatAgentResponse(
        id=agent.id,
        name=agent.name,
        description=agent.description,
        character=agent.character,
        system_prompt=agent.system_prompt or "",
        greeting=agent.greeting,
        model_config_ref=config_ref,
        tool_ids=tool_ids,
        document_uuids=document_uuids,
        public_key=agent.public_key,
        allowed_domains=list(agent.allowed_domains or []),
        appearance=dict(agent.appearance or {}),
        is_active=agent.is_active,
        total_runs=total_runs,
        embed_script=_embed_script(agent),
        created_at=agent.created_at,
        updated_at=agent.updated_at,
    )


async def _get_owned_agent(agent_id: int, organization_id: int) -> ChatAgentModel:
    agent = await db_client.get_chat_agent(agent_id, organization_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Chat agent not found")
    return agent


# ── Characters ───────────────────────────────────────────────────────────────


@router.get("/characters", response_model=List[ChatCharacter])
async def list_characters(user: UserModel = Depends(get_user)):
    return [ChatCharacter(**c) for c in DEFAULT_CHARACTERS]


# ── Agents ───────────────────────────────────────────────────────────────────


@router.post("/agents", response_model=ChatAgentResponse)
async def create_agent(body: ChatAgentCreate, user: UserModel = Depends(get_user)):
    org_id = _require_org(user)
    from api.services.billing.agent_limits import agent_limit_guard

    await agent_limit_guard.assert_can_create_agent(org_id, kind="chat", user=user)
    config_ref = dict(body.model_config_ref or {})
    if body.tool_ids:
        config_ref["tool_ids"] = body.tool_ids
    if body.document_uuids:
        config_ref["document_uuids"] = body.document_uuids

    agent = await db_client.create_chat_agent(
        organization_id=org_id,
        name=body.name,
        description=body.description,
        character=body.character,
        system_prompt=body.system_prompt,
        greeting=body.greeting,
        model_config_ref=config_ref,
        allowed_domains=body.allowed_domains or None,
        appearance=body.appearance.model_dump(),
    )
    return _agent_response(agent, total_runs=0)


@router.get("/agents", response_model=List[ChatAgentResponse])
async def list_agents(user: UserModel = Depends(get_user)):
    org_id = _require_org(user)
    agents = await db_client.list_chat_agents(org_id)
    agent_ids = [a.id for a in agents]
    run_counts = await db_client.get_chat_agent_run_counts(agent_ids, org_id)
    return [
        _agent_response(a, total_runs=run_counts.get(a.id, 0))
        for a in agents
    ]


@router.get("/agents/{agent_id}", response_model=ChatAgentResponse)
async def get_agent(agent_id: int, user: UserModel = Depends(get_user)):
    org_id = _require_org(user)
    agent = await _get_owned_agent(agent_id, org_id)
    run_counts = await db_client.get_chat_agent_run_counts([agent_id], org_id)
    return _agent_response(agent, total_runs=run_counts.get(agent_id, 0))


@router.patch("/agents/{agent_id}", response_model=ChatAgentResponse)
async def update_agent(
    agent_id: int, body: ChatAgentUpdate, user: UserModel = Depends(get_user)
):
    org_id = _require_org(user)
    existing_agent = await _get_owned_agent(agent_id, org_id)

    fields = body.model_dump(exclude_unset=True)
    tool_ids = fields.pop("tool_ids", None)
    document_uuids = fields.pop("document_uuids", None)

    config_ref = dict(fields.get("model_config_ref") or existing_agent.model_config_ref or {})
    if tool_ids is not None:
        config_ref["tool_ids"] = tool_ids
    if document_uuids is not None:
        config_ref["document_uuids"] = document_uuids
    fields["model_config_ref"] = config_ref

    if "allowed_domains" in fields:
        # Empty list means "any origin" — store NULL for that.
        fields["allowed_domains"] = fields["allowed_domains"] or None
    if "appearance" in fields and fields["appearance"] is not None:
        # body.appearance is a ChatAppearance; model_dump already made it a dict.
        pass

    agent = await db_client.update_chat_agent(agent_id, org_id, **fields)
    run_counts = await db_client.get_chat_agent_run_counts([agent_id], org_id)
    return _agent_response(agent, total_runs=run_counts.get(agent_id, 0))


@router.get("/agents/{agent_id}/analytics", response_model=ChatAgentAnalyticsResponse)
async def get_agent_analytics(
    agent_id: int,
    days: int = Query(default=30, ge=0, le=MAX_RANGE_DAYS, description="0 means all time"),
    user: UserModel = Depends(get_user),
):
    """Conversation KPIs, trend, timing and reported reply usage for one chat agent."""
    org_id = _require_org(user)
    await _get_owned_agent(agent_id, org_id)
    return await get_chat_agent_analytics(
        organization_id=org_id, chat_agent_id=agent_id, days=days
    )


@router.delete("/agents/{agent_id}")
async def delete_agent(agent_id: int, user: UserModel = Depends(get_user)):
    org_id = _require_org(user)
    ok = await db_client.delete_chat_agent(agent_id, org_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Chat agent not found")
    return {"ok": True}


# ── Conversations ────────────────────────────────────────────────────────────


def _conversation_summary(
    convo: ChatConversationModel, agents_by_id: dict
) -> ChatConversationSummary:
    messages = list(convo.messages or [])
    last = messages[-1] if messages else None
    agent = agents_by_id.get(convo.chat_agent_id)
    stats = summarize_conversation(messages, convo.created_at, convo.updated_at)
    return ChatConversationSummary(
        id=convo.id,
        title=resolve_chat_display_title(
            convo.conversation_title, agent.name if agent else None, convo.id
        ),
        chat_agent_id=convo.chat_agent_id,
        agent_name=agent.name if agent else None,
        origin=convo.origin,
        message_count=len(messages),
        last_message=(last or {}).get("content") if last else None,
        last_role=(last or {}).get("role") if last else None,
        prompt_tokens=stats.prompt_tokens,
        completion_tokens=stats.completion_tokens,
        total_tokens=stats.total_tokens,
        status=conversation_status(
            convo.last_error, convo.updated_at, end_reason=convo.end_reason
        ),
        error=convo.last_error or None,
        duration_seconds=stats.duration_seconds,
        created_at=convo.created_at,
        updated_at=convo.updated_at,
    )


@router.get("/conversations", response_model=List[ChatConversationSummary])
async def list_conversations(user: UserModel = Depends(get_user)):
    org_id = _require_org(user)
    convos = await db_client.list_chat_conversations(org_id)
    agents_by_id = {a.id: a for a in await db_client.list_chat_agents(org_id)}
    return [_conversation_summary(c, agents_by_id) for c in convos]


@router.get(
    "/conversations/{conversation_id}", response_model=ChatConversationDetail
)
async def get_conversation_detail(
    conversation_id: int, user: UserModel = Depends(get_user)
):
    org_id = _require_org(user)
    convo = await db_client.get_chat_conversation(conversation_id, org_id)
    if convo is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    agents_by_id = {a.id: a for a in await db_client.list_chat_agents(org_id)}
    summary = _conversation_summary(convo, agents_by_id)
    # A finished conversation still missing its title or evaluation (its end was
    # never reported, or it predates them) gets both in the background; the next
    # read picks them up.
    if summary.status in ("completed", "disconnected"):
        await queue_chat_finish_jobs(convo)
    raw_messages: list[dict] = list(convo.messages or [])
    return ChatConversationDetail(
        **summary.model_dump(),
        initial_context=convo.initial_context or {},
        gathered_context=gathered_context(
            raw_messages,
            convo.last_error,
            summary.status,
            summarize_conversation(raw_messages, convo.created_at, convo.updated_at),
        ),
        qa_results=convo.qa_results or {},
        messages=[
            ChatMessage(**m)
            for m in raw_messages
            if isinstance(m, dict)
        ],
    )


@router.post("/conversations/{conversation_id}/completeness")
async def evaluate_chat_conversation_completeness(
    conversation_id: int, user: UserModel = Depends(get_user)
):
    """Judge the conversation against its agent's prompt and save the result."""
    org_id = _require_org(user)
    convo = await db_client.get_chat_conversation(conversation_id, org_id)
    if convo is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    agent = await db_client.get_chat_agent(convo.chat_agent_id, org_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Chat agent not found")

    result = await evaluate_chat_completeness(
        agent, list(convo.messages or []), convo.end_reason
    )
    # Keep the evaluation with the conversation so it is recorded, not recomputed blind.
    await db_client.set_chat_qa_results(conversation_id, org_id, result)
    return result
