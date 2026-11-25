"""How one chat agent's conversations ended and how completely they resolved.

The chat counterpart of the voice agent's Resolution card: the average saved
completeness score, the verdict counts, and the conversation outcomes
(completed, disconnected, in progress, error). Only conversations that have a
saved evaluation count toward the score and verdicts; the rest are reported as
not evaluated, never scored.
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime

from api.db import db_client
from api.schemas.chat_agent_overview import ChatCount, ChatResolution
from api.services.chat.conversation_stats import conversation_status


def _as_score(value: object) -> int | None:
    try:
        return max(0, min(100, round(float(value))))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def summarize_resolution(rows: list[dict], now: datetime | None = None) -> ChatResolution:
    """Fold per-conversation rows into the resolution summary."""
    outcomes: Counter[str] = Counter()
    verdicts: Counter[str] = Counter()
    scores: list[int] = []
    for row in rows:
        error = {"error": True} if row.get("has_error") else None
        outcomes[conversation_status(error, row.get("updated_at"), row.get("end_reason"), now)] += 1
        score = _as_score(row.get("score"))
        if score is not None:
            scores.append(score)
            if row.get("verdict"):
                verdicts[str(row["verdict"])] += 1
    return ChatResolution(
        avg_score=round(sum(scores) / len(scores)) if scores else None,
        evaluated=len(scores),
        conversations=len(rows),
        verdicts=[ChatCount(name=n, count=c) for n, c in verdicts.most_common()],
        outcomes=[ChatCount(name=n, count=c) for n, c in outcomes.most_common()],
    )


async def get_chat_resolution(
    *, organization_id: int, chat_agent_id: int, start: datetime, end: datetime
) -> ChatResolution:
    rows = await db_client.list_chat_resolution_rows(
        organization_id=organization_id, chat_agent_id=chat_agent_id, start=start, end=end
    )
    return summarize_resolution(rows, now=end)
