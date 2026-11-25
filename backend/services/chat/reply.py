"""Chat-agent reply engine.

Given a chat agent + the running transcript, call the LLM (via the org's shared
model configuration, the same resolver workflows use) and return the reply text.
Mirrors the WhatsApp reply path but returns text instead of sending it anywhere.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Optional, Union

from loguru import logger
from openai import AsyncOpenAI

from api.db.models import ChatAgentModel
from api.services.agents_llm import openai_params as _openai_params
from api.services.configuration.ai_model_configuration import (
    get_effective_ai_model_configuration_for_workflow,
)
from api.services.gen_ai.temperature import create_chat_completion


@dataclass(frozen=True)
class ChatReply:
    """The assistant's text plus what the provider itself reported about the call."""

    text: str
    model: str
    latency_ms: int
    prompt_tokens: Optional[int]
    completion_tokens: Optional[int]

    def as_message(self) -> dict:
        """Transcript entry; usage is stored only when the provider returned it."""
        message: dict = {
            "role": "assistant",
            "content": self.text,
            "model": self.model,
            "latency_ms": self.latency_ms,
        }
        if self.prompt_tokens is not None:
            message["prompt_tokens"] = self.prompt_tokens
        if self.completion_tokens is not None:
            message["completion_tokens"] = self.completion_tokens
        return message


# Longest provider error text kept on a conversation.
_MAX_ERROR_CHARS = 300


@dataclass(frozen=True)
class ChatReplyFailure:
    """Why no reply was produced; stored on the conversation as its error status."""

    reason: str  # no_model_config | no_api_key | model_error | empty_reply
    message: str
    model: Optional[str] = None

    def as_error(self) -> dict:
        return {
            "reason": self.reason,
            "message": self.message[:_MAX_ERROR_CHARS],
            "model": self.model,
            "at": datetime.now(UTC).isoformat(),
        }


async def generate_chat_reply(
    agent: ChatAgentModel, history: list[dict], user_text: str
) -> Union[ChatReply, ChatReplyFailure]:
    """Produce the assistant's reply for one inbound chat message.

    Never raises: a failure comes back as a ``ChatReplyFailure`` the caller records.
    """
    effective = await get_effective_ai_model_configuration_for_workflow(
        user_id=None,
        organization_id=agent.organization_id,
        workflow_configurations=agent.model_config_ref or {},
    )
    llm = effective.llm
    if llm is None:
        logger.warning(f"Chat agent {agent.id}: no LLM in model configuration")
        return ChatReplyFailure("no_model_config", "No language model is configured for this agent.")

    base_url, model, api_key = _openai_params(llm)
    if not api_key:
        logger.warning(f"Chat agent {agent.id}: model configuration has no API key")
        return ChatReplyFailure("no_api_key", "The model configuration has no API key.", model)

    messages: list[dict] = []
    system = (agent.system_prompt or "").strip()
    if system:
        messages.append({"role": "system", "content": system})
    # Stored entries carry usage fields the provider API would reject.
    messages.extend(
        {"role": m["role"], "content": m["content"]}
        for m in history
        if m.get("role") and m.get("content") and not m.get("superseded")
    )
    messages.append({"role": "user", "content": user_text})

    client = (
        AsyncOpenAI(api_key=api_key, base_url=base_url)
        if base_url
        else AsyncOpenAI(api_key=api_key)
    )
    # Only send a temperature the preset sets: some models accept just their
    # default and reject any other value with a 400.
    params: dict = {"model": model, "messages": messages}
    configured = getattr(llm, "temperature", None)
    if configured is not None:
        params["temperature"] = float(configured)

    started = time.monotonic()
    try:
        # Models that only take their default temperature are handled by the helper.
        resp = await create_chat_completion(client, **params)
    except Exception as e:  # openai errors are broad; never crash the request
        logger.error(f"Chat LLM call failed for agent {agent.id}: {e}")
        return ChatReplyFailure("model_error", str(e), model)

    text = (resp.choices[0].message.content or "").strip()
    if not text:
        return ChatReplyFailure("empty_reply", "The model returned an empty reply.", model)
    usage = getattr(resp, "usage", None)
    return ChatReply(
        text=text,
        model=model,
        latency_ms=round((time.monotonic() - started) * 1000),
        prompt_tokens=getattr(usage, "prompt_tokens", None),
        completion_tokens=getattr(usage, "completion_tokens", None),
    )
