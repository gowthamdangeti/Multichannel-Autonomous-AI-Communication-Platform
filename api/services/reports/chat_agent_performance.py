"""Score a chat agent on the axes of its performance radar.

A chat reply stores what the provider reported (model, latency, tokens) and a
conversation stores the visitor's messages, so every axis below is a share of
something that was actually measured. An axis with nothing measured reports
``score=None`` with a sample of 0 — the UI lists it as unmeasured instead of
drawing a fabricated zero.

The axes:
- ``engagement``: conversations in which the visitor sent at least one message,
  rather than closing the widget on the greeting.
- ``depth``: conversations in which the visitor sent two or more messages.
- ``reply_speed``: replies the provider answered within ``SPEED_TARGET_MS``.
"""

from __future__ import annotations

from dataclasses import dataclass

from api.db.chat_agent_overview_client import BAND_GREETING_ONLY, BAND_LONG, BAND_SHORT
from api.schemas.chat_agent_overview import (
    ChatConversationGroup,
    ChatPerformance,
    ChatPerformanceMetric,
    ChatReplyUsage,
)

# No reply target is configured anywhere for the chat widget, so this is the
# line "fast enough" is drawn at (the voice radar draws its own at 3s).
SPEED_TARGET_MS = 3_000

# Bands whose visitor kept the conversation going past a single question.
DEEP_BANDS = frozenset({BAND_SHORT, BAND_LONG})


@dataclass
class _Share:
    """How many of the measured things cleared the bar."""

    good: int = 0
    total: int = 0

    @property
    def score(self) -> int | None:
        return round(self.good / self.total * 100) if self.total else None


def build_chat_agent_performance(
    groups: list[ChatConversationGroup], usage: ChatReplyUsage
) -> ChatPerformance:
    """The radar for one agent over the window the groups and usage cover."""
    conversations = sum(group.conversations for group in groups)
    shares = [
        (
            "engagement",
            _Share(
                good=sum(
                    group.conversations
                    for group in groups
                    if group.length_band != BAND_GREETING_ONLY
                ),
                total=conversations,
            ),
        ),
        (
            "depth",
            _Share(
                good=sum(
                    group.conversations for group in groups if group.length_band in DEEP_BANDS
                ),
                total=conversations,
            ),
        ),
        ("reply_speed", _Share(good=usage.fast_replies, total=usage.replies_with_latency)),
    ]
    metrics = [
        ChatPerformanceMetric(key=key, score=share.score, sample=share.total)
        for key, share in shares
    ]
    scored = [metric.score for metric in metrics if metric.score is not None]
    overall = round(sum(scored) / len(scored)) if scored else None
    return ChatPerformance(overall=overall, metrics=metrics)