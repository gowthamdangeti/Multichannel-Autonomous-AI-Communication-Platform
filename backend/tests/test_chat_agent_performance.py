"""The chat radar scores only what was measured; everything else stays unmeasured."""

from api.db.chat_agent_overview_client import (
    BAND_GREETING_ONLY,
    BAND_LONG,
    BAND_ONE,
    BAND_SHORT,
)
from api.schemas.chat_agent_overview import ChatConversationGroup, ChatReplyUsage
from api.services.reports.chat_agent_performance import build_chat_agent_performance


def _group(band, conversations=1):
    return ChatConversationGroup(
        chat_agent_id=1,
        day="2026-11-06",
        origin="https://shop.com",
        length_band=band,
        conversations=conversations,
        messages=4,
        visitor_messages=2,
        last_activity_at=None,
    )


def _usage(**overrides):
    return ChatReplyUsage(
        **{
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "replies": 0,
            "replies_with_usage": 0,
            "replies_with_latency": 0,
            "fast_replies": 0,
            "conversations_with_usage": 0,
            "avg_latency_ms": None,
            **overrides,
        }
    )


def test_axes_are_shares_of_what_was_measured():
    groups = [
        _group(BAND_GREETING_ONLY, 4),  # visitor never replied
        _group(BAND_ONE, 2),
        _group(BAND_SHORT, 1),
        _group(BAND_LONG, 1),
    ]

    performance = build_chat_agent_performance(groups, _usage(replies_with_latency=4, fast_replies=3))
    by_key = {metric.key: metric for metric in performance.metrics}

    assert (by_key["engagement"].score, by_key["engagement"].sample) == (50, 8)
    assert (by_key["depth"].score, by_key["depth"].sample) == (25, 8)
    assert (by_key["reply_speed"].score, by_key["reply_speed"].sample) == (75, 4)
    assert performance.overall == 50


def test_nothing_measured_reports_no_score_rather_than_zero():
    performance = build_chat_agent_performance([], _usage())

    assert [metric.score for metric in performance.metrics] == [None, None, None]
    assert [metric.sample for metric in performance.metrics] == [0, 0, 0]
    assert performance.overall is None