"""Database access for chat (website widget) conversations."""

from datetime import UTC, datetime
from typing import List, Optional

from sqlalchemy import and_, or_, text, update
from sqlalchemy.future import select

from api.db.base_client import BaseDBClient
from api.db.models import ChatConversationModel

# Sentinel: leave ``last_error`` as it is.
_KEEP_ERROR: dict = {}


class ChatConversationClient(BaseDBClient):
    async def create_chat_conversation(
        self,
        organization_id: int,
        chat_agent_id: int,
        session_token: str,
        origin: Optional[str] = None,
        initial_context: Optional[dict] = None,
    ) -> ChatConversationModel:
        async with self.async_session() as session:
            convo = ChatConversationModel(
                organization_id=organization_id,
                chat_agent_id=chat_agent_id,
                session_token=session_token,
                messages=[],
                origin=origin,
                initial_context=initial_context,
            )
            session.add(convo)
            await session.commit()
            await session.refresh(convo)
            return convo

    async def set_chat_qa_results(
        self, conversation_id: int, organization_id: int, qa_results: dict
    ) -> None:
        """Save the latest completeness evaluation (org-scoped).

        ``updated_at`` is the conversation's activity time — when its last
        message was sent — and chat has no other timing source: duration,
        status and the idle window that completes a session all read it. An
        evaluation is not visitor activity, so the timestamp is written back
        unchanged instead of being bumped by the column's ``onupdate``.
        """
        async with self.async_session() as session:
            await session.execute(
                update(ChatConversationModel)
                .where(
                    ChatConversationModel.id == conversation_id,
                    ChatConversationModel.organization_id == organization_id,
                )
                .values(
                    qa_results=qa_results,
                    updated_at=ChatConversationModel.updated_at,
                )
            )
            await session.commit()

    async def get_chat_conversation_by_token(
        self, session_token: str
    ) -> Optional[ChatConversationModel]:
        """Unauthenticated lookup for the public message endpoint."""
        async with self.async_session() as session:
            result = await session.execute(
                select(ChatConversationModel).where(
                    ChatConversationModel.session_token == session_token
                )
            )
            return result.scalars().first()

    async def append_chat_messages(
        self,
        session_token: str,
        new_messages: list[dict],
        last_error: Optional[dict] = _KEEP_ERROR,
    ) -> Optional[ChatConversationModel]:
        """Append to the transcript. ``last_error`` is left alone unless given:
        a dict records a failed reply, None clears a previous failure."""
        async with self.async_session() as session:
            result = await session.execute(
                select(ChatConversationModel).where(
                    ChatConversationModel.session_token == session_token
                )
            )
            convo = result.scalars().first()
            if convo is None:
                return None
            # Reassign so SQLAlchemy tracks the JSON column change.
            convo.messages = list(convo.messages or []) + list(new_messages)
            # Anything said after an evaluation makes it stale; the next finish re-runs it.
            if convo.qa_results:
                convo.qa_results = None
            # The visitor is back (e.g. a page restored from cache): not disconnected.
            if convo.end_reason == "disconnected":
                convo.end_reason = None
                convo.ended_at = None
                # More was said since the title was made; regenerate at the next end.
                convo.conversation_title = None
            if last_error is not _KEEP_ERROR:
                convo.last_error = last_error
            await session.commit()
            await session.refresh(convo)
            return convo

    async def end_chat_conversation(
        self, session_token: str, reason: str
    ) -> Optional[ChatConversationModel]:
        """Record how the visitor's session ended ("completed" | "disconnected").

        An explicit "completed" is final and never downgraded; a "disconnected"
        never overwrites an end that was already recorded. ``updated_at`` is
        kept (it is the last-message time that duration is measured against).
        """
        async with self.async_session() as session:
            result = await session.execute(
                select(ChatConversationModel).where(
                    ChatConversationModel.session_token == session_token
                )
            )
            convo = result.scalars().first()
            if convo is None:
                return None
            if convo.end_reason == "completed" or (
                convo.end_reason and reason == "disconnected"
            ):
                return convo
            last_activity = convo.updated_at
            convo.end_reason = reason
            convo.ended_at = datetime.now(UTC)
            convo.updated_at = last_activity
            await session.commit()
            await session.refresh(convo)
            return convo

    async def replace_chat_transcript(
        self,
        session_token: str,
        messages: list[dict],
        last_error: Optional[dict] = _KEEP_ERROR,
        keep_activity_time: bool = False,
    ) -> Optional[ChatConversationModel]:
        """Write the full transcript back (a retried or rated reply).

        ``keep_activity_time`` leaves ``updated_at`` alone: a rating is not a new
        message, and duration and status read that timestamp.
        """
        async with self.async_session() as session:
            result = await session.execute(
                select(ChatConversationModel).where(ChatConversationModel.session_token == session_token)
            )
            convo = result.scalars().first()
            if convo is None:
                return None
            last_activity = convo.updated_at
            convo.messages = list(messages)
            if last_error is not _KEEP_ERROR:
                convo.last_error = last_error
            if keep_activity_time:
                convo.updated_at = last_activity
            else:
                # A new reply makes any saved evaluation stale, as a new message does.
                convo.qa_results = None
            await session.commit()
            await session.refresh(convo)
            return convo

    async def set_chat_conversation_title(
        self, conversation_id: int, organization_id: int, title: str
    ) -> bool:
        """Save the title once (org-scoped); ``False`` when one is already set.

        ``updated_at`` is written back unchanged: a title is not visitor activity.
        """
        async with self.async_session() as session:
            result = await session.execute(
                update(ChatConversationModel)
                .where(
                    ChatConversationModel.id == conversation_id,
                    ChatConversationModel.organization_id == organization_id,
                    ChatConversationModel.conversation_title.is_(None),
                )
                .values(
                    conversation_title=title[:120],
                    updated_at=ChatConversationModel.updated_at,
                )
            )
            await session.commit()
            return bool(result.rowcount)

    async def list_chat_conversations_to_finish(
        self, *, finished_before: datetime, created_after: datetime, limit: int
    ) -> List[ChatConversationModel]:
        """Finished conversations still missing a title or an evaluation (all orgs, for the sweep).

        Finished means the widget reported an end, or the last message is older
        than ``finished_before`` (the idle window after which it counts as disconnected).
        """
        missing = or_(
            ChatConversationModel.conversation_title.is_(None),
            ChatConversationModel.qa_results.is_(None),
            text("chat_conversations.qa_results::text = 'null'"),
        )
        finished = or_(
            ChatConversationModel.end_reason.is_not(None),
            ChatConversationModel.updated_at < finished_before,
        )
        async with self.async_session() as session:
            result = await session.execute(
                select(ChatConversationModel)
                .where(and_(ChatConversationModel.created_at >= created_after, missing, finished))
                .order_by(ChatConversationModel.updated_at.asc())
                .limit(limit)
            )
            return list(result.scalars().all())

    async def list_chat_conversations(
        self, organization_id: int
    ) -> List[ChatConversationModel]:
        async with self.async_session() as session:
            result = await session.execute(
                select(ChatConversationModel)
                .where(ChatConversationModel.organization_id == organization_id)
                .order_by(ChatConversationModel.updated_at.desc())
            )
            return list(result.scalars().all())

    async def get_chat_conversation(
        self, conversation_id: int, organization_id: int
    ) -> Optional[ChatConversationModel]:
        async with self.async_session() as session:
            result = await session.execute(
                select(ChatConversationModel).where(
                    ChatConversationModel.id == conversation_id,
                    ChatConversationModel.organization_id == organization_id,
                )
            )
            return result.scalars().first()
