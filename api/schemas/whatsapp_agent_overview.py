"""Shapes for the WhatsApp tab of the overview page.

A WhatsApp conversation is one long-running thread per number and contact, so
the page counts contacts: new ones (thread created in the period) and active
ones (last message in the period). Threads count towards the agent currently
assigned to their number; no history of past assignments is stored.
"""

from datetime import datetime

from pydantic import BaseModel


# ─── DB client rows ──────────────────────────────────────────────────────────


class WhatsAppAgentRecord(BaseModel):
    id: int
    name: str
    is_active: bool


class WhatsAppNumberRecord(BaseModel):
    id: int
    name: str
    phone_number: str | None
    status: str
    assigned_agent_id: int | None


class WhatsAppNewContactGroup(BaseModel):
    """Threads created on one day on one number."""

    number_id: int
    day: str
    contacts: int


class WhatsAppActiveContactGroup(BaseModel):
    """Threads whose last message falls in the period, by number and who spoke last."""

    number_id: int
    awaiting_reply: bool
    contacts: int
    last_activity_at: datetime | None


class WhatsAppContactClock(BaseModel):
    """New threads in one UTC hour on one weekday (0 = Monday)."""

    hour: int
    weekday: int
    contacts: int


class WhatsAppPreviousContacts(BaseModel):
    number_id: int
    contacts: int


# ─── Response ────────────────────────────────────────────────────────────────


class WhatsAppOverviewSummary(BaseModel):
    total_agents: int
    active_agents: int
    agents_with_contacts: int
    numbers: int
    connected_numbers: int
    new_contacts: int
    prev_new_contacts: int | None
    active_contacts: int
    awaiting_reply: int
    unassigned_active_contacts: int


class WhatsAppOverviewDay(BaseModel):
    date: str
    new_contacts: int


class WhatsAppAgentRow(BaseModel):
    id: int
    name: str
    is_active: bool
    numbers: int
    connected_numbers: int
    new_contacts: int
    prev_new_contacts: int | None
    active_contacts: int
    active_share: float
    awaiting_reply: int
    last_activity_at: datetime | None


class WhatsAppNumberRow(BaseModel):
    id: int
    name: str
    phone_number: str | None
    status: str
    agent_name: str | None
    active_contacts: int
    awaiting_reply: int


class WhatsAppOverviewCount(BaseModel):
    key: str
    count: int


class WhatsAppOverviewHour(BaseModel):
    hour: int
    count: int


class WhatsAppOverviewWeekday(BaseModel):
    day: str
    count: int


class WhatsAppAgentOverviewResponse(BaseModel):
    days: int
    summary: WhatsAppOverviewSummary
    daily: list[WhatsAppOverviewDay]
    agents: list[WhatsAppAgentRow]
    numbers: list[WhatsAppNumberRow]
    number_statuses: list[WhatsAppOverviewCount]
    hourly: list[WhatsAppOverviewHour]
    weekday: list[WhatsAppOverviewWeekday]
