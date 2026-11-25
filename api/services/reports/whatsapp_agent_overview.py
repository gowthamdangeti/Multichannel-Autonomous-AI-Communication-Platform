"""Roll an org's WhatsApp threads up into the overview page.

Threads belong to a number; each number's current agent gets its threads. Every
active agent is listed, quiet ones too. Paused agents show up only when their
numbers had activity. Activity on numbers with no agent is counted separately,
so it isn't hidden.
"""

from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from api.constants import ALL_TIME_DAYS
from api.db import db_client
from api.schemas.whatsapp_agent_overview import (
    WhatsAppActiveContactGroup,
    WhatsAppAgentOverviewResponse,
    WhatsAppAgentRecord,
    WhatsAppAgentRow,
    WhatsAppContactClock,
    WhatsAppNewContactGroup,
    WhatsAppNumberRecord,
    WhatsAppNumberRow,
    WhatsAppOverviewCount,
    WhatsAppOverviewDay,
    WhatsAppOverviewHour,
    WhatsAppOverviewSummary,
    WhatsAppOverviewWeekday,
    WhatsAppPreviousContacts,
)

WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
CONNECTED = "connected"


@dataclass
class _Tally:
    new_contacts: int = 0
    active_contacts: int = 0
    awaiting_reply: int = 0
    last_activity_at: datetime | None = None

    def add_active(self, group: WhatsAppActiveContactGroup) -> None:
        self.active_contacts += group.contacts
        if group.awaiting_reply:
            self.awaiting_reply += group.contacts
        if group.last_activity_at and (
            not self.last_activity_at or group.last_activity_at > self.last_activity_at
        ):
            self.last_activity_at = group.last_activity_at


def aggregate_whatsapp_overview(
    *,
    agents: list[WhatsAppAgentRecord],
    numbers: list[WhatsAppNumberRecord],
    new_groups: list[WhatsAppNewContactGroup],
    active_groups: list[WhatsAppActiveContactGroup],
    clock: list[WhatsAppContactClock],
    previous: list[WhatsAppPreviousContacts] | None,
    days: int,
    period_start: datetime,
    now: datetime,
) -> WhatsAppAgentOverviewResponse:
    """Pure rollup; ``previous`` is None when there is no earlier period (all time)."""
    by_number: defaultdict[int, _Tally] = defaultdict(_Tally)
    daily: Counter = Counter()
    for group in new_groups:
        by_number[group.number_id].new_contacts += group.contacts
        daily[group.day] += group.contacts
    for group in active_groups:
        by_number[group.number_id].add_active(group)
    prev_by_number = Counter({p.number_id: p.contacts for p in previous}) if previous is not None else None

    agent_names = {agent.id: agent.name for agent in agents}
    numbers_of: defaultdict[int, list[WhatsAppNumberRecord]] = defaultdict(list)
    unassigned_active = 0
    for number in numbers:
        if number.assigned_agent_id in agent_names:
            numbers_of[number.assigned_agent_id].append(number)
        else:
            unassigned_active += by_number[number.id].active_contacts

    total_active = sum(t.active_contacts for t in by_number.values())
    rows: list[WhatsAppAgentRow] = []
    for agent in agents:
        owned = numbers_of[agent.id]
        tally = _Tally()
        for number in owned:
            n = by_number[number.id]
            tally.new_contacts += n.new_contacts
            tally.active_contacts += n.active_contacts
            tally.awaiting_reply += n.awaiting_reply
            if n.last_activity_at and (not tally.last_activity_at or n.last_activity_at > tally.last_activity_at):
                tally.last_activity_at = n.last_activity_at
        if not agent.is_active and not tally.active_contacts and not tally.new_contacts:
            continue
        rows.append(
            WhatsAppAgentRow(
                id=agent.id,
                name=agent.name,
                is_active=agent.is_active,
                numbers=len(owned),
                connected_numbers=sum(1 for n in owned if n.status == CONNECTED),
                new_contacts=tally.new_contacts,
                prev_new_contacts=None if prev_by_number is None else sum(prev_by_number[n.id] for n in owned),
                active_contacts=tally.active_contacts,
                active_share=round(tally.active_contacts / total_active * 100, 1) if total_active else 0.0,
                awaiting_reply=tally.awaiting_reply,
                last_activity_at=tally.last_activity_at,
            )
        )
    rows.sort(key=lambda row: (-row.active_contacts, -row.new_contacts, row.name.lower()))

    number_rows = sorted(
        (
            WhatsAppNumberRow(
                id=number.id,
                name=number.name,
                phone_number=number.phone_number,
                status=number.status,
                agent_name=agent_names.get(number.assigned_agent_id),
                active_contacts=by_number[number.id].active_contacts,
                awaiting_reply=by_number[number.id].awaiting_reply,
            )
            for number in numbers
        ),
        key=lambda row: (-row.active_contacts, row.name.lower()),
    )

    hourly: Counter = Counter()
    weekday: Counter = Counter()
    for slot in clock:
        hourly[slot.hour] += slot.contacts
        weekday[slot.weekday] += slot.contacts

    span = (now.date() - period_start.date()).days
    dates = [(period_start + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(span + 1)]
    summary = WhatsAppOverviewSummary(
        total_agents=len(rows),
        active_agents=sum(1 for row in rows if row.is_active),
        agents_with_contacts=sum(1 for row in rows if row.active_contacts or row.new_contacts),
        numbers=len(numbers),
        connected_numbers=sum(1 for n in numbers if n.status == CONNECTED),
        new_contacts=sum(t.new_contacts for t in by_number.values()),
        prev_new_contacts=None if prev_by_number is None else sum(prev_by_number.values()),
        active_contacts=total_active,
        awaiting_reply=sum(t.awaiting_reply for t in by_number.values()),
        unassigned_active_contacts=unassigned_active,
    )
    return WhatsAppAgentOverviewResponse(
        days=days,
        summary=summary,
        daily=[WhatsAppOverviewDay(date=d, new_contacts=daily[d]) for d in dates],
        agents=rows,
        numbers=number_rows,
        number_statuses=[
            WhatsAppOverviewCount(key=k, count=c)
            for k, c in Counter(n.status for n in numbers).most_common()
        ],
        hourly=[WhatsAppOverviewHour(hour=h, count=hourly[h]) for h in range(24)],
        weekday=[WhatsAppOverviewWeekday(day=label, count=weekday[i]) for i, label in enumerate(WEEKDAYS)],
    )


async def get_whatsapp_agent_overview(
    *, organization_id: int, days: int, now: datetime | None = None
) -> WhatsAppAgentOverviewResponse:
    now = now or datetime.now(UTC)
    is_all_time = days == ALL_TIME_DAYS
    if is_all_time:
        first = await db_client.get_first_whatsapp_contact_at(organization_id=organization_id)
        period_start = first or now
    else:
        period_start = now - timedelta(days=days)

    window = {"organization_id": organization_id, "start": period_start, "end": now}
    return aggregate_whatsapp_overview(
        agents=await db_client.list_whatsapp_overview_agents(organization_id=organization_id),
        numbers=await db_client.list_whatsapp_overview_numbers(organization_id=organization_id),
        new_groups=await db_client.list_whatsapp_new_contacts(**window),
        active_groups=await db_client.list_whatsapp_active_contacts(**window),
        clock=await db_client.list_whatsapp_contact_clock(**window),
        previous=None
        if is_all_time
        else await db_client.list_whatsapp_previous_contacts(
            organization_id=organization_id,
            start=period_start - timedelta(days=days),
            end=period_start,
        ),
        days=days,
        period_start=period_start,
        now=now,
    )
