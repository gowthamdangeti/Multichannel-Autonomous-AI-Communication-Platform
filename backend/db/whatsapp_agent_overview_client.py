"""Org-scoped reads behind the WhatsApp tab of the overview page.

Threads are grouped by number in SQL. The service maps numbers to their current
agent, so a number with no agent still shows up as unassigned activity.
"""

from datetime import datetime

from sqlalchemy import Date, and_, cast, func, literal_column, select

from api.db.base_client import BaseDBClient
from api.db.models import WhatsAppAgentModel, WhatsAppConversationModel, WhatsAppNumberModel
from api.schemas.whatsapp_agent_overview import (
    WhatsAppActiveContactGroup,
    WhatsAppAgentRecord,
    WhatsAppContactClock,
    WhatsAppNewContactGroup,
    WhatsAppNumberRecord,
    WhatsAppPreviousContacts,
)

# The contact spoke last, so the thread is waiting on the agent.
_AWAITING_REPLY = literal_column("(whatsapp_conversations.messages -> -1 ->> 'role') = 'user'")


def _created_where(*, organization_id: int, start: datetime, end: datetime):
    return and_(
        WhatsAppConversationModel.organization_id == organization_id,
        WhatsAppConversationModel.created_at >= start,
        WhatsAppConversationModel.created_at < end,
    )


class WhatsAppAgentOverviewClient(BaseDBClient):
    async def list_whatsapp_overview_agents(self, *, organization_id: int) -> list[WhatsAppAgentRecord]:
        query = (
            select(WhatsAppAgentModel.id, WhatsAppAgentModel.name, WhatsAppAgentModel.is_active)
            .where(WhatsAppAgentModel.organization_id == organization_id)
            .order_by(WhatsAppAgentModel.name)
        )
        async with self.async_session() as session:
            rows = (await session.execute(query)).mappings().all()
        return [WhatsAppAgentRecord(**row) for row in rows]

    async def list_whatsapp_overview_numbers(self, *, organization_id: int) -> list[WhatsAppNumberRecord]:
        query = (
            select(
                WhatsAppNumberModel.id,
                WhatsAppNumberModel.name,
                WhatsAppNumberModel.phone_number,
                WhatsAppNumberModel.status,
                WhatsAppNumberModel.assigned_agent_id,
            )
            .where(WhatsAppNumberModel.organization_id == organization_id)
            .order_by(WhatsAppNumberModel.name)
        )
        async with self.async_session() as session:
            rows = (await session.execute(query)).mappings().all()
        return [WhatsAppNumberRecord(**row) for row in rows]

    async def get_first_whatsapp_contact_at(self, *, organization_id: int) -> datetime | None:
        query = select(func.min(WhatsAppConversationModel.created_at)).where(
            WhatsAppConversationModel.organization_id == organization_id
        )
        async with self.async_session() as session:
            return await session.scalar(query)

    async def list_whatsapp_new_contacts(
        self, *, organization_id: int, start: datetime, end: datetime
    ) -> list[WhatsAppNewContactGroup]:
        day = cast(WhatsAppConversationModel.created_at, Date).label("day")
        query = (
            select(WhatsAppConversationModel.number_id, day, func.count().label("contacts"))
            .where(_created_where(organization_id=organization_id, start=start, end=end))
            .group_by(WhatsAppConversationModel.number_id, day)
        )
        async with self.async_session() as session:
            rows = (await session.execute(query)).all()
        return [WhatsAppNewContactGroup(number_id=r.number_id, day=str(r.day), contacts=r.contacts) for r in rows]

    async def list_whatsapp_active_contacts(
        self, *, organization_id: int, start: datetime, end: datetime
    ) -> list[WhatsAppActiveContactGroup]:
        awaiting = func.coalesce(_AWAITING_REPLY, False).label("awaiting_reply")
        query = (
            select(
                WhatsAppConversationModel.number_id,
                awaiting,
                func.count().label("contacts"),
                func.max(WhatsAppConversationModel.updated_at).label("last_activity_at"),
            )
            .where(
                WhatsAppConversationModel.organization_id == organization_id,
                WhatsAppConversationModel.updated_at >= start,
                WhatsAppConversationModel.updated_at < end,
            )
            .group_by(WhatsAppConversationModel.number_id, awaiting)
        )
        async with self.async_session() as session:
            rows = (await session.execute(query)).mappings().all()
        return [WhatsAppActiveContactGroup(**row) for row in rows]

    async def list_whatsapp_contact_clock(
        self, *, organization_id: int, start: datetime, end: datetime
    ) -> list[WhatsAppContactClock]:
        hour = func.extract("hour", WhatsAppConversationModel.created_at).label("hour")
        # isodow: Monday = 1 … Sunday = 7.
        isodow = func.extract("isodow", WhatsAppConversationModel.created_at).label("isodow")
        query = (
            select(hour, isodow, func.count().label("contacts"))
            .where(_created_where(organization_id=organization_id, start=start, end=end))
            .group_by(hour, isodow)
        )
        async with self.async_session() as session:
            rows = (await session.execute(query)).all()
        return [
            WhatsAppContactClock(hour=int(r.hour), weekday=int(r.isodow) - 1, contacts=r.contacts)
            for r in rows
        ]

    async def list_whatsapp_previous_contacts(
        self, *, organization_id: int, start: datetime, end: datetime
    ) -> list[WhatsAppPreviousContacts]:
        query = (
            select(WhatsAppConversationModel.number_id, func.count().label("contacts"))
            .where(_created_where(organization_id=organization_id, start=start, end=end))
            .group_by(WhatsAppConversationModel.number_id)
        )
        async with self.async_session() as session:
            rows = (await session.execute(query)).all()
        return [WhatsAppPreviousContacts(number_id=r.number_id, contacts=r.contacts) for r in rows]
