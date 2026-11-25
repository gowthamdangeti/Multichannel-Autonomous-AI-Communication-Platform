"""Shapes for the voice-agents overview page.

The ``*Record`` / ``*Group`` models carry rows from the DB client to the
service. The rest is the response the overview page reads.
"""

from datetime import datetime

from pydantic import BaseModel


# ─── DB client rows ──────────────────────────────────────────────────────────


class VoiceAgentRecord(BaseModel):
    id: int
    name: str
    status: str
    folder_name: str | None
    created_at: datetime | None


class VoiceCallGroup(BaseModel):
    """Calls that share an agent, day, channel, direction, state and outcome."""

    workflow_id: int
    day: str
    mode: str
    call_type: str
    state: str
    disposition: str | None
    calls: int
    duration_seconds: float
    last_call_at: datetime | None


class VoiceCallClock(BaseModel):
    """Calls that started in one UTC hour on one weekday (0 = Monday)."""

    hour: int
    weekday: int
    calls: int


class VoicePreviousCalls(BaseModel):
    workflow_id: int
    calls: int


# ─── Response ────────────────────────────────────────────────────────────────


class VoiceOverviewSummary(BaseModel):
    total_agents: int
    active_agents: int
    agents_with_calls: int
    calls: int
    prev_calls: int | None
    total_minutes: float
    avg_duration_seconds: float
    completion_rate: float | None
    inbound_calls: int
    outbound_calls: int


class VoiceOverviewDay(BaseModel):
    date: str
    calls: int
    minutes: float


class VoiceAgentRow(BaseModel):
    id: int
    name: str
    status: str
    folder_name: str | None
    calls: int
    prev_calls: int | None
    call_share: float
    total_minutes: float
    avg_duration_seconds: float
    completion_rate: float | None
    inbound_calls: int
    outbound_calls: int
    top_channel: str | None
    last_call_at: datetime | None


class VoiceOverviewCount(BaseModel):
    key: str
    calls: int


class VoiceOverviewHour(BaseModel):
    hour: int
    calls: int


class VoiceOverviewWeekday(BaseModel):
    day: str
    calls: int


class VoiceAgentOverviewResponse(BaseModel):
    days: int
    summary: VoiceOverviewSummary
    daily: list[VoiceOverviewDay]
    agents: list[VoiceAgentRow]
    channels: list[VoiceOverviewCount]
    outcomes: list[VoiceOverviewCount]
    states: list[VoiceOverviewCount]
    hourly: list[VoiceOverviewHour]
    weekday: list[VoiceOverviewWeekday]
