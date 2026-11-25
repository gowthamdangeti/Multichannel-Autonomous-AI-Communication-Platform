"""Chat conversation titles: the chat counterpart of the voice run title.

Same rules as voice (``api/services/reports/conversation_title.py``): a short
LLM title grounded in what the visitor actually said, with a deterministic
fallback when there is no usable model or transcript. Website chat is always an
embed, so the fallback is voice's embed form with the conversation id added so
each one is distinct: ``{agent name}_embed_{conversation id}``.

The title is generated once the visitor's session ends and saved on the
conversation; until then (and for any conversation without one) the display
title is the fallback, so a title is never blank.
"""

from __future__ import annotations

from typing import Optional

from loguru import logger

from api.db import db_client
from api.services.agents_llm import openai_params
from api.services.configuration.ai_model_configuration import (
    get_effective_ai_model_configuration_for_workflow,
)
from api.services.reports.conversation_title import (
    build_fallback_title,
    generate_conversation_title_llm,
)
from api.services.chat.transcript import live_messages
from api.services.reports.extraction import _is_quota_error

def resolve_chat_display_title(
    conversation_title: Optional[str], agent_name: Optional[str], conversation_id: Optional[int]
) -> str:
    """The saved title, else the deterministic fallback. Never blank."""
    if isinstance(conversation_title, str) and conversation_title.strip():
        return conversation_title.strip()
    name = agent_name.strip() if isinstance(agent_name, str) else ""
    if name and conversation_id is not None:
        return f"{name}_embed_{conversation_id}"[:120]
    return build_fallback_title(workflow_name=name or None, run_id=conversation_id)


def to_title_transcript(messages: list[dict]) -> list[dict]:
    """Stored chat messages in the ``{role, message}`` shape the voice titler reads."""
    return [
        {"role": "user" if m.get("role") == "user" else "assistant", "message": m.get("content", "")}
        for m in live_messages(messages)
        if m.get("content")
    ]


async def _resolve_llm_config(agent) -> Optional[dict]:
    """The agent's own model, as the voice titler expects it; None when unusable."""
    try:
        effective = await get_effective_ai_model_configuration_for_workflow(
            user_id=None,
            organization_id=agent.organization_id,
            workflow_configurations=agent.model_config_ref or {},
        )
        if effective.llm is None:
            return None
        base_url, model, api_key = openai_params(effective.llm)
        return {"api_key": api_key, "model": model, "base_url": base_url} if api_key else None
    except Exception as e:
        if _is_quota_error(e):
            raise
        logger.warning(f"Chat title: no model config for agent {agent.id}: {e}")
        return None


async def _llm_title(agent, messages: list[dict]) -> Optional[str]:
    """One LLM attempt; any failure (including a quota hit) means no LLM title."""
    try:
        llm_config = await _resolve_llm_config(agent)
        if not llm_config:
            return None
        return await generate_conversation_title_llm(
            transcript_messages=to_title_transcript(messages),
            workflow_name=agent.name,
            llm_config=llm_config,
        )
    except Exception as e:
        logger.warning(f"Chat title: LLM title failed for agent {agent.id}, using fallback: {e}")
        return None


async def generate_chat_conversation_title(conversation_id: int, organization_id: int) -> Optional[str]:
    """Create and save the title for one conversation; never raises.

    Idempotent: a conversation that already has a title is left alone. A
    fallback is saved when the LLM gives nothing, as voice does, so the
    conversation is not re-titled on every read.
    """
    try:
        convo = await db_client.get_chat_conversation(conversation_id, organization_id)
        if convo is None or convo.conversation_title:
            return None
        agent = await db_client.get_chat_agent(convo.chat_agent_id, organization_id)
        if agent is None:
            return None
        title = await _llm_title(agent, list(convo.messages or [])) or resolve_chat_display_title(
            None, agent.name, convo.id
        )
        await db_client.set_chat_conversation_title(conversation_id, organization_id, title)
        logger.info(f"Chat conversation {conversation_id} title: {title}")
        return title
    except Exception as e:
        logger.error(f"Failed to title chat conversation {conversation_id}: {e}")
        return None


async def queue_chat_title_generation(conversation_id: int, organization_id: int) -> None:
    """Hand the titling to the ARQ worker; a queueing failure is logged, not raised."""
    try:
        from api.tasks.arq import enqueue_job
        from api.tasks.function_names import FunctionNames

        await enqueue_job(
            FunctionNames.GENERATE_CHAT_CONVERSATION_TITLE, conversation_id, organization_id
        )
    except Exception as e:
        logger.error(f"Could not queue chat title for conversation {conversation_id}: {e}")
