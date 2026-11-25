"""Chat conversation completeness: did the visitor's chat do what the agent was
configured to do?

The judge reads the agent's own prompt (its goals) and the stored transcript,
the chat counterpart of the voice judge in ``api/services/completeness``, and
returns the same result shape (score, verdict, goals, missing, reason) so the
detail page and the agent analytics treat both alike.

Never raises: a failure comes back as a result that is safe to persist. Token
usage is stored only when the provider reported it; nothing is estimated.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Optional

from loguru import logger
from openai import AsyncOpenAI

from api.db.models import ChatAgentModel
from api.services.agents_llm import openai_params
from api.services.chat.completeness_prompts import (
    CHAT_COMPLETENESS_SYSTEM_PROMPT,
    CHAT_COMPLETENESS_VERSION,
    MAX_AGENT_PROMPT_CHARS,
    MAX_TRANSCRIPT_CHARS,
)
from api.services.configuration.ai_model_configuration import (
    get_effective_ai_model_configuration_for_workflow,
)
from api.services.gen_ai.inference_usage import usage_to_dict
from api.services.chat.transcript import live_messages
from api.services.gen_ai.json_parser import parse_llm_json

_VERDICTS = {"properly_completed", "partially_completed", "not_completed", "aborted", "error"}
_GOAL_STATUSES = {"met", "partial", "missed", "na"}
_MAX_GOALS = 8
_CLOSING_WORDS = (
    "thank you", "thanks", "bye", "goodbye", "have a great day", "have a good day",
    "take care", "all set", "you're welcome", "you are welcome", "anything else",
)


def _result(
    score: int,
    verdict: str,
    reason: str,
    *,
    goals: Optional[list[dict]] = None,
    missing: Optional[list[str]] = None,
    model: Optional[str] = None,
    status: str = "ready",
    token_usage: Optional[dict] = None,
) -> dict[str, Any]:
    """The persisted shape; matches the voice completeness result."""
    result: dict[str, Any] = {
        "version": CHAT_COMPLETENESS_VERSION,
        "score": max(0, min(100, score)),
        "verdict": verdict,
        "goals": goals or [],
        "missing": missing or [],
        "reason": reason[:280],
        "model": model,
        "evaluated_at": datetime.now(UTC).isoformat(),
        "status": status,
    }
    if token_usage:
        result["token_usage"] = token_usage
    return result


def format_transcript(messages: list[dict]) -> str:
    """``[n] visitor: ...`` / ``[n] agent: ...`` lines, newest kept when too long."""
    lines = [
        f"[{i}] {'visitor' if m.get('role') == 'user' else 'agent'}: {m.get('content', '')}"
        for i, m in enumerate(live_messages(messages), start=1)
        if m.get("content")
    ]
    text = "\n".join(lines)
    return text if len(text) <= MAX_TRANSCRIPT_CHARS else "...\n" + text[-MAX_TRANSCRIPT_CHARS:]


def _count_turns(messages: list[dict]) -> tuple[int, int]:
    live = live_messages(messages)
    visitor = sum(1 for m in live if m.get("role") == "user")
    agent = sum(1 for m in live if m.get("role") == "assistant")
    return visitor, agent


def build_transcript_only_result(
    messages: list[dict], end_reason: Optional[str], note: str, status: str = "ready"
) -> dict[str, Any]:
    """Score from the transcript alone, used when no model could judge it. The
    reason says so; there are no goals because there is no model reading the prompt."""
    visitor, agent = _count_turns(messages)
    if visitor < 1:
        return _result(0, "aborted", "The visitor never sent a message.", status=status)
    if agent < 1:
        return _result(10, "error", "The agent never replied to the visitor.", status=status)
    text = " ".join(str(m.get("content", "")).lower() for m in live_messages(messages) if m.get("role") == "assistant")
    closed = any(word in text for word in _CLOSING_WORDS)
    if visitor >= 2 and closed and end_reason != "disconnected":
        score, verdict = 85, "properly_completed"
    elif visitor >= 2:
        score, verdict = 55, "partially_completed"
    else:
        score, verdict = 30, "not_completed"
    return _result(score, verdict, f"{note} Scored from the transcript only.", status=status)


def _clamp_goals(raw: Any) -> list[dict]:
    goals: list[dict] = []
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        label = str(item.get("label") or item.get("key") or "").strip()
        if not label:
            continue
        status = str(item.get("status", "missed")).strip().lower()
        evidence = item.get("evidence")
        goals.append(
            {
                "key": str(item.get("key") or label).strip()[:60],
                "label": label[:120],
                "status": status if status in _GOAL_STATUSES else "missed",
                "evidence": str(evidence)[:500] if evidence else None,
            }
        )
    return goals[:_MAX_GOALS]


def clamp_judgement(
    parsed: dict, end_reason: Optional[str], model: Optional[str], token_usage: Optional[dict]
) -> dict[str, Any]:
    """Bound the judge's JSON to the allowed verdicts, statuses and score range."""
    try:
        score = max(0, min(100, int(parsed.get("score", 0))))
    except (TypeError, ValueError):
        score = 0
    verdict = str(parsed.get("verdict", "")).strip().lower()
    if verdict not in _VERDICTS:
        verdict = (
            "properly_completed" if score >= 85 else "partially_completed" if score >= 40 else "not_completed"
        )
    # A visitor who dropped off cannot have properly completed the chat.
    if end_reason == "disconnected" and verdict == "properly_completed":
        verdict, score = "partially_completed", min(score, 84)

    goals = _clamp_goals(parsed.get("goals"))
    missing_raw = parsed.get("missing")
    missing = [str(m)[:200] for m in missing_raw if str(m).strip()] if isinstance(missing_raw, list) else []
    if not missing:
        missing = [g["label"] for g in goals if g["status"] == "missed"]
    reason = str(parsed.get("reason") or "").strip() or f"{verdict.replace('_', ' ')}: {score}% complete."
    return _result(
        score, verdict, reason, goals=goals, missing=missing, model=model, token_usage=token_usage
    )


