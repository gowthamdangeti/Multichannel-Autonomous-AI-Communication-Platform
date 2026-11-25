"""Roll an org's voice calls up into the overview page: KPIs, trend, agent roster.

Every active agent is listed, quiet ones too, so the roster is the org's real
fleet and not just its busiest agents. Archived agents show up only for the
periods they took calls in.
"""

from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from api.constants import ALL_TIME_DAYS
from api.db import db_client
from api.enums import CallType, WorkflowRunState, WorkflowStatus
from api.schemas.voice_agent_overview import (
    VoiceAgentOverviewResponse,
    VoiceAgentRecord,
    VoiceAgentRow,
    VoiceCallClock,
    VoiceCallGroup,
    VoiceOverviewCount,
    VoiceOverviewDay,
    VoiceOverviewHour,
    VoiceOverviewSummary,
    VoiceOverviewWeekday,
    VoicePreviousCalls,
)

WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
OUTCOME_LIMIT = 8


@dataclass
class _Tally:
    calls: int = 0
    duration_seconds: float = 0.0
    completed: int = 0
    inbound: int = 0
    outbound: int = 0
    last_call_at: datetime | None = None
    channels: Counter = field(default_factory=Counter)

    def add(self, group: VoiceCallGroup) -> None:
        self.calls += group.calls
        self.duration_seconds += group.duration_seconds
        if group.state == WorkflowRunState.COMPLETED.value:
            self.completed += group.calls
        if group.call_type == CallType.INBOUND.value:
            self.inbound += group.calls
        else:
            self.outbound += group.calls
        self.channels[group.mode] += group.calls
        if group.last_call_at and (not self.last_call_at or group.last_call_at > self.last_call_at):
            self.last_call_at = group.last_call_at

    @property
    def minutes(self) -> float:
        return round(self.duration_seconds / 60, 1)

    @property
    def avg_duration_seconds(self) -> float:
        return round(self.duration_seconds / self.calls, 1) if self.calls else 0.0

    @property
    def completion_rate(self) -> float | None:
        return round(self.completed / self.calls * 100, 1) if self.calls else None


def _share(part: int, total: int) -> float:
    return round(part / total * 100, 1) if total else 0.0


def _counts(counter: Counter, limit: int | None = None) -> list[VoiceOverviewCount]:
    return [VoiceOverviewCount(key=key, calls=calls) for key, calls in counter.most_common(limit)]


