"""Org-scoped reads behind the website-chat tab of the overview page.

Conversations are grouped in SQL by agent, start day, website and length band,
so a busy widget's year comes back as a few hundred rows, not one per visitor.
"""

from datetime import datetime

from sqlalchemy import Date, Integer, and_, case, cast, func, literal_column, select, text

from api.db.base_client import BaseDBClient
from api.db.models import ChatAgentModel, ChatConversationModel
from api.schemas.chat_agent_overview import (
    ChatAgentRecord,
    ChatConversationClock,
    ChatConversationGroup,
    ChatDailyTokens,
    ChatHeavyConversation,
    ChatModelUsage,
    ChatPreviousConversations,
    ChatReplyUsage,
)

# Length bands by how many messages the visitor sent.
BAND_GREETING_ONLY = "greeting_only"
BAND_ONE = "one_message"
BAND_SHORT = "two_to_five"
BAND_LONG = "six_plus"

_MESSAGES = func.json_array_length(ChatConversationModel.messages)
_VISITOR_MESSAGES = cast(
    literal_column(
        "(SELECT count(*) FROM json_array_elements(chat_conversations.messages) AS m"
        " WHERE m->>'role' = 'user')"
    ),
    Integer,
)
_LENGTH_BAND = case(
    (_VISITOR_MESSAGES == 0, BAND_GREETING_ONLY),
    (_VISITOR_MESSAGES == 1, BAND_ONE),
    (_VISITOR_MESSAGES <= 5, BAND_SHORT),
    else_=BAND_LONG,
)


def _conversations_where(
    *, organization_id: int, start: datetime, end: datetime, chat_agent_id: int | None = None
):
    conditions = [
        ChatConversationModel.organization_id == organization_id,
        ChatConversationModel.created_at >= start,
        ChatConversationModel.created_at < end,
    ]
    if chat_agent_id is not None:
        conditions.append(ChatConversationModel.chat_agent_id == chat_agent_id)
    return and_(*conditions)


