"""Per-conversation totals read straight from the stored messages.

Nothing here is estimated: tokens are summed only over replies where the
provider reported usage, and a conversation with no reported usage has no
token total (None), never zero.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Iterable, Optional


# The widget reports how a session ends. A session that never reported an end
# (a crashed browser, a lost beacon) is in progress while its last message is
# this recent, and disconnected after.
ACTIVE_WINDOW = timedelta(minutes=30)

STATUS_ERROR = "error"
STATUS_IN_PROGRESS = "in_progress"
STATUS_COMPLETED = "completed"
STATUS_DISCONNECTED = "disconnected"

END_REASONS = (STATUS_COMPLETED, STATUS_DISCONNECTED)


def conversation_status(
    last_error: Optional[dict],
    updated_at: Optional[datetime],
    end_reason: Optional[str] = None,
    now: Optional[datetime] = None,
) -> str:
    """The visitor's explicit end wins; then error; otherwise in progress or
    disconnected by recency."""
    if end_reason in END_REASONS:
        return end_reason
    if last_error:
        return STATUS_ERROR
    if updated_at is None:
        return STATUS_DISCONNECTED
    now = now or datetime.now(UTC)
    if updated_at.tzinfo is None:
        updated_at = updated_at.replace(tzinfo=UTC)
    return STATUS_IN_PROGRESS if now - updated_at < ACTIVE_WINDOW else STATUS_DISCONNECTED


def gathered_context(
    messages: Iterable[Any],
    last_error: Optional[dict],
    status: str,
    stats: "ConversationStats",
) -> dict:
    """What the session produced, read from the stored transcript (the chat
    analog of the voice run's gathered context). Absent values are omitted."""
    messages = [m for m in messages if isinstance(m, dict)]
    visitor = [m for m in messages if m.get("role") == "user"]
    bot = [m for m in messages if m.get("role") == "assistant"]
    models = sorted({m["model"] for m in bot if m.get("model")})
    latencies = [m["latency_ms"] for m in bot if isinstance(m.get("latency_ms"), int)]

    if last_error:
        disposition = "assistant_error"
    elif not visitor:
        disposition = "no_visitor_message"
    else:
        disposition = "engaged"

    context: dict = {
        "conversation_status": status,
        "disposition": disposition,
        "visitor_messages": len(visitor),
        "assistant_messages": len(bot),
        "models_used": models,
        "prompt_tokens": stats.prompt_tokens,
        "completion_tokens": stats.completion_tokens,
        "avg_reply_ms": round(sum(latencies) / len(latencies)) if latencies else None,
        "last_error": last_error["reason"] if last_error else None,
    }
    return {k: v for k, v in context.items() if v is not None and v != []}


@dataclass(frozen=True)
class ConversationStats:
    prompt_tokens: Optional[int]
    completion_tokens: Optional[int]
    total_tokens: Optional[int]
    duration_seconds: Optional[float]


def _sum_reported(messages: Iterable[Any], field: str) -> Optional[int]:
    values = [
        m[field]
        for m in messages
        if isinstance(m, dict) and isinstance(m.get(field), int) and not isinstance(m.get(field), bool)
    ]
    return sum(values) if values else None


def summarize_conversation(
    messages: Iterable[Any],
    created_at: Optional[datetime],
    updated_at: Optional[datetime],
) -> ConversationStats:
    messages = list(messages)
    prompt = _sum_reported(messages, "prompt_tokens")
    completion = _sum_reported(messages, "completion_tokens")
    total = None if prompt is None and completion is None else (prompt or 0) + (completion or 0)

    duration = None
    if created_at is not None and updated_at is not None:
        duration = max((updated_at - created_at).total_seconds(), 0.0)

    return ConversationStats(
        prompt_tokens=prompt,
        completion_tokens=completion,
        total_tokens=total,
        duration_seconds=duration,
    )
