from datetime import UTC, datetime, timedelta

from api.schemas.voice_agent_overview import (
    VoiceAgentRecord,
    VoiceCallClock,
    VoiceCallGroup,
    VoicePreviousCalls,
)
from api.services.reports.voice_agent_overview import aggregate_voice_overview

NOW = datetime(2026, 11, 7, 12, 0, tzinfo=UTC)
START = NOW - timedelta(days=7)


def _agent(agent_id, name, status="active", folder=None):
    return VoiceAgentRecord(id=agent_id, name=name, status=status, folder_name=folder, created_at=None)


def _group(workflow_id=1, *, calls=1, seconds=60.0, mode="twilio", call_type="outbound",
           state="completed", disposition=None, day="2026-11-06", hour=10):
    return VoiceCallGroup(
        workflow_id=workflow_id, day=day, mode=mode, call_type=call_type, state=state,
        disposition=disposition, calls=calls, duration_seconds=seconds,
        last_call_at=datetime(2026, 11, int(day[-2:]), hour, tzinfo=UTC),
    )


def _overview(agents, groups, *, clock=(), previous=()):
    return aggregate_voice_overview(
        agents=agents, groups=groups, clock=list(clock),
        previous=None if previous is None else list(previous),
        days=7, period_start=START, now=NOW,
    )


def test_quiet_active_agents_are_listed_and_quiet_archived_ones_are_not():
    agents = [_agent(1, "Busy"), _agent(2, "Quiet"), _agent(3, "Old", status="archived")]

    result = _overview(agents, [_group(1)])

    assert [row.name for row in result.agents] == ["Busy", "Quiet"]
    assert result.summary.total_agents == 2
    assert result.summary.agents_with_calls == 1


def test_archived_agent_with_calls_stays_on_the_roster():
    result = _overview([_agent(3, "Old", status="archived")], [_group(3)])

    assert [row.name for row in result.agents] == ["Old"]
    assert result.summary.active_agents == 0


def test_roster_is_ranked_by_calls_then_name():
    agents = [_agent(1, "b"), _agent(2, "a"), _agent(3, "c")]

    result = _overview(agents, [_group(3, calls=5), _group(1, calls=2), _group(2, calls=2)])

    assert [row.name for row in result.agents] == ["c", "a", "b"]


def test_agent_row_adds_up_minutes_completion_direction_and_channel():
    groups = [
        _group(1, calls=3, seconds=300, mode="twilio", call_type="inbound"),
        _group(1, calls=1, seconds=60, mode="webrtc", state="running"),
    ]

    row = _overview([_agent(1, "A")], groups).agents[0]

    assert row.calls == 4
    assert row.total_minutes == 6.0
    assert row.avg_duration_seconds == 90.0
    assert row.completion_rate == 75.0
    assert (row.inbound_calls, row.outbound_calls) == (3, 1)
    assert row.top_channel == "twilio"
    assert row.call_share == 100.0


def test_agent_without_calls_has_no_completion_rate_rather_than_zero():
    row = _overview([_agent(1, "A")], []).agents[0]

    assert row.completion_rate is None
    assert row.top_channel is None
    assert row.last_call_at is None


def test_previous_period_is_per_agent_and_missing_agents_count_as_zero():
    result = _overview(
        [_agent(1, "A"), _agent(2, "B")], [_group(1)],
        previous=[VoicePreviousCalls(workflow_id=1, calls=4)],
    )

    assert result.summary.prev_calls == 4
    assert {row.name: row.prev_calls for row in result.agents} == {"A": 4, "B": 0}


def test_all_time_has_no_previous_period():
    result = _overview([_agent(1, "A")], [_group(1)], previous=None)

    assert result.summary.prev_calls is None
    assert result.agents[0].prev_calls is None


def test_daily_has_every_day_including_quiet_ones():
    daily = _overview([_agent(1, "A")], [_group(1, calls=2, seconds=120)]).daily

    assert len(daily) == 8
    assert daily[-1].date == "2026-11-07" and daily[-1].calls == 0
    assert (daily[-2].date, daily[-2].calls, daily[-2].minutes) == ("2026-11-06", 2, 2.0)


def test_outcomes_skip_calls_without_a_disposition():
    groups = [_group(1, calls=2, disposition="interested"), _group(1, calls=5)]

    outcomes = _overview([_agent(1, "A")], groups).outcomes

    assert [(o.key, o.calls) for o in outcomes] == [("interested", 2)]


def test_clock_fills_every_hour_and_weekday():
    clock = [VoiceCallClock(hour=9, weekday=0, calls=3), VoiceCallClock(hour=9, weekday=6, calls=1)]

    result = _overview([_agent(1, "A")], [], clock=clock)

    assert len(result.hourly) == 24 and result.hourly[9].calls == 4
    assert [(w.day, w.calls) for w in result.weekday if w.calls] == [("Mon", 3), ("Sun", 1)]
