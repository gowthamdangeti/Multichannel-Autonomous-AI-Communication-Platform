"""Widget reply actions: ratings stick to the right reply; retry keeps the old reply's cost."""

import os
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

import pytest  # noqa: E402

from api.services.chat import message_actions as ma  # noqa: E402
from api.services.chat.reply import ChatReply, ChatReplyFailure  # noqa: E402
from api.services.chat.transcript import live_messages  # noqa: E402

AGENT = SimpleNamespace(id=1, organization_id=1)


def _convo(messages, end_reason=None):
    return SimpleNamespace(session_token="tok", messages=messages, end_reason=end_reason)


def _chat():
    return [
        {"role": "assistant", "content": "Hi!"},
        {"role": "user", "content": "Price?"},
        {"role": "assistant", "content": "It is $10.", "prompt_tokens": 50, "completion_tokens": 5},
    ]


@pytest.mark.asyncio
async def test_rating_sets_and_clears_feedback_on_that_reply_only():
    save = AsyncMock()
    with patch.object(ma.db_client, "replace_chat_transcript", save):
        rated = await ma.rate_reply(_convo(_chat()), 2, "like")
        assert rated[2]["feedback"] == "like" and "feedback" not in rated[0]
        assert save.await_args.kwargs["keep_activity_time"] is True
        cleared = await ma.rate_reply(_convo(rated), 2, None)
        assert "feedback" not in cleared[2]


@pytest.mark.asyncio
@pytest.mark.parametrize("index,value", [(1, "like"), (9, "like"), (2, "love")])
async def test_rating_rejects_visitor_messages_bad_indexes_and_values(index, value):
    with patch.object(ma.db_client, "replace_chat_transcript", AsyncMock()), pytest.raises(ma.ChatActionError):
        await ma.rate_reply(_convo(_chat()), index, value)


@pytest.mark.asyncio
async def test_retry_keeps_the_old_reply_for_cost_and_hides_it_from_the_dialogue():
    new = ChatReply(text="It costs $10 a month.", model="m", latency_ms=5, prompt_tokens=60, completion_tokens=7)
    save = AsyncMock()
    with (
        patch.object(ma, "generate_chat_reply", AsyncMock(return_value=new)) as gen,
        patch.object(ma.db_client, "replace_chat_transcript", save),
    ):
        out = await ma.retry_last_reply(AGENT, _convo(_chat()))
    # The model is asked about the visitor's latest message, with only the earlier dialogue as history.
    assert gen.await_args.args[2] == "Price?"
    assert [m["content"] for m in gen.await_args.args[1]] == ["Hi!"]
    assert out[2]["superseded"] is True and out[2]["prompt_tokens"] == 50  # cost kept
    assert [m["content"] for m in live_messages(out)] == ["Hi!", "Price?", "It costs $10 a month."]
    assert save.await_args.kwargs["last_error"] is None


@pytest.mark.asyncio
async def test_failed_retry_changes_nothing():
    save = AsyncMock()
    with (
        patch.object(ma, "generate_chat_reply", AsyncMock(return_value=ChatReplyFailure("model_error", "x"))),
        patch.object(ma.db_client, "replace_chat_transcript", save),
        pytest.raises(ma.ChatActionError) as err,
    ):
        await ma.retry_last_reply(AGENT, _convo(_chat()))
    assert err.value.status_code == 502
    save.assert_not_awaited()


@pytest.mark.asyncio
async def test_retry_refused_after_exit():
    with pytest.raises(ma.ChatActionError) as err:
        await ma.retry_last_reply(AGENT, _convo(_chat(), end_reason="completed"))
    assert err.value.status_code == 409
