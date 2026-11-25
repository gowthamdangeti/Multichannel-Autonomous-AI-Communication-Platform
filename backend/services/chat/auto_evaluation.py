"""Automatic follow-up work for a finished chat conversation.

Voice evaluates a call's completeness (and titles it) when the call ends; chat
does the same once the visitor's session finishes: when the widget reports an
end, when a finished conversation is opened, and from a periodic sweep that
catches conversations whose end was never reported (the tab crashed, the beacon
was lost). Every step is idempotent, so being queued twice is harmless.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from loguru import logger

from api.db import db_client
from api.services.chat.completeness_evaluator import evaluate_chat_completeness
from api.services.chat.conversation_stats import ACTIVE_WINDOW
from api.services.chat.conversation_title import queue_chat_title_generation

# How far back the sweep looks, and how many conversations it hands off per run.
SWEEP_LOOKBACK = timedelta(days=7)
SWEEP_BATCH = 50


async def evaluate_chat_conversation(conversation_id: int, organization_id: int) -> bool:
    """Evaluate and save one conversation's completeness; never raises.

    Skips a conversation that already has an evaluation: the manual "Re-evaluate"
    button is the way to replace one. Returns whether an evaluation was saved.
    """
    try:
        convo = await db_client.get_chat_conversation(conversation_id, organization_id)
        if convo is None or convo.qa_results:
            return False
        agent = await db_client.get_chat_agent(convo.chat_agent_id, organization_id)
        if agent is None:
            return False
        result = await evaluate_chat_completeness(agent, list(convo.messages or []), convo.end_reason)
        await db_client.set_chat_qa_results(conversation_id, organization_id, result)
        logger.info(f"Chat conversation {conversation_id} evaluated: {result.get('verdict')} {result.get('score')}")
        return True
    except Exception as e:
        logger.error(f"Failed to evaluate chat conversation {conversation_id}: {e}")
        return False


async def queue_chat_evaluation(conversation_id: int, organization_id: int) -> None:
    """Hand the evaluation to the ARQ worker; a queueing failure is logged, not raised."""
    try:
        from api.tasks.arq import enqueue_job
        from api.tasks.function_names import FunctionNames

        await enqueue_job(FunctionNames.EVALUATE_CHAT_CONVERSATION, conversation_id, organization_id)
    except Exception as e:
        logger.error(f"Could not queue chat evaluation for conversation {conversation_id}: {e}")


async def queue_chat_finish_jobs(convo) -> None:
    """Queue whatever a finished conversation is still missing: its title and its evaluation."""
    if not convo.conversation_title:
        await queue_chat_title_generation(convo.id, convo.organization_id)
    if not convo.qa_results:
        await queue_chat_evaluation(convo.id, convo.organization_id)


async def sweep_finished_chats(ctx: dict) -> dict:
    """Cron: queue the title and evaluation of finished conversations that lack them."""
    now = datetime.now(UTC)
    rows = await db_client.list_chat_conversations_to_finish(
        finished_before=now - ACTIVE_WINDOW,
        created_after=now - SWEEP_LOOKBACK,
        limit=SWEEP_BATCH,
    )
    for convo in rows:
        await queue_chat_finish_jobs(convo)
    if rows:
        logger.info(f"Chat finish sweep: queued follow-up for {len(rows)} conversation(s)")
    return {"queued": len(rows)}