def _daily(groups: list[VoiceCallGroup], *, period_start: datetime, now: datetime) -> list[VoiceOverviewDay]:
    """One row per calendar day through today, quiet days included."""
    calls: Counter = Counter()
    seconds: defaultdict[str, float] = defaultdict(float)
    for group in groups:
        calls[group.day] += group.calls
        seconds[group.day] += group.duration_seconds
    span = (now.date() - period_start.date()).days
    days = [(period_start + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(span + 1)]
    return [VoiceOverviewDay(date=d, calls=calls[d], minutes=round(seconds[d] / 60, 1)) for d in days]


def _agent_row(
    agent: VoiceAgentRecord, tally: _Tally, *, prev_calls: int | None, total_calls: int
) -> VoiceAgentRow:
    top_channel = tally.channels.most_common(1)[0][0] if tally.channels else None
    return VoiceAgentRow(
        id=agent.id,
        name=agent.name,
        status=agent.status,
        folder_name=agent.folder_name,
        calls=tally.calls,
        prev_calls=prev_calls,
        call_share=_share(tally.calls, total_calls),
        total_minutes=tally.minutes,
        avg_duration_seconds=tally.avg_duration_seconds,
        completion_rate=tally.completion_rate,
        inbound_calls=tally.inbound,
        outbound_calls=tally.outbound,
        top_channel=top_channel,
        last_call_at=tally.last_call_at,
    )


def aggregate_voice_overview(
    *,
    agents: list[VoiceAgentRecord],
    groups: list[VoiceCallGroup],
    clock: list[VoiceCallClock],
    previous: list[VoicePreviousCalls] | None,
    days: int,
    period_start: datetime,
    now: datetime,
) -> VoiceAgentOverviewResponse:
    """Pure rollup; ``previous`` is None when there is no earlier period (all time)."""
    org = _Tally()
    by_agent: defaultdict[int, _Tally] = defaultdict(_Tally)
    states: Counter = Counter()
    outcomes: Counter = Counter()
    for group in groups:
        org.add(group)
        by_agent[group.workflow_id].add(group)
        states[group.state] += group.calls
        if group.disposition:
            outcomes[group.disposition] += group.calls

    prev_by_agent = {p.workflow_id: p.calls for p in previous} if previous is not None else None
    active = WorkflowStatus.ACTIVE.value
    rows = [
        _agent_row(
            agent,
            by_agent[agent.id],
            prev_calls=None if prev_by_agent is None else prev_by_agent.get(agent.id, 0),
            total_calls=org.calls,
        )
        for agent in agents
        if agent.status == active or by_agent[agent.id].calls
    ]
    rows.sort(key=lambda row: (-row.calls, row.name.lower()))

    hourly: Counter = Counter()
    weekday: Counter = Counter()
    for slot in clock:
        hourly[slot.hour] += slot.calls
        weekday[slot.weekday] += slot.calls

    summary = VoiceOverviewSummary(
        total_agents=len(rows),
        active_agents=sum(1 for row in rows if row.status == active),
        agents_with_calls=sum(1 for row in rows if row.calls),
        calls=org.calls,
        prev_calls=None if previous is None else sum(p.calls for p in previous),
        total_minutes=org.minutes,
        avg_duration_seconds=org.avg_duration_seconds,
        completion_rate=org.completion_rate,
        inbound_calls=org.inbound,
        outbound_calls=org.outbound,
    )
    return VoiceAgentOverviewResponse(
        days=days,
        summary=summary,
        daily=_daily(groups, period_start=period_start, now=now),
        agents=rows,
        channels=_counts(org.channels),
        outcomes=_counts(outcomes, OUTCOME_LIMIT),
        states=_counts(states),
        hourly=[VoiceOverviewHour(hour=h, calls=hourly[h]) for h in range(24)],
        weekday=[VoiceOverviewWeekday(day=label, calls=weekday[i]) for i, label in enumerate(WEEKDAYS)],
    )


async def get_voice_agent_overview(
    *,
    organization_id: int,
    days: int,
    now: datetime | None = None,
    agent_ids: set[int] | None = None,
) -> VoiceAgentOverviewResponse:
    """``agent_ids`` limits the whole rollup to agents the caller may access.

    Passing an empty set yields an empty dashboard rather than an org-wide one;
    ``None`` (API-key/internal callers) keeps the previous org-wide behaviour.
    """
    now = now or datetime.now(UTC)
    is_all_time = days == ALL_TIME_DAYS
    if is_all_time:
        first_call = await db_client.get_first_voice_call_at(organization_id=organization_id)
        period_start = first_call or now
    else:
        period_start = now - timedelta(days=days)

    window = {"organization_id": organization_id, "start": period_start, "end": now}
    agents = await db_client.list_voice_agents(
        organization_id=organization_id, agent_ids=agent_ids
    )
    groups = await db_client.list_voice_call_groups(**window, agent_ids=agent_ids)
    clock = await db_client.list_voice_call_clock(**window, agent_ids=agent_ids)
    previous = (
        None
        if is_all_time
        else await db_client.list_voice_previous_calls(
            organization_id=organization_id,
            start=period_start - timedelta(days=days),
            end=period_start,
            agent_ids=agent_ids,
        )
    )
    return aggregate_voice_overview(
        agents=agents,
        groups=groups,
        clock=clock,
        previous=previous,
        days=days,
        period_start=period_start,
        now=now,
    )
