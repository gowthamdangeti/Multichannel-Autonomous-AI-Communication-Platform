from datetime import UTC, datetime, timedelta

from api.schemas.chat_agent_overview import (
    ChatAgentRecord,
    ChatConversationClock,
    ChatConversationGroup,
    ChatPreviousConversations,
)
from api.services.reports.chat_agent_overview import aggregate_chat_overview, to_website

NOW = datetime(2026, 11, 7, 12, 0, tzinfo=UTC)
START = NOW - timedelta(days=7)


def _agent(agent_id, name, active=True):
    return ChatAgentRecord(id=agent_id, name=name, is_active=active)


def _group(agent_id=1, *, conversations=1, messages=4, visitor=2, band="two_to_five",
           origin="https://shop.com", day="2026-11-06"):
    return ChatConversationGroup(
        chat_agent_id=agent_id, day=day, origin=origin, length_band=band,
        conversations=conversations, messages=messages, visitor_messages=visitor,
        last_activity_at=datetime(2026, 11, int(day[-2:]), 9, tzinfo=UTC),
    )


def _overview(agents, groups, *, clock=(), previous=()):
    return aggregate_chat_overview(
        agents=agents, groups=groups, clock=list(clock),
        previous=None if previous is None else list(previous),
        days=7, period_start=START, now=NOW,
    )


def test_quiet_active_agents_are_listed_and_quiet_paused_ones_are_not():
    agents = [_agent(1, "Busy"), _agent(2, "Quiet"), _agent(3, "Paused", active=False)]

    result = _overview(agents, [_group(1)])

    assert [row.name for row in result.agents] == ["Busy", "Quiet"]
    assert result.summary.agents_with_conversations == 1


def test_paused_agent_with_conversations_stays_on_the_roster():
    result = _overview([_agent(3, "Paused", active=False)], [_group(3)])

    assert [row.name for row in result.agents] == ["Paused"]
    assert result.summary.active_agents == 0


def test_greeting_only_conversations_are_not_engaged():
    groups = [_group(1, conversations=3), _group(1, conversations=1, visitor=0, messages=1, band="greeting_only")]

    row = _overview([_agent(1, "A")], groups).agents[0]

    assert row.conversations == 4
    assert row.engaged_rate == 75.0
    assert row.messages == 5
    assert row.avg_messages_per_conversation == 1.2


def test_agent_without_conversations_has_no_engaged_rate_rather_than_zero():
    row = _overview([_agent(1, "A")], []).agents[0]

    assert row.engaged_rate is None
    assert row.top_website is None


def test_websites_merge_scheme_and_www():
    groups = [_group(1, origin="https://www.shop.com"), _group(1, origin="http://shop.com:8080"), _group(1, origin=None)]

    websites = _overview([_agent(1, "A")], groups).websites

    assert [(w.key, w.count) for w in websites] == [("shop.com", 2), ("unknown", 1)]


def test_to_website_handles_bare_hosts_and_blanks():
    assert to_website("app.example.org") == "app.example.org"
    assert to_website("") == "unknown"


def test_previous_period_is_per_agent_and_all_time_has_none():
    result = _overview(
        [_agent(1, "A"), _agent(2, "B")], [_group(1)],
        previous=[ChatPreviousConversations(chat_agent_id=1, conversations=5)],
    )
    assert result.summary.prev_conversations == 5
    assert {row.name: row.prev_conversations for row in result.agents} == {"A": 5, "B": 0}

    all_time = _overview([_agent(1, "A")], [_group(1)], previous=None)
    assert all_time.summary.prev_conversations is None


def test_daily_and_clock_fill_every_slot():
    clock = [ChatConversationClock(hour=14, weekday=2, conversations=3)]

    result = _overview([_agent(1, "A")], [_group(1, conversations=2, messages=6)], clock=clock)

    assert len(result.daily) == 8
    assert (result.daily[-2].conversations, result.daily[-2].messages) == (2, 6)
    assert result.hourly[14].count == 3
    assert [(w.day, w.count) for w in result.weekday if w.count] == [("Wed", 3)]
