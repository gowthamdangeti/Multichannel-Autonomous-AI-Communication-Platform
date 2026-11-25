"""Org-scoped reads behind the voice-agents overview page.

Voice calls are workflow runs on any channel but text chat. Calls are grouped
in SQL so a busy org's year of calls comes back as a few hundred rows, not one
row per call.
"""

from datetime import datetime

from sqlalchemy import Date, Float, String, and_, cast, func, literal_column, select

from api.db.base_client import BaseDBClient
from api.db.models import FolderModel, WorkflowModel, WorkflowRunModel
from api.enums import WorkflowRunMode
from api.schemas.voice_agent_overview import (
    VoiceAgentRecord,
    VoiceCallClock,
    VoiceCallGroup,
    VoicePreviousCalls,
)

NON_VOICE_MODES = (WorkflowRunMode.TEXTCHAT.value,)

_DURATION_SECONDS = func.coalesce(
    cast(literal_column("(workflow_runs.usage_info->>'call_duration_seconds')"), Float),
    0.0,
)
_DISPOSITION = literal_column(
    "(workflow_runs.gathered_context->>'mapped_call_disposition')", String
)


def _voice_calls_where(
    *,
    organization_id: int,
    start: datetime,
    end: datetime,
    agent_ids: set[int] | None = None,
):
    conditions = [
        WorkflowModel.organization_id == organization_id,
        WorkflowRunModel.mode.notin_(NON_VOICE_MODES),
        WorkflowRunModel.created_at >= start,
        WorkflowRunModel.created_at < end,
    ]
    if agent_ids is not None:
        # Dashboard reads are utilisation-scoped: restricted agents contribute
        # neither roster rows nor calls to the numbers on the page.
        conditions.append(WorkflowRunModel.workflow_id.in_(agent_ids))
    return and_(*conditions)


class VoiceAgentOverviewClient(BaseDBClient):
    async def list_voice_agents(
        self, *, organization_id: int, agent_ids: set[int] | None = None
    ) -> list[VoiceAgentRecord]:
        """Every agent in the org, archived ones included, with its folder name."""
        query = (
            select(
                WorkflowModel.id,
                WorkflowModel.name,
                WorkflowModel.status,
                WorkflowModel.created_at,
                FolderModel.name.label("folder_name"),
            )
            .outerjoin(FolderModel, FolderModel.id == WorkflowModel.folder_id)
            .where(WorkflowModel.organization_id == organization_id)
        )
        if agent_ids is not None:
            query = query.where(WorkflowModel.id.in_(agent_ids))
        query = query.order_by(WorkflowModel.name)
        async with self.async_session() as session:
            rows = (await session.execute(query)).mappings().all()
        return [VoiceAgentRecord(**row) for row in rows]

    async def get_first_voice_call_at(self, *, organization_id: int) -> datetime | None:
        query = (
            select(func.min(WorkflowRunModel.created_at))
            .join(WorkflowModel, WorkflowModel.id == WorkflowRunModel.workflow_id)
            .where(
                WorkflowModel.organization_id == organization_id,
                WorkflowRunModel.mode.notin_(NON_VOICE_MODES),
            )
        )
        async with self.async_session() as session:
            return await session.scalar(query)

    async def list_voice_call_groups(
        self,
        *,
        organization_id: int,
        start: datetime,
        end: datetime,
        agent_ids: set[int] | None = None,
    ) -> list[VoiceCallGroup]:
        day = cast(WorkflowRunModel.created_at, Date).label("day")
        disposition = _DISPOSITION.label("disposition")
        query = (
            select(
                WorkflowRunModel.workflow_id,
                day,
                WorkflowRunModel.mode,
                WorkflowRunModel.call_type,
                WorkflowRunModel.state,
                disposition,
                func.count().label("calls"),
                func.sum(_DURATION_SECONDS).label("duration_seconds"),
                func.max(WorkflowRunModel.created_at).label("last_call_at"),
            )
            .join(WorkflowModel, WorkflowModel.id == WorkflowRunModel.workflow_id)
            .where(
                _voice_calls_where(
                    organization_id=organization_id,
                    start=start,
                    end=end,
                    agent_ids=agent_ids,
                )
            )
            .group_by(
                WorkflowRunModel.workflow_id,
                day,
                WorkflowRunModel.mode,
                WorkflowRunModel.call_type,
                WorkflowRunModel.state,
                disposition,
            )
        )
        async with self.async_session() as session:
            rows = (await session.execute(query)).mappings().all()
        return [
            VoiceCallGroup(
                **{**row, "day": str(row["day"]), "duration_seconds": row["duration_seconds"] or 0.0}
            )
            for row in rows
        ]

    async def list_voice_call_clock(
        self,
        *,
        organization_id: int,
        start: datetime,
        end: datetime,
        agent_ids: set[int] | None = None,
    ) -> list[VoiceCallClock]:
        hour = func.extract("hour", WorkflowRunModel.created_at).label("hour")
        # isodow: Monday = 1 … Sunday = 7.
        isodow = func.extract("isodow", WorkflowRunModel.created_at).label("isodow")
        query = (
            select(hour, isodow, func.count().label("calls"))
            .join(WorkflowModel, WorkflowModel.id == WorkflowRunModel.workflow_id)
            .where(
                _voice_calls_where(
                    organization_id=organization_id,
                    start=start,
                    end=end,
                    agent_ids=agent_ids,
                )
            )
            .group_by(hour, isodow)
        )
        async with self.async_session() as session:
            rows = (await session.execute(query)).all()
        return [
            VoiceCallClock(hour=int(r.hour), weekday=int(r.isodow) - 1, calls=r.calls)
            for r in rows
        ]

    async def list_voice_previous_calls(
        self,
        *,
        organization_id: int,
        start: datetime,
        end: datetime,
        agent_ids: set[int] | None = None,
    ) -> list[VoicePreviousCalls]:
        query = (
            select(WorkflowRunModel.workflow_id, func.count().label("calls"))
            .join(WorkflowModel, WorkflowModel.id == WorkflowRunModel.workflow_id)
            .where(
                _voice_calls_where(
                    organization_id=organization_id,
                    start=start,
                    end=end,
                    agent_ids=agent_ids,
                )
            )
            .group_by(WorkflowRunModel.workflow_id)
        )
        async with self.async_session() as session:
            rows = (await session.execute(query)).all()
        return [VoicePreviousCalls(workflow_id=r.workflow_id, calls=r.calls) for r in rows]
