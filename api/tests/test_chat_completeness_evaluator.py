"""Chat completeness: the judge reads the agent prompt + transcript; fallbacks are honest."""

import os
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

import pytest  # noqa: E402

from api.services.chat import completeness_evaluator as ev  # noqa: E402

AGENT = SimpleNamespace(
    id=1, organization_id=1, system_prompt="Collect the visitor's email.", greeting="Hi!", model_config_ref={}
)
CHAT = [
    {"role": "assistant", "content": "Hi!"},
    {"role": "user", "content": "I need pricing"},
    {"role": "assistant", "content": "Sure. What's your email?"},
    {"role": "user", "content": "a@b.co"},
    {"role": "assistant", "content": "Thanks, bye!"},
]


def test_format_transcript_labels_visitor_and_agent():
    text = ev.format_transcript(CHAT)
    assert text.startswith("[1] agent: Hi!")
    assert "[2] visitor: I need pricing" in text


def test_clamp_bounds_score_verdict_and_goal_status():
    out = ev.clamp_judgement(
        {"score": 250, "verdict": "bogus", "goals": [{"label": "Email", "status": "weird"}]},
        None, "m", None,
    )
    assert out["score"] == 100 and out["verdict"] == "properly_completed"
    assert out["goals"][0]["status"] == "missed"
    assert out["missing"] == ["Email"]


def test_disconnected_visitor_cannot_be_properly_completed():
    out = ev.clamp_judgement({"score": 95, "verdict": "properly_completed"}, "disconnected", "m", None)
    assert out["verdict"] == "partially_completed" and out["score"] == 84


def test_transcript_only_result_is_labelled_and_has_no_goals():
    out = ev.build_transcript_only_result(CHAT, None, "No model.")
    assert out["verdict"] == "properly_completed" and out["goals"] == []
    assert "transcript only" in out["reason"]
    assert "token_usage" not in out


def test_no_visitor_message_is_aborted():
    out = ev.build_transcript_only_result([{"role": "assistant", "content": "Hi!"}], None, "x")
    assert out["verdict"] == "aborted" and out["score"] == 0


@pytest.mark.asyncio
async def test_judge_uses_agent_prompt_and_records_real_usage():
    resp = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content='{"score": 90, "verdict": "properly_completed", "goals": [{"key": "email", "label": "Capture email", "status": "met", "evidence": "a@b.co"}], "reason": "ok"}'))],
        usage=SimpleNamespace(prompt_tokens=100, completion_tokens=20, total_tokens=120),
    )
    client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=AsyncMock(return_value=resp))))
    with (
        patch.object(ev, "get_effective_ai_model_configuration_for_workflow", AsyncMock(return_value=SimpleNamespace(llm=object()))),
        patch.object(ev, "openai_params", return_value=(None, "gpt-x", "key")),
        patch.object(ev, "AsyncOpenAI", return_value=client),
    ):
        out = await ev.evaluate_chat_completeness(AGENT, CHAT, "completed")
    sent = client.chat.completions.create.await_args.kwargs["messages"][1]["content"]
    assert "Collect the visitor's email." in sent and "## SESSION\ncompleted" in sent
    assert out["model"] == "gpt-x" and out["verdict"] == "properly_completed"
    assert out["token_usage"]["prompt_tokens"] == 100
    assert out["goals"][0]["label"] == "Capture email"
