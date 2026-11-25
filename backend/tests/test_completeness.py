"""Tests for conversation completeness (transcript + gathered + agent goals, no report variables)."""

from types import SimpleNamespace

from api.schemas.workflow import CompletenessResult
from api.services.completeness.builder import (
    build_completeness_input,
    build_deterministic_fallback,
    extract_agent_goals,
)


def _run(logs=None, is_completed=True, gathered=None):
    return SimpleNamespace(
        id=1,
        logs=logs or {"realtime_feedback_events": []},
        gathered_context=gathered or {},
        usage_info={"call_duration_seconds": 60},
        initial_context={},
        is_completed=is_completed,
        workflow=None,
        definition=None,
    )


def _events():
    return [
        {"type": "rtf-user-transcription", "payload": {"text": "Hi, I need help with my bill please", "final": True}, "timestamp": "2026-01-01T00:00:00", "turn": 1},
        {"type": "rtf-bot-text", "payload": {"text": "Hello! Sure, let me check that for you"}, "timestamp": "2026-01-01T00:00:01", "turn": 1},
        {"type": "rtf-user-transcription", "payload": {"text": "Thanks, my account number is 12345", "final": True}, "timestamp": "2026-01-01T00:00:02", "turn": 2},
        {"type": "rtf-bot-text", "payload": {"text": "Got it, all sorted. Goodbye and take care!"}, "timestamp": "2026-01-01T00:00:03", "turn": 2},
    ]


def _definition():
    return {
        "nodes": [
            {
                "id": "n1",
                "type": "agentNode",
                "data": {
                    "name": "Qualify",
                    "prompt": "Ask about the bill issue",
                    "extraction_enabled": True,
                    "extraction_variables": [{"name": "account_no", "type": "string"}],
                },
            }
        ],
        "edges": [{"data": {"label": "done", "condition": "issue understood"}}],
    }


def test_extract_goals_has_no_report_variables():
    configs = {"report_variables": [{"name": "email", "description": "caller email"}]}
    gathered = {"extracted_variables": {"account_no": "1"}, "report_variables": {"email": "a"}}
    goals = extract_agent_goals(_definition(), configs, gathered)
    keys = {g["key"] for g in goals}
    assert "email" not in keys
    assert not any("Report:" in g.get("label", "") for g in goals)
    assert "account_no" in keys
    assert any(k.startswith("node:") for k in keys)
    assert any(k.startswith("flow:") for k in keys)


def test_input_has_no_report_variables():
    run = _run(
        logs={"realtime_feedback_events": _events()},
        gathered={
            "extracted_variables": {"account_no": "12345"},
            "report_variables": {"email": "a@b.com"},
        },
    )
    bundle = build_completeness_input(run, _definition(), {})
    assert "report_variables" not in bundle["runtime"]["gathered"]
    assert "a@b.com" not in str(bundle)
    assert bundle["runtime"]["filled_count"] == 1


def test_fallback_marks_gathered_goals_met():
    run = _run(
        logs={"realtime_feedback_events": _events()},
        gathered={"extracted_variables": {"account_no": "12345"}},
    )
    bundle = build_completeness_input(run, {}, {})
    result = build_deterministic_fallback(bundle)
    validated = CompletenessResult.model_validate(result)
    by_key = {g.key: g.status for g in validated.goals}
    assert by_key.get("account_no") == "met"


def test_deterministic_fallback_full_transcript_scores_high():
    run = _run(
        logs={"realtime_feedback_events": _events()},
        gathered={"extracted_variables": {"account_no": "12345"}},
    )
    bundle = build_completeness_input(run, _definition(), {})
    result = build_deterministic_fallback(bundle)
    validated = CompletenessResult.model_validate(result)
    assert validated.score >= 85
    assert validated.verdict == "properly_completed"


def test_deterministic_fallback_empty_transcript_is_error():
    run = _run(logs={"realtime_feedback_events": []})
    bundle = build_completeness_input(run, {}, {})
    result = build_deterministic_fallback(
        bundle, verdict="error", reason="No transcript captured for this conversation."
    )
    validated = CompletenessResult.model_validate(result)
    assert validated.verdict == "error"
    assert validated.score == 0
