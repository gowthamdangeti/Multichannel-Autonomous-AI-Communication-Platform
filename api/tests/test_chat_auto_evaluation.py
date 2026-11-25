"""Chat auto-evaluation: runs once per finished conversation, never over an existing one."""

import os
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

import pytest  # noqa: E402

from api.services.chat import auto_evaluation as ae  # noqa: E402

AGENT = SimpleNamespace(id=1, organization_id=1, name="Support")
RESULT = {"score": 90, "verdict": "properly_completed"}


def _convo(qa=None, title=None, end_reason="completed"):
    return SimpleNamespace(
        id=7,
        organization_id=1,
        chat_agent_id=1,
        messages=[{"role": "user", "content": "hi"}],
        qa_results=qa,
        conversation_title=title,
        end_reason=end_reason,
    )


@pytest.mark.asyncio
async def test_evaluates_and_saves_a_finished_conversation():
    save = AsyncMock()
    with (
        patch.multiple(
            ae.db_client,
            get_chat_conversation=AsyncMock(return_value=_convo()),
            get_chat_agent=AsyncMock(return_value=AGENT),
            set_chat_qa_results=save,
        ),
        patch.object(ae, "evaluate_chat_completeness", AsyncMock(return_value=RESULT)) as judge,
    ):
        assert await ae.evaluate_chat_conversation(7, 1) is True
    judge.assert_awaited_once()
    assert judge.await_args.args[2] == "completed"  # the end reason reaches the judge
    save.assert_awaited_once_with(7, 1, RESULT)


@pytest.mark.asyncio
async def test_existing_evaluation_is_not_replaced():
    save = AsyncMock()
    with (
        patch.multiple(
            ae.db_client,
            get_chat_conversation=AsyncMock(return_value=_convo(qa={"score": 40})),
            set_chat_qa_results=save,
        ),
        patch.object(ae, "evaluate_chat_completeness", AsyncMock()) as judge,
    ):
        assert await ae.evaluate_chat_conversation(7, 1) is False
    judge.assert_not_awaited()
    save.assert_not_awaited()


@pytest.mark.asyncio
async def test_finish_jobs_queue_only_what_is_missing():
    with (
        patch.object(ae, "queue_chat_title_generation", AsyncMock()) as title,
        patch.object(ae, "queue_chat_evaluation", AsyncMock()) as evaluation,
    ):
        await ae.queue_chat_finish_jobs(_convo(qa={"score": 80}, title=None))
        await ae.queue_chat_finish_jobs(_convo(qa=None, title="Support_embed_7"))
    title.assert_awaited_once_with(7, 1)
    evaluation.assert_awaited_once_with(7, 1)


@pytest.mark.asyncio
async def test_sweep_queues_each_finished_conversation():
    rows = [_convo(), _convo(title="t")]
    with (
        patch.object(ae.db_client, "list_chat_conversations_to_finish", AsyncMock(return_value=rows)) as listing,
        patch.object(ae, "queue_chat_finish_jobs", AsyncMock()) as finish,
    ):
        assert await ae.sweep_finished_chats({}) == {"queued": 2}
    assert finish.await_count == 2
    kwargs = listing.await_args.kwargs
    assert kwargs["limit"] == ae.SWEEP_BATCH and kwargs["finished_before"] > kwargs["created_after"]