class ChatAgentOverviewClient(BaseDBClient):
    async def list_chat_overview_agents(self, *, organization_id: int) -> list[ChatAgentRecord]:
        query = (
            select(ChatAgentModel.id, ChatAgentModel.name, ChatAgentModel.is_active)
            .where(ChatAgentModel.organization_id == organization_id)
            .order_by(ChatAgentModel.name)
        )
        async with self.async_session() as session:
            rows = (await session.execute(query)).mappings().all()
        return [ChatAgentRecord(**row) for row in rows]

    async def get_first_chat_conversation_at(self, *, organization_id: int) -> datetime | None:
        query = select(func.min(ChatConversationModel.created_at)).where(
            ChatConversationModel.organization_id == organization_id
        )
        async with self.async_session() as session:
            return await session.scalar(query)

    async def list_chat_conversation_groups(
        self,
        *,
        organization_id: int,
        start: datetime,
        end: datetime,
        chat_agent_id: int | None = None,
    ) -> list[ChatConversationGroup]:
        day = cast(ChatConversationModel.created_at, Date).label("day")
        band = _LENGTH_BAND.label("length_band")
        query = (
            select(
                ChatConversationModel.chat_agent_id,
                day,
                ChatConversationModel.origin,
                band,
                func.count().label("conversations"),
                func.coalesce(func.sum(_MESSAGES), 0).label("messages"),
                func.coalesce(func.sum(_VISITOR_MESSAGES), 0).label("visitor_messages"),
                func.max(ChatConversationModel.updated_at).label("last_activity_at"),
            )
            .where(
                _conversations_where(
                    organization_id=organization_id,
                    start=start,
                    end=end,
                    chat_agent_id=chat_agent_id,
                )
            )
            .group_by(ChatConversationModel.chat_agent_id, day, ChatConversationModel.origin, band)
        )
        async with self.async_session() as session:
            rows = (await session.execute(query)).mappings().all()
        return [ChatConversationGroup(**{**row, "day": str(row["day"])}) for row in rows]

    async def list_chat_conversation_clock(
        self,
        *,
        organization_id: int,
        start: datetime,
        end: datetime,
        chat_agent_id: int | None = None,
    ) -> list[ChatConversationClock]:
        hour = func.extract("hour", ChatConversationModel.created_at).label("hour")
        # isodow: Monday = 1 … Sunday = 7.
        isodow = func.extract("isodow", ChatConversationModel.created_at).label("isodow")
        query = (
            select(hour, isodow, func.count().label("conversations"))
            .where(
                _conversations_where(
                    organization_id=organization_id,
                    start=start,
                    end=end,
                    chat_agent_id=chat_agent_id,
                )
            )
            .group_by(hour, isodow)
        )
        async with self.async_session() as session:
            rows = (await session.execute(query)).all()
        return [
            ChatConversationClock(hour=int(r.hour), weekday=int(r.isodow) - 1, conversations=r.conversations)
            for r in rows
        ]

    async def list_chat_previous_conversations(
        self,
        *,
        organization_id: int,
        start: datetime,
        end: datetime,
        chat_agent_id: int | None = None,
    ) -> list[ChatPreviousConversations]:
        query = (
            select(ChatConversationModel.chat_agent_id, func.count().label("conversations"))
            .where(
                _conversations_where(
                    organization_id=organization_id,
                    start=start,
                    end=end,
                    chat_agent_id=chat_agent_id,
                )
            )
            .group_by(ChatConversationModel.chat_agent_id)
        )
        async with self.async_session() as session:
            rows = (await session.execute(query)).all()
        return [
            ChatPreviousConversations(chat_agent_id=r.chat_agent_id, conversations=r.conversations)
            for r in rows
        ]

    async def get_chat_reply_usage(
        self,
        *,
        organization_id: int,
        chat_agent_id: int,
        start: datetime,
        end: datetime,
        speed_target_ms: int,
    ) -> ChatReplyUsage:
        """Sum what the provider reported on stored replies; replies without it are not counted."""
        query = text(
            """
            SELECT
              COALESCE(SUM((m->>'prompt_tokens')::bigint), 0) AS prompt_tokens,
              COALESCE(SUM((m->>'completion_tokens')::bigint), 0) AS completion_tokens,
              COUNT(*) AS replies,
              COUNT(*) FILTER (WHERE m->>'prompt_tokens' IS NOT NULL) AS replies_with_usage,
              COUNT(*) FILTER (WHERE m->>'latency_ms' IS NOT NULL) AS replies_with_latency,
              COUNT(*) FILTER (
                WHERE (m->>'latency_ms') IS NOT NULL
                  AND (m->>'latency_ms')::numeric <= :speed_target
              ) AS fast_replies,
              COUNT(DISTINCT chat_conversations.id) FILTER (
                WHERE m->>'prompt_tokens' IS NOT NULL
              ) AS conversations_with_usage,
              AVG((m->>'latency_ms')::numeric) AS avg_latency_ms
            FROM chat_conversations,
                 json_array_elements(chat_conversations.messages) AS m
            WHERE chat_conversations.organization_id = :org
              AND chat_conversations.chat_agent_id = :agent
              AND chat_conversations.created_at >= :start
              AND chat_conversations.created_at < :end
              AND m->>'role' = 'assistant'
            """
        )
        params = {
            "org": organization_id,
            "agent": chat_agent_id,
            "start": start,
            "end": end,
            "speed_target": speed_target_ms,
        }
        async with self.async_session() as session:
            row = (await session.execute(query, params)).mappings().one()
        avg = row["avg_latency_ms"]
        return ChatReplyUsage(
            prompt_tokens=int(row["prompt_tokens"]),
            completion_tokens=int(row["completion_tokens"]),
            replies=int(row["replies"]),
            replies_with_usage=int(row["replies_with_usage"]),
            replies_with_latency=int(row["replies_with_latency"]),
            fast_replies=int(row["fast_replies"]),
            conversations_with_usage=int(row["conversations_with_usage"]),
            avg_latency_ms=round(float(avg)) if avg is not None else None,
        )

    async def list_chat_daily_tokens(
        self, *, organization_id: int, chat_agent_id: int, start: datetime, end: datetime
    ) -> list[ChatDailyTokens]:
        """Token totals per day the conversation started; days with no replies are absent."""
        query = text(
            """
            SELECT
              (c.created_at AT TIME ZONE 'UTC')::date AS day,
              COALESCE(SUM((m->>'prompt_tokens')::bigint), 0) AS prompt_tokens,
              COALESCE(SUM((m->>'completion_tokens')::bigint), 0) AS completion_tokens,
              COUNT(DISTINCT c.id) AS conversations
            FROM chat_conversations c,
                 json_array_elements(c.messages) AS m
            WHERE c.organization_id = :org
              AND c.chat_agent_id = :agent
              AND c.created_at >= :start
              AND c.created_at < :end
              AND m->>'role' = 'assistant'
            GROUP BY 1
            ORDER BY 1
            """
        )
        params = {"org": organization_id, "agent": chat_agent_id, "start": start, "end": end}
        async with self.async_session() as session:
            rows = (await session.execute(query, params)).mappings().all()
        return [
            ChatDailyTokens(
                date=str(row["day"]),
                prompt_tokens=int(row["prompt_tokens"]),
                completion_tokens=int(row["completion_tokens"]),
                conversations=int(row["conversations"]),
            )
            for row in rows
        ]

    async def list_chat_model_usage(
        self, *, organization_id: int, chat_agent_id: int, start: datetime, end: datetime
    ) -> list[ChatModelUsage]:
        """Replies grouped by the model each stored; replies that recorded none are skipped."""
        query = text(
            """
            SELECT
              COALESCE(
                NULLIF(c.initial_context->'runtime_configuration'->>'preset_name', ''),
                m->>'model'
              ) AS name,
              MAX(c.initial_context->'runtime_configuration'->>'llm_provider') AS provider,
              MAX(COALESCE(c.initial_context->'runtime_configuration'->>'llm_model', m->>'model')) AS model,
              (c.created_at AT TIME ZONE 'UTC')::date AS day,
              COALESCE(SUM((m->>'prompt_tokens')::bigint), 0) AS prompt_tokens,
              COALESCE(SUM((m->>'completion_tokens')::bigint), 0) AS completion_tokens,
              COUNT(*) AS replies,
              COUNT(DISTINCT c.id) AS conversations
            FROM chat_conversations c,
                 json_array_elements(c.messages) AS m
            WHERE c.organization_id = :org
              AND c.chat_agent_id = :agent
              AND c.created_at >= :start
              AND c.created_at < :end
              AND m->>'role' = 'assistant'
              AND m->>'model' IS NOT NULL
            GROUP BY 1, 4
            ORDER BY 1, 4
            """
        )
        params = {"org": organization_id, "agent": chat_agent_id, "start": start, "end": end}
        async with self.async_session() as session:
            rows = (await session.execute(query, params)).mappings().all()
        # A conversation belongs to the one day it started, so the per-day
        # distinct counts add up to the model's distinct conversations.
        by_model: dict[str, list[ChatDailyTokens]] = {}
        for row in rows:
            by_model.setdefault(row["name"], []).append(
                ChatDailyTokens(
                    date=str(row["day"]),
                    prompt_tokens=int(row["prompt_tokens"]),
                    completion_tokens=int(row["completion_tokens"]),
                    conversations=int(row["conversations"]),
                )
            )
        replies = {name: 0 for name in by_model}
        provider: dict[str, str | None] = {}
        model: dict[str, str | None] = {}
        for row in rows:
            replies[row["name"]] += int(row["replies"])
            provider.setdefault(row["name"], row["provider"])
            model.setdefault(row["name"], row["model"])
        models = [
            ChatModelUsage(
                name=name,
                provider=provider[name],
                model=model[name],
                prompt_tokens=sum(d.prompt_tokens for d in days),
                completion_tokens=sum(d.completion_tokens for d in days),
                replies=replies[name],
                conversations=sum(d.conversations for d in days),
                daily=days,
            )
            for name, days in by_model.items()
        ]
        models.sort(key=lambda m: (-(m.prompt_tokens + m.completion_tokens), m.name))
        return models

    async def list_chat_resolution_rows(
        self, *, organization_id: int, chat_agent_id: int, start: datetime, end: datetime
    ) -> list[dict]:
        """Per conversation: how it ended and its saved completeness, without the transcript."""
        query = text(
            """
            SELECT
              c.end_reason,
              c.updated_at,
              (c.last_error IS NOT NULL AND c.last_error::text <> 'null') AS has_error,
              c.qa_results->>'score' AS score,
              c.qa_results->>'verdict' AS verdict
            FROM chat_conversations c
            WHERE c.organization_id = :org
              AND c.chat_agent_id = :agent
              AND c.created_at >= :start
              AND c.created_at < :end
            """
        )
        params = {"org": organization_id, "agent": chat_agent_id, "start": start, "end": end}
        async with self.async_session() as session:
            return [dict(row) for row in (await session.execute(query, params)).mappings().all()]

    async def list_chat_heaviest_conversations(
        self,
        *,
        organization_id: int,
        chat_agent_id: int,
        start: datetime,
        end: datetime,
        limit: int,
    ) -> list[ChatHeavyConversation]:
        """The conversations that reported the most tokens, heaviest first."""
        query = text(
            """
            SELECT
              c.id,
              c.conversation_title,
              c.origin,
              c.created_at,
              json_array_length(c.messages) AS messages,
              COALESCE(SUM(
                COALESCE((m->>'prompt_tokens')::bigint, 0)
                + COALESCE((m->>'completion_tokens')::bigint, 0)
              ), 0) AS total_tokens
            FROM chat_conversations c,
                 json_array_elements(c.messages) AS m
            WHERE c.organization_id = :org
              AND c.chat_agent_id = :agent
              AND c.created_at >= :start
              AND c.created_at < :end
            GROUP BY c.id
            ORDER BY total_tokens DESC, messages DESC, c.id DESC
            LIMIT :limit
            """
        )
        params = {
            "org": organization_id,
            "agent": chat_agent_id,
            "start": start,
            "end": end,
            "limit": limit,
        }
        async with self.async_session() as session:
            rows = (await session.execute(query, params)).mappings().all()
        return [
            ChatHeavyConversation(
                id=int(row["id"]),
                title=row["conversation_title"] or "",
                origin=row["origin"],
                created_at=row["created_at"],
                messages=int(row["messages"]),
                total_tokens=int(row["total_tokens"]),
            )
            for row in rows
        ]