def _build_payload(agent: ChatAgentModel, messages: list[dict], end_reason: Optional[str]) -> str:
    prompt = (agent.system_prompt or "").strip()[:MAX_AGENT_PROMPT_CHARS] or "(no prompt configured)"
    greeting = (agent.greeting or "").strip() or "(none)"
    return (
        f"## AGENT_PROMPT\n{prompt}\n\n## GREETING\n{greeting}\n\n"
        f"## SESSION\n{end_reason or 'open'}\n\n## TRANSCRIPT\n{format_transcript(messages)}"
    )


async def evaluate_chat_completeness(
    agent: ChatAgentModel, messages: list[dict], end_reason: Optional[str] = None
) -> dict[str, Any]:
    """Judge a chat conversation against its agent's prompt. Never raises."""
    visitor, agent_turns = _count_turns(messages)
    if visitor < 1 or agent_turns < 1:
        return build_transcript_only_result(messages, end_reason, "Not enough conversation to judge.")

    try:
        effective = await get_effective_ai_model_configuration_for_workflow(
            user_id=None,
            organization_id=agent.organization_id,
            workflow_configurations=agent.model_config_ref or {},
        )
    except Exception as e:
        logger.warning(f"Chat completeness: model config failed for agent {agent.id}: {e}")
        return build_transcript_only_result(messages, end_reason, "No model configuration.", "failed")
    if effective.llm is None:
        return build_transcript_only_result(messages, end_reason, "No language model is configured.")
    base_url, model, api_key = openai_params(effective.llm)
    if not api_key:
        return build_transcript_only_result(messages, end_reason, "The model configuration has no API key.")

    client = AsyncOpenAI(api_key=api_key, base_url=base_url) if base_url else AsyncOpenAI(api_key=api_key)
    try:
        resp = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": CHAT_COMPLETENESS_SYSTEM_PROMPT},
                {"role": "user", "content": _build_payload(agent, messages, end_reason)},
            ],
        )
    except Exception as e:  # provider errors are broad; the caller must not crash
        logger.warning(f"Chat completeness LLM call failed for agent {agent.id}: {e}")
        return build_transcript_only_result(messages, end_reason, "The judging model failed.", "failed")

    token_usage = usage_to_dict(getattr(resp, "usage", None))
    parsed = parse_llm_json((resp.choices[0].message.content or "") if resp.choices else "")
    if not isinstance(parsed, dict) or "score" not in parsed:
        fallback = build_transcript_only_result(
            messages, end_reason, "The judging model did not return a valid result.", "failed"
        )
        fallback.update(model=model, **({"token_usage": token_usage} if token_usage else {}))
        return fallback
    return clamp_judgement(parsed, end_reason, model, token_usage)
