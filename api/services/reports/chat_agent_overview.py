"""Roll an org's website-chat conversations up into the overview page.

Every active chat agent is listed, quiet ones too. Paused agents show up only
for the periods they had conversations in. A conversation is "engaged" when
the visitor sent at least one message, not just the widget greeting.
"""

from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from urllib.parse import urlparse

from api.constants import ALL_TIME_DAYS
from api.db import db_client
from api.db.chat_agent_overview_client import BAND_GREETING_ONLY
from api.schemas.chat_agent_overview import (
    ChatAgentAnalyticsResponse,
    ChatAgentOverviewResponse,
    ChatAgentRecord,
    ChatAgentRow,
    ChatConversationClock,
    ChatConversationGroup,
    ChatDailyTokens,
    ChatHeavyConversation,
    ChatOverviewCount,
    ChatOverviewDay,
    ChatOverviewHour,
    ChatOverviewSummary,
    ChatOverviewWeekday,
    ChatPreviousConversations,
)
from api.services.chat.conversation_title import resolve_chat_display_title
from api.services.reports.chat_agent_resolution import get_chat_resolution
from api.services.reports.chat_agent_performance import (
    SPEED_TARGET_MS,
    build_chat_agent_performance,
)

WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
WEBSITE_LIMIT = 8
HEAVIEST_LIMIT = 5
UNKNOWN_WEBSITE = "unknown"


def to_website(origin: str | None) -> str:
    """``https://www.shop.com:443`` → ``shop.com``; blank or unparsable → ``unknown``."""
    if not origin:
        return UNKNOWN_WEBSITE
    host = urlparse(origin if "//" in origin else f"//{origin}").hostname or ""
    host = host.removeprefix("www.")
    return host or UNKNOWN_WEBSITE


@dataclass
class _Tally:
    conversations: int = 0
    messages: int = 0
    visitor_messages: int = 0
    engaged: int = 0
    last_activity_at: datetime | None = None
    websites: Counter = field(default_factory=Counter)

    def add(self, group: ChatConversationGroup) -> None:
        self.conversations += group.conversations
        self.messages += group.messages
        self.visitor_messages += group.visitor_messages
        if group.length_band != BAND_GREETING_ONLY:
            self.engaged += group.conversations
        self.websites[to_website(group.origin)] += group.conversations
        if group.last_activity_at and (
            not self.last_activity_at or group.last_activity_at > self.last_activity_at
        ):
            self.last_activity_at = group.last_activity_at

    @property
    def avg_messages(self) -> float:
        return round(self.messages / self.conversations, 1) if self.conversations else 0.0

    @property
    def engaged_rate(self) -> float | None:
        return round(self.engaged / self.conversations * 100, 1) if self.conversations else None


