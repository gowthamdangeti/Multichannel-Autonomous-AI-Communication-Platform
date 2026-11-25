"""Conversation totals come only from what the provider reported."""

from datetime import datetime, timedelta, timezone

from api.services.chat.conversation_stats import summarize_conversation

START = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)


def test_sums_only_replies_that_reported_usage():
    messages = [
        {"role": "assistant", "content": "hi"},  # greeting: no usage
        {"role": "user", "content": "q"},
        {"role": "assistant", "content": "a", "prompt_tokens": 100, "completion_tokens": 20},
        {"role": "user", "content": "q2"},
        {"role": "assistant", "content": "b", "prompt_tokens": 150, "completion_tokens": 30},
    ]
    stats = summarize_conversation(messages, START, START + timedelta(seconds=90))
    assert (stats.prompt_tokens, stats.completion_tokens, stats.total_tokens) == (250, 50, 300)
    assert stats.duration_seconds == 90


def test_no_reported_usage_is_none_not_zero():
    messages = [{"role": "assistant", "content": "hi"}, {"role": "user", "content": "q"}]
    stats = summarize_conversation(messages, START, START)
    assert stats.total_tokens is None
    assert stats.prompt_tokens is None
    assert stats.duration_seconds == 0


def test_missing_timestamps_have_no_duration():
    stats = summarize_conversation([], None, START)
    assert stats.duration_seconds is None


def test_negative_span_is_clamped():
    stats = summarize_conversation([], START, START - timedelta(seconds=5))
    assert stats.duration_seconds == 0


from api.services.chat.conversation_stats import conversation_status  # noqa: E402


def test_status_error_wins_over_recency():
    err = {"reason": "model_error", "message": "boom"}
    assert conversation_status(err, START, now=START) == "error"


def test_status_in_progress_then_disconnected_by_recency():
    assert conversation_status(None, START, now=START + timedelta(minutes=5)) == "in_progress"
    assert conversation_status(None, START, now=START + timedelta(minutes=31)) == "disconnected"
    assert conversation_status(None, None) == "disconnected"


def test_status_explicit_end_wins_over_recency_and_error():
    err = {"reason": "model_error", "message": "boom"}
    soon = START + timedelta(minutes=1)
    assert conversation_status(None, START, "completed", now=soon) == "completed"
    assert conversation_status(None, START, "disconnected", now=soon) == "disconnected"
    assert conversation_status(err, START, "completed", now=soon) == "completed"


from api.services.chat.conversation_stats import gathered_context  # noqa: E402


def _ctx(messages, last_error=None, status="completed"):
    stats = summarize_conversation(messages, START, START + timedelta(seconds=10))
    return gathered_context(messages, last_error, status, stats)


def test_gathered_context_reads_the_transcript_and_omits_absent_values():
    ctx = _ctx([
        {"role": "assistant", "content": "hi"},
        {"role": "user", "content": "q"},
        {"role": "assistant", "content": "a", "model": "gpt-x", "latency_ms": 400, "prompt_tokens": 10, "completion_tokens": 5},
    ])
    assert ctx["disposition"] == "engaged"
    assert (ctx["visitor_messages"], ctx["assistant_messages"]) == (1, 2)
    assert ctx["models_used"] == ["gpt-x"] and ctx["avg_reply_ms"] == 400
    assert "last_error" not in ctx


def test_gathered_context_dispositions():
    assert _ctx([{"role": "assistant", "content": "hi"}])["disposition"] == "no_visitor_message"
    failed = _ctx([{"role": "user", "content": "q"}], {"reason": "model_error"}, "error")
    assert failed["disposition"] == "assistant_error" and failed["last_error"] == "model_error"
    assert "prompt_tokens" not in failed and "models_used" not in failed
