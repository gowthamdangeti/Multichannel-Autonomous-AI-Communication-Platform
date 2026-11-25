"""Chat agent Resolution: scores and verdicts only from evaluated conversations."""

import os
import sys
from datetime import UTC, datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from api.services.reports.chat_agent_resolution import summarize_resolution  # noqa: E402

NOW = datetime(2026, 11, 17, 12, 0, tzinfo=UTC)


def _row(end=None, error=False, score=None, verdict=None, age_min=5):
    return {
        "end_reason": end,
        "has_error": error,
        "updated_at": NOW - timedelta(minutes=age_min),
        "score": score,
        "verdict": verdict,
    }


def test_scores_and_verdicts_count_only_evaluated_conversations():
    out = summarize_resolution(
        [
            _row("completed", score="90", verdict="properly_completed"),
            _row("disconnected", score="50", verdict="partially_completed"),
            _row(None),
        ],
        now=NOW,
    )
    assert out.avg_score == 70 and out.evaluated == 2 and out.conversations == 3
    assert {v.name: v.count for v in out.verdicts} == {
        "properly_completed": 1,
        "partially_completed": 1,
    }


def test_outcomes_follow_conversation_status():
    out = summarize_resolution(
        [
            _row("completed"),
            _row("disconnected"),
            _row(None, age_min=5),
            _row(None, age_min=90),
            _row(None, error=True),
        ],
        now=NOW,
    )
    assert {o.name: o.count for o in out.outcomes} == {
        "completed": 1,
        "disconnected": 2,
        "in_progress": 1,
        "error": 1,
    }


def test_no_evaluations_means_no_score_not_zero():
    out = summarize_resolution([_row("completed")], now=NOW)
    assert out.avg_score is None and out.evaluated == 0 and out.verdicts == []