def _daily(groups: list[ChatConversationGroup], *, period_start: datetime, now: datetime) -> list[ChatOverviewDay]:
    conversations: Counter = Counter()
    messages: Counter = Counter()
    for group in groups:
        conversations[group.day] += group.conversations
        messages[group.day] += group.messages
    span = (now.date() - period_start.date()).days
    days = [(period_start + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(span + 1)]
    return [ChatOverviewDay(date=d, conversations=conversations[d], messages=messages[d]) for d in days]


def _agent_row(
    agent: ChatAgentRecord, tally: _Tally, *, prev: int | None, total: int
) -> ChatAgentRow:
    return ChatAgentRow(
        id=agent.id,
        name=agent.name,
        is_active=agent.is_active,
        conversations=tally.conversations,
        prev_conversations=prev,
        conversation_share=round(tally.conversations / total * 100, 1) if total else 0.0,
        messages=tally.messages,
        avg_messages_per_conversation=tally.avg_messages,
        engaged_rate=tally.engaged_rate,
        top_website=tally.websites.most_common(1)[0][0] if tally.websites else None,
        last_activity_at=tally.last_activity_at,
    )


def aggregate_chat_overview(
    *,
    agents: list[ChatAgentRecord],
    groups: list[ChatConversationGroup],
    clock: list[ChatConversationClock],
    previous: list[ChatPreviousConversations] | None,
    days: int,
    period_start: datetime,
    now: datetime,
) -> ChatAgentOverviewResponse:
    """Pure rollup; ``previous`` is None when there is no earlier period (all time)."""
    org = _Tally()
    by_agent: defaultdict[int, _Tally] = defaultdict(_Tally)
    lengths: Counter = Counter()
    for group in groups:
        org.add(group)
        by_agent[group.chat_agent_id].add(group)
        lengths[group.length_band] += group.conversations

    prev_by_agent = (
        {p.chat_agent_id: p.conversations for p in previous} if previous is not None else None
    )
    rows = [
        _agent_row(
            agent,
            by_agent[agent.id],
            prev=None if prev_by_agent is None else prev_by_agent.get(agent.id, 0),
            total=org.conversations,
        )
        for agent in agents
        if agent.is_active or by_agent[agent.id].conversations
    ]
    rows.sort(key=lambda row: (-row.conversations, row.name.lower()))

    hourly: Counter = Counter()
    weekday: Counter = Counter()
    for slot in clock:
        hourly[slot.hour] += slot.conversations
        weekday[slot.weekday] += slot.conversations

    summary = ChatOverviewSummary(
        total_agents=len(rows),
        active_agents=sum(1 for row in rows if row.is_active),
        agents_with_conversations=sum(1 for row in rows if row.conversations),
        conversations=org.conversations,
        prev_conversations=None if previous is None else sum(p.conversations for p in previous),
        messages=org.messages,
        visitor_messages=org.visitor_messages,
        avg_messages_per_conversation=org.avg_messages,
        engaged_rate=org.engaged_rate,
    )
    return ChatAgentOverviewResponse(
        days=days,
        summary=summary,
        daily=_daily(groups, period_start=period_start, now=now),
        agents=rows,
        websites=[ChatOverviewCount(key=k, count=c) for k, c in org.websites.most_common(WEBSITE_LIMIT)],
        lengths=[ChatOverviewCount(key=k, count=c) for k, c in lengths.most_common()],
        hourly=[ChatOverviewHour(hour=h, count=hourly[h]) for h in range(24)],
        weekday=[ChatOverviewWeekday(day=label, count=weekday[i]) for i, label in enumerate(WEEKDAYS)],
    )


async def _overview_inputs(
    *,
    organization_id: int,
    days: int,
    chat_agent_id: int | None,
    now: datetime,
) -> tuple[datetime, list[ChatAgentRecord], list[ChatConversationGroup], list[ChatConversationClock], list[ChatPreviousConversations] | None]:
    """The window and rows the rollup reads, fetched once for a period."""
    is_all_time = days == ALL_TIME_DAYS
    if is_all_time:
        first = await db_client.get_first_chat_conversation_at(organization_id=organization_id)
        period_start = first or now
    else:
        period_start = now - timedelta(days=days)

    window = {
        "organization_id": organization_id,
        "start": period_start,
        "end": now,
        "chat_agent_id": chat_agent_id,
    }
    agents = await db_client.list_chat_overview_agents(organization_id=organization_id)
    if chat_agent_id is not None:
        agents = [a for a in agents if a.id == chat_agent_id]
    groups = await db_client.list_chat_conversation_groups(**window)
    clock = await db_client.list_chat_conversation_clock(**window)
    previous = (
        None
        if is_all_time
        else await db_client.list_chat_previous_conversations(
            organization_id=organization_id,
            start=period_start - timedelta(days=days),
            end=period_start,
            chat_agent_id=chat_agent_id,
        )
    )
    return period_start, agents, groups, clock, previous


async def get_chat_agent_overview(
    *,
    organization_id: int,
    days: int,
    chat_agent_id: int | None = None,
    now: datetime | None = None,
) -> ChatAgentOverviewResponse:
    """Org-wide overview, or one agent's when ``chat_agent_id`` is given."""
    now = now or datetime.now(UTC)
    period_start, agents, groups, clock, previous = await _overview_inputs(
        organization_id=organization_id, days=days, chat_agent_id=chat_agent_id, now=now
    )
    return aggregate_chat_overview(
        agents=agents,
        groups=groups,
        clock=clock,
        previous=previous,
        days=days,
        period_start=period_start,
        now=now,
    )


def _daily_tokens(
    rows: list[ChatDailyTokens], *, period_start: datetime, now: datetime
) -> list[ChatDailyTokens]:
    """Fill the days a quiet agent has no replies on, so the chart keeps its axis."""
    by_day = {row.date: row for row in rows}
    span = (now.date() - period_start.date()).days
    return [
        by_day.get(
            day,
            ChatDailyTokens(date=day, prompt_tokens=0, completion_tokens=0, conversations=0),
        )
        for day in (
            (period_start + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(span + 1)
        )
    ]


def _with_display_titles(
    conversations: list[ChatHeavyConversation], *, agent_name: str | None
) -> list[ChatHeavyConversation]:
    """Give every conversation its display title: saved, else `{agent}_embed_{id}`."""
    return [
        c.model_copy(
            update={"title": resolve_chat_display_title(c.title or None, agent_name, c.id)}
        )
        for c in conversations
    ]


async def get_chat_agent_analytics(
    *, organization_id: int, chat_agent_id: int, days: int, now: datetime | None = None
) -> ChatAgentAnalyticsResponse:
    """One agent's conversation overview plus the usage its replies reported."""
    now = now or datetime.now(UTC)
    period_start, agents, groups, clock, previous = await _overview_inputs(
        organization_id=organization_id, days=days, chat_agent_id=chat_agent_id, now=now
    )
    overview = aggregate_chat_overview(
        agents=agents,
        groups=groups,
        clock=clock,
        previous=previous,
        days=days,
        period_start=period_start,
        now=now,
    )

    usage = await db_client.get_chat_reply_usage(
        organization_id=organization_id,
        chat_agent_id=chat_agent_id,
        start=period_start,
        end=now,
        speed_target_ms=SPEED_TARGET_MS,
    )
    daily_tokens = await db_client.list_chat_daily_tokens(
        organization_id=organization_id,
        chat_agent_id=chat_agent_id,
        start=period_start,
        end=now,
    )
    return ChatAgentAnalyticsResponse(
        **overview.model_dump(),
        usage=usage,
        daily_tokens=_daily_tokens(daily_tokens, period_start=period_start, now=now),
        by_model=[
            model.model_copy(
                update={"daily": _daily_tokens(model.daily, period_start=period_start, now=now)}
            )
            for model in await db_client.list_chat_model_usage(
                organization_id=organization_id,
                chat_agent_id=chat_agent_id,
                start=period_start,
                end=now,
            )
        ],
        heaviest=_with_display_titles(
            await db_client.list_chat_heaviest_conversations(
                organization_id=organization_id,
                chat_agent_id=chat_agent_id,
                start=period_start,
                end=now,
                limit=HEAVIEST_LIMIT,
            ),
            agent_name=agents[0].name if agents else None,
        ),
        performance=build_chat_agent_performance(groups, usage),
        resolution=await get_chat_resolution(
            organization_id=organization_id,
            chat_agent_id=chat_agent_id,
            start=period_start,
            end=now,
        ),
    )
