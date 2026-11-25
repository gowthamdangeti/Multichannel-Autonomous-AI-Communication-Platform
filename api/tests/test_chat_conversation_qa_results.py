"""An evaluation is not visitor activity: saving it must not move ``updated_at``.

``updated_at`` is chat's only activity time — conversation duration, status and
the idle window that completes a session all read it. Saving ``qa_results``
used to bump it, so merely viewing (or re-evaluating) a conversation inflated
its own duration and kept it "in progress".
"""

from datetime import datetime, timedelta, timezone

import pytest

from api.db import db_client
from api.db.models import ChatAgentModel, ChatConversationModel, OrganizationModel

TS = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)


async def _conversation(session) -> ChatConversationModel:
    organization = OrganizationModel(provider_id="org_updated_at_test")
    session.add(organization)
    await session.flush()

    agent = ChatAgentModel(
        organization_id=organization.id, name="Agent", public_key="chat_updated_at_test"
    )
    session.add(agent)
    await session.flush()

    conversation = ChatConversationModel(
        organization_id=organization.id,
        chat_agent_id=agent.id,
        session_token="token-updated-at",
        messages=[{"role": "user", "content": "hi"}],
        created_at=TS,
        updated_at=TS,
    )
    session.add(conversation)
    await session.flush()
    return conversation


@pytest.mark.asyncio
async def test_saving_qa_results_keeps_the_last_message_time(db_session, async_session):
    conversation = await _conversation(async_session)
    await async_session.commit()
    original = conversation.updated_at

    await db_client.set_chat_qa_results(
        conversation.id, conversation.organization_id, {"score": 95, "verdict": "completed"}
    )

    stored = await db_client.get_chat_conversation(
        conversation.id, conversation.organization_id
    )
    assert stored.qa_results == {"score": 95, "verdict": "completed"}
    assert stored.updated_at == original
    # And the activity window that reads it is unaffected.
    assert stored.updated_at - timedelta(seconds=60) < stored.updated_at
