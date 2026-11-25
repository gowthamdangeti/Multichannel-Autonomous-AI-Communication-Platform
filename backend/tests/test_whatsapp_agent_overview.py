from datetime import UTC, datetime, timedelta

from api.schemas.whatsapp_agent_overview import (
    WhatsAppActiveContactGroup,
    WhatsAppAgentRecord,
    WhatsAppContactClock,
    WhatsAppNewContactGroup,
    WhatsAppNumberRecord,
    WhatsAppPreviousContacts,
)
from api.services.reports.whatsapp_agent_overview import aggregate_whatsapp_overview

NOW = datetime(2026, 11, 7, 12, 0, tzinfo=UTC)
START = NOW - timedelta(days=7)


def _agent(agent_id, name, active=True):
    return WhatsAppAgentRecord(id=agent_id, name=name, is_active=active)


def _number(number_id, agent_id, status="connected"):
    return WhatsAppNumberRecord(
        id=number_id, name=f"Line {number_id}", phone_number=None, status=status, assigned_agent_id=agent_id
    )


def _active(number_id, contacts, awaiting=False, hour=9):
    return WhatsAppActiveContactGroup(
        number_id=number_id, awaiting_reply=awaiting, contacts=contacts,
        last_activity_at=datetime(2026, 11, 6, hour, tzinfo=UTC),
    )


def _new(number_id, contacts, day="2026-11-06"):
    return WhatsAppNewContactGroup(number_id=number_id, day=day, contacts=contacts)


def _overview(agents, numbers, *, new=(), active=(), clock=(), previous=()):
    return aggregate_whatsapp_overview(
        agents=agents, numbers=numbers, new_groups=list(new), active_groups=list(active),
        clock=list(clock), previous=None if previous is None else list(previous),
        days=7, period_start=START, now=NOW,
    )


def test_threads_count_towards_the_numbers_current_agent():
    agents = [_agent(1, "Sales"), _agent(2, "Support")]
    numbers = [_number(10, 1), _number(11, 1), _number(12, 2)]

    result = _overview(agents, numbers, new=[_new(10, 2), _new(11, 1)], active=[_active(10, 3), _active(12, 1)])

    rows = {row.name: row for row in result.agents}
    assert (rows["Sales"].numbers, rows["Sales"].new_contacts, rows["Sales"].active_contacts) == (2, 3, 3)
    assert rows["Support"].active_contacts == 1
    assert rows["Sales"].active_share == 75.0
    assert [row.name for row in result.agents] == ["Sales", "Support"]


def test_awaiting_reply_counts_only_threads_where_the_contact_spoke_last():
    result = _overview([_agent(1, "A")], [_number(10, 1)], active=[_active(10, 4), _active(10, 2, awaiting=True)])

    assert result.agents[0].active_contacts == 6
    assert result.agents[0].awaiting_reply == 2
    assert result.summary.awaiting_reply == 2


def test_activity_on_unassigned_numbers_is_counted_not_hidden():
    result = _overview([_agent(1, "A")], [_number(10, 1), _number(11, None)], active=[_active(11, 5)])

    assert result.summary.active_contacts == 5
    assert result.summary.unassigned_active_contacts == 5
    assert result.agents[0].active_contacts == 0
    assert result.numbers[0].agent_name is None


def test_quiet_paused_agents_are_dropped_but_quiet_active_ones_stay():
    agents = [_agent(1, "On"), _agent(2, "Off", active=False)]

    result = _overview(agents, [_number(10, 2)])

    assert [row.name for row in result.agents] == ["On"]


def test_connected_numbers_and_statuses():
    numbers = [_number(10, 1), _number(11, 1, status="disconnected")]

    result = _overview([_agent(1, "A")], numbers)

    assert (result.summary.numbers, result.summary.connected_numbers) == (2, 1)
    assert result.agents[0].connected_numbers == 1
    assert {(s.key, s.count) for s in result.number_statuses} == {("connected", 1), ("disconnected", 1)}


def test_previous_new_contacts_follow_the_agents_numbers_and_all_time_has_none():
    result = _overview(
        [_agent(1, "A")], [_number(10, 1)], new=[_new(10, 2)],
        previous=[WhatsAppPreviousContacts(number_id=10, contacts=4)],
    )
    assert result.summary.prev_new_contacts == 4
    assert result.agents[0].prev_new_contacts == 4

    all_time = _overview([_agent(1, "A")], [_number(10, 1)], previous=None)
    assert all_time.agents[0].prev_new_contacts is None


def test_daily_and_clock_fill_every_slot():
    clock = [WhatsAppContactClock(hour=20, weekday=4, contacts=2)]

    result = _overview([_agent(1, "A")], [_number(10, 1)], new=[_new(10, 3)], clock=clock)

    assert len(result.daily) == 8
    assert result.daily[-2].new_contacts == 3
    assert result.hourly[20].count == 2
    assert [(w.day, w.count) for w in result.weekday if w.count] == [("Fri", 2)]
