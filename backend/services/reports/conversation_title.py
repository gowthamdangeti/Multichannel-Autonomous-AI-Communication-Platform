"""Conversation title generation — short display title per run.

Format: {AgentShort}_{PersonOrId} or {AgentShort}_{PersonOrId}_{OrderOrUserId}
e.g. AurubindoPharma_RameshKumar_ORD-88231

Pure logic + one bounded LLM call. No DB access here so routes,
ARQ tasks and MCP tools can all reuse it. Quota errors propagate
so callers can fall back without burning further passes.
"""

from __future__ import annotations

import re
from typing import Any, Optional

from loguru import logger
from openai import AsyncOpenAI

from api.services.gen_ai.json_parser import parse_llm_json
from api.services.reports.extraction import _is_quota_error
from api.services.workflow.usage_contract import cached_prompt_tokens
from api.services.gen_ai.temperature import create_chat_completion

MAX_TITLE_LEN = 80
TRANSCRIPT_CHAR_BUDGET = 4000

CONVERSATION_TITLE_SYSTEM_PROMPT = (
    "You generate short conversation titles for display in a call list. "
    "Return ONLY one valid JSON object like {\"conversation_title\": \"...\"}. "
    "No markdown fences, no commentary.\n\n"
    "Format:\n"
    "- {AgentShort}_{PersonOrId} or {AgentShort}_{PersonOrId}_{OrderOrUserId}\n"
    "- AgentShort: derived from the Agent Name, PascalCase, no spaces, max 20 chars.\n"
    "- PersonOrId: person name, username, user_id or order id explicitly stated "
    "in the transcript. Preserve capitalization, join multi-word names without spaces.\n"
    "- Optional third segment: order id, user id or ticket id when present.\n\n"
    "Grounding:\n"
    "- Use ONLY entities explicitly spoken in the transcript. Do not invent names or ids.\n"
    "- Never include full phone numbers, OTPs, Aadhaar, addresses. Phone hint may "
    "only contribute last-4 digits.\n"
    "- Max 3 underscore-joined segments, max 80 chars total, charset [A-Za-z0-9_-].\n"
    "- If no person/id entity is found, return {\"conversation_title\": null}."
)


def _agent_short(workflow_name: Optional[str]) -> str:
    if not workflow_name:
        return "Agent"
    # Keep alphanumerics, PascalCase-ish: split on non-alnum, capitalize each.
    parts = re.findall(r"[A-Za-z0-9]+", workflow_name)
    short = "".join(p[:1].upper() + p[1:] for p in parts)
    short = re.sub(r"[^A-Za-z0-9]", "", short)[:20]
    return short or "Agent"


def _mask_long_digits(value: str) -> str:
    """Keep only last-4 of any digit run >= 7 (phone / id leak guard)."""

    def _repl(m: re.Match) -> str:
        digits = re.sub(r"\D", "", m.group(0))
        return digits[-4:] if len(digits) >= 7 else m.group(0)

    return re.sub(r"[\d+\- ]{7,}", _repl, value)


def sanitize_conversation_title(value: Any) -> Optional[str]:
    """Sanitize an LLM/fallback title. Returns None when unusable."""
    if not isinstance(value, str):
        return None
    title = value.strip().strip("_-")
    if not title or title.lower() in ("null", "none", "n/a"):
        return None
    title = _mask_long_digits(title)
    title = title.replace(" ", "_")
    title = re.sub(r"[^A-Za-z0-9_@-]", "", title)
    title = re.sub(r"_+", "_", title).strip("_-")[:MAX_TITLE_LEN]
    if len(title) < 3:
        return None
    return title


def is_embed_run_name(run_name: Any) -> bool:
    """Voice embed runs are created as `Embed Run - <timestamp>` (public_embed)."""
    return isinstance(run_name, str) and run_name.strip().lower().startswith("embed run")


def build_fallback_title(
    workflow_name: Optional[str],
    run_id: Optional[int] = None,
    run_name: Optional[str] = None,
    caller_number: Optional[str] = None,
) -> str:
    """Deterministic title, no LLM. Never returns None/empty.

    Natural format: `{workflow_name} {run_name}` (e.g.
    "Aurubindo Pharma Case study WR-2217"). Embed runs
    (`Embed Run - ...`) get `{workflow_name}_embed`. Truncated to the
    120-char `workflow_runs.conversation_title` column limit.
    """
    wname = workflow_name.strip() if isinstance(workflow_name, str) and workflow_name.strip() else ""
    rname = run_name.strip() if isinstance(run_name, str) and run_name.strip() else ""

    if wname and is_embed_run_name(rname):
        return f"{wname}_embed"[:120]
    if wname and rname and not is_embed_run_name(rname):
        return f"{wname} {rname}"[:120]
    if wname:
        return wname[:120]
    if rname and not is_embed_run_name(rname):
        return rname[:120]
    if run_id is not None:
        return f"Conversation {run_id}"[:120]
    return "Conversation"


