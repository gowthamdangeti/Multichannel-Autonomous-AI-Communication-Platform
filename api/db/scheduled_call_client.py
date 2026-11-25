from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.dialects.postgresql import insert

from api.db.base_client import BaseDBClient
from api.db.models import ScheduledWorkflowCallModel


def _calculate_retry_delay_seconds(
    strategy: str, base_interval_seconds: int, attempt_count: int
) -> int:
    """Return the delay after a failed attempt, capped at seven days."""
    if strategy == "exponential":
        return min(base_interval_seconds * (2**attempt_count), 604800)
    return min(base_interval_seconds, 604800)


class ScheduledCallClient(BaseDBClient):
    async def create_scheduled_call(
        self,
        *,
        organization_id: int,
        target_workflow_id: int,
        trigger_path: str,
        phone_number: str,
        initial_context: dict[str, Any],
        telephony_configuration_id: int | None,
        scheduled_at: datetime,
        idempotency_key: str,
        max_attempts: int = 3,
        retry_strategy: str = "exponential",
        retry_interval_seconds: int = 60,
    ) -> tuple[ScheduledWorkflowCallModel, bool]:
        """Create a schedule or return the existing idempotent schedule."""
        values = {
            "organization_id": organization_id,
            "target_workflow_id": target_workflow_id,
            "trigger_path": trigger_path,
            "phone_number": phone_number,
            "initial_context": initial_context,
            "telephony_configuration_id": telephony_configuration_id,
            "scheduled_at": scheduled_at,
            "next_attempt_at": scheduled_at,
            "idempotency_key": idempotency_key,
            "max_attempts": max_attempts,
            "retry_strategy": retry_strategy,
            "retry_interval_seconds": retry_interval_seconds,
        }
        async with self.async_session() as session:
            statement = (
                insert(ScheduledWorkflowCallModel)
                .values(**values)
                .on_conflict_do_nothing(
                    constraint="uq_scheduled_workflow_calls_org_idempotency"
                )
                .returning(ScheduledWorkflowCallModel.id)
            )
            created_id = (await session.execute(statement)).scalar_one_or_none()
            created = created_id is not None
            result = await session.execute(
                select(ScheduledWorkflowCallModel).where(
                    ScheduledWorkflowCallModel.organization_id == organization_id,
                    ScheduledWorkflowCallModel.idempotency_key == idempotency_key,
                )
            )
            scheduled_call = result.scalar_one()
            await session.commit()
            await session.refresh(scheduled_call)
            return scheduled_call, created

    async def claim_due_scheduled_calls(
        self, *, limit: int = 20, lease_seconds: int = 300
    ) -> list[ScheduledWorkflowCallModel]:
        now = datetime.now(UTC)
        async with self.async_session() as session:
            result = await session.execute(
                select(ScheduledWorkflowCallModel)
                .where(
                    ScheduledWorkflowCallModel.next_attempt_at <= now,
                    or_(
                        ScheduledWorkflowCallModel.status.in_(("pending", "retry")),
                        (
                            (ScheduledWorkflowCallModel.status == "processing")
                            & (ScheduledWorkflowCallModel.lease_expires_at <= now)
                        ),
                    ),
                )
                .order_by(ScheduledWorkflowCallModel.next_attempt_at)
                .limit(limit)
                .with_for_update(skip_locked=True)
            )
            scheduled_calls = list(result.scalars().all())
            lease_expires_at = now + timedelta(seconds=lease_seconds)
            for scheduled_call in scheduled_calls:
                scheduled_call.status = "processing"
                scheduled_call.lease_expires_at = lease_expires_at
                scheduled_call.attempt_count += 1
            await session.commit()
            for scheduled_call in scheduled_calls:
                await session.refresh(scheduled_call)
            return scheduled_calls

    async def mark_scheduled_call_dispatched(
        self, scheduled_call_id: int, workflow_run_id: int
    ) -> None:
        async with self.async_session() as session:
            scheduled_call = await session.get(
                ScheduledWorkflowCallModel, scheduled_call_id
            )
            if not scheduled_call:
                return
            scheduled_call.status = "dispatched"
            scheduled_call.dispatched_workflow_run_id = workflow_run_id
            scheduled_call.dispatched_at = datetime.now(UTC)
            scheduled_call.lease_expires_at = None
            scheduled_call.last_error = None
            await session.commit()

    async def mark_scheduled_call_completed_for_run(
        self, workflow_run_id: int
    ) -> None:
        """Finish a scheduled-call sequence after a successful call outcome."""
        async with self.async_session() as session:
            result = await session.execute(
                select(ScheduledWorkflowCallModel).where(
                    ScheduledWorkflowCallModel.dispatched_workflow_run_id
                    == workflow_run_id,
                    ScheduledWorkflowCallModel.status == "dispatched",
                )
            )
            scheduled_call = result.scalar_one_or_none()
            if not scheduled_call:
                return
            scheduled_call.status = "completed"
            scheduled_call.last_error = None
            await session.commit()

    async def retry_scheduled_call_for_run(
        self, workflow_run_id: int, reason: str
    ) -> datetime | None:
        """Schedule the next call after an unsuccessful terminal call outcome."""
        async with self.async_session() as session:
            result = await session.execute(
                select(ScheduledWorkflowCallModel)
                .where(
                    ScheduledWorkflowCallModel.dispatched_workflow_run_id
                    == workflow_run_id,
                    ScheduledWorkflowCallModel.status == "dispatched",
                )
                .with_for_update()
            )
            scheduled_call = result.scalar_one_or_none()
            if not scheduled_call:
                return None
            exhausted = scheduled_call.attempt_count >= scheduled_call.max_attempts
            scheduled_call.status = "failed" if exhausted else "retry"
            scheduled_call.last_error = reason[:2000]
            scheduled_call.lease_expires_at = None
            if exhausted:
                await session.commit()
                return None
            delay_seconds = _calculate_retry_delay_seconds(
                scheduled_call.retry_strategy,
                scheduled_call.retry_interval_seconds,
                scheduled_call.attempt_count,
            )
            scheduled_call.next_attempt_at = datetime.now(UTC) + timedelta(
                seconds=delay_seconds
            )
            retry_at = scheduled_call.next_attempt_at
            await session.commit()
            return retry_at

    async def mark_scheduled_call_failed(
        self, scheduled_call_id: int, error: str
    ) -> None:
        async with self.async_session() as session:
            scheduled_call = await session.get(
                ScheduledWorkflowCallModel, scheduled_call_id
            )
            if not scheduled_call:
                return
            exhausted = scheduled_call.attempt_count >= scheduled_call.max_attempts
            scheduled_call.status = "failed" if exhausted else "retry"
            scheduled_call.last_error = error[:2000]
            scheduled_call.lease_expires_at = None
            if not exhausted:
                delay_seconds = _calculate_retry_delay_seconds(
                    scheduled_call.retry_strategy,
                    scheduled_call.retry_interval_seconds,
                    scheduled_call.attempt_count,
                )
                scheduled_call.next_attempt_at = datetime.now(UTC) + timedelta(
                    seconds=delay_seconds
                )
            await session.commit()