def transcript_to_budgeted_text(messages: list[dict], budget: int = TRANSCRIPT_CHAR_BUDGET) -> str:
    lines = []
    for m in messages or []:
        if not isinstance(m, dict):
            continue
        role = m.get("role", "unknown")
        text = str(m.get("message", "")).strip()
        if text:
            lines.append(f"{role}: {text}")
    full = "\n".join(lines)
    if len(full) <= budget:
        return full
    # Keep head (greeting/identity) + tail (order/confirm) when truncating.
    head = full[: budget * 2 // 3]
    tail = full[-(budget // 3) :]
    return head + "\n...[truncated]...\n" + tail


async def generate_conversation_title_llm(
    transcript_messages: list[dict],
    workflow_name: Optional[str],
    llm_config: Optional[dict],
    caller_number: Optional[str] = None,
    called_number: Optional[str] = None,
    usage_out: Optional[dict[str, Any]] = None,
) -> Optional[str]:
    """One bounded LLM call; optionally captures provider usage metadata."""
    real_turns = [
        m for m in (transcript_messages or [])
        if isinstance(m, dict) and str(m.get("message", "")).strip()
        and m.get("message") != "No transcript available."
    ]
    if len(real_turns) < 2 or not llm_config or not llm_config.get("api_key"):
        return None

    transcript_text = transcript_to_budgeted_text(real_turns)
    if not transcript_text.strip():
        return None

    client = AsyncOpenAI(
        api_key=llm_config.get("api_key"),
        base_url=llm_config.get("base_url"),
    )
    model = llm_config.get("model", "gpt-4o-mini")
    user_prompt = (
        f"Agent Name: {workflow_name or 'Agent'}\n"
        f"Hints: caller_last4={(re.sub(r'\\D', '', str(caller_number or ''))[-4:] or 'n/a')} "
        f"called_last4={(re.sub(r'\\D', '', str(called_number or ''))[-4:] or 'n/a')}\n\n"
        f"Transcript:\n{transcript_text}\n\n"
        "Return ONLY the JSON object."
    )
    try:
        kwargs: dict[str, Any] = dict(
            model=model,
            messages=[
                {"role": "system", "content": CONVERSATION_TITLE_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0,
        )
        try:
            kwargs["response_format"] = {"type": "json_object"}
            response = await create_chat_completion(client, **kwargs)
        except Exception as e:
            if _is_quota_error(e):
                raise
            kwargs.pop("response_format", None)
            response = await create_chat_completion(client, **kwargs)
    except Exception as e:
        if _is_quota_error(e):
            logger.error(f"Conversation title aborted: LLM quota hit: {e}")
            raise
        logger.error(f"Conversation title LLM call failed: {e}")
        return None

    content = response.choices[0].message.content if response.choices else None
    if not content:
        return None
    if usage_out is not None:
        response_usage = getattr(response, "usage", None)
        usage_out.update({
            "prompt_tokens": getattr(response_usage, "prompt_tokens", 0) or 0,
            "completion_tokens": getattr(response_usage, "completion_tokens", 0) or 0,
            "total_tokens": getattr(response_usage, "total_tokens", 0) or 0,
            "cache_read_input_tokens": cached_prompt_tokens(response_usage),
            "cache_creation_input_tokens": int(
                getattr(response_usage, "cache_creation_input_tokens", 0) or 0
            ),
        })
    parsed = parse_llm_json(content)
    if not isinstance(parsed, dict) or "raw" in parsed:
        return None
    return sanitize_conversation_title(parsed.get("conversation_title"))


__all__ = [
    "MAX_TITLE_LEN",
    "CONVERSATION_TITLE_SYSTEM_PROMPT",
    "_agent_short",
    "sanitize_conversation_title",
    "build_fallback_title",
    "is_embed_run_name",
    "transcript_to_budgeted_text",
    "generate_conversation_title_llm",
]
