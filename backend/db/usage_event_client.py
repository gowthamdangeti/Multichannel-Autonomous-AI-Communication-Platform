"""Persistence and aggregation for canonical workflow-run usage events."""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from api.db.base_client import BaseDBClient
from api.db.models import UsageEventModel, WorkflowModel, WorkflowRunModel
from api.services.workflow.usage_contract import (
    NormalizedUsage,
    UsageCase,
    UsageServiceType,
    UsageSource,
    UsageStatus,
    normalize_usage,
)


class UsageEventClient(BaseDBClient):
    async def record_usage(
        self,
        *,
        workflow_run_id: int,
        case: UsageCase | str,
        service_type: UsageServiceType | str,
        operation_id: str,
        usage: dict[str, Any] | NormalizedUsage | None = None,
        provider: str | None = None,
        model: str | None = None,
        node_id: str | None = None,
        attempt: int = 1,
        status: UsageStatus | str = UsageStatus.RECORDED,
        estimated_cost_usd: Decimal | float | None = None,
        usage_source: UsageSource | str | None = None,
        provider_cost_usd: Decimal | None = None,
        usage_detail: dict[str, Any] | None = None,
    ) -> UsageEventModel:
        """Insert one event; duplicate operation/attempt returns the existing row."""
        if not operation_id.strip():
            raise ValueError("operation_id must not be empty")
        if attempt < 1:
            raise ValueError("attempt must be positive")

        normalized = usage if isinstance(usage, NormalizedUsage) else normalize_usage(usage)
        values = {
            "workflow_run_id": workflow_run_id,
            "case": str(case),
            "service_type": str(service_type),
            "status": str(status),
            "operation_id": operation_id,
            "attempt": attempt,
            "provider": provider,
            "model": model,
            "node_id": node_id,
            "input_tokens": normalized.input_tokens,
            "output_tokens": normalized.output_tokens,
            "total_tokens": normalized.total_tokens,
            "cache_read_tokens": normalized.cache_read_tokens,
            "cache_write_tokens": normalized.cache_write_tokens,
            "input_units": normalized.input_units,
            "output_units": normalized.output_units,
            "estimated_cost_usd": estimated_cost_usd,
            "usage_source": str(usage_source) if usage_source else None,
            "provider_cost_usd": provider_cost_usd,
            "usage_detail": usage_detail,
            "created_at": datetime.now(UTC),
        }

        async with self.async_session() as session:
            stmt = insert(UsageEventModel).values(**values)
            stmt = stmt.on_conflict_do_nothing(
                constraint="uq_usage_event_run_operation_attempt"
            ).returning(UsageEventModel.id)
            inserted_id = (await session.execute(stmt)).scalar_one_or_none()
            await session.commit()
            if inserted_id is None:
                existing = await session.execute(
                    select(UsageEventModel).where(
                        UsageEventModel.workflow_run_id == workflow_run_id,
                        UsageEventModel.operation_id == operation_id,
                        UsageEventModel.attempt == attempt,
                    )
                )
                row = existing.scalar_one()
            else:
                row = await session.get(UsageEventModel, inserted_id)
            if row is None:
                raise RuntimeError("usage event disappeared after insert")
            return row

    async def next_attempt(self, workflow_run_id: int, operation_id: str) -> int:
        """Return the next append-only attempt number for an operation."""
        async with self.async_session() as session:
            result = await session.execute(
                select(UsageEventModel.attempt)
                .where(
                    UsageEventModel.workflow_run_id == workflow_run_id,
                    UsageEventModel.operation_id == operation_id,
                )
                .order_by(UsageEventModel.attempt.desc())
                .limit(1)
            )
            current = result.scalar_one_or_none()
        return int(current or 0) + 1

    async def aggregate_for_run(self, workflow_run_id: int) -> list[dict[str, Any]]:
        async with self.async_session() as session:
            result = await session.execute(
                select(UsageEventModel)
                .where(UsageEventModel.workflow_run_id == workflow_run_id)
                .order_by(UsageEventModel.created_at, UsageEventModel.id)
            )
            rows = result.scalars().all()
        groups: dict[tuple[str, str, str | None, str | None, str, int], dict[str, Any]] = defaultdict(
            lambda: {
                "input_tokens": 0,
                "output_tokens": 0,
                "total_tokens": 0,
                "cache_read_tokens": 0,
                "cache_write_tokens": 0,
                "input_units": 0.0,
                "output_units": 0.0,
                "estimated_cost_usd": 0.0,
                "event_count": 0,
            }
        )
        for row in rows:
            if row.status != UsageStatus.RECORDED.value:
                continue
            # Billed rows are the same usage again, from the provider. The UI
            # turns each entry here into a row, so they travel separately.
            if row.usage_source == UsageSource.PROVIDER_BILLED.value:
                continue
            # Include attempt so each regeneration stays as its own entry.
            key = (row.case, row.service_type, row.provider, row.model, row.operation_id or "", row.attempt)
            target = groups[key]
            target.update({
                "case": row.case,
                "service_type": row.service_type,
                "provider": row.provider,
                "model": row.model,
                "operation_id": row.operation_id,
                "attempt": row.attempt,
            })
            for field in ("input_tokens", "output_tokens", "total_tokens", "cache_read_tokens", "cache_write_tokens"):
                target[field] += getattr(row, field) or 0
            target["input_units"] += float(row.input_units or 0)
            target["output_units"] += float(row.output_units or 0)
            target["estimated_cost_usd"] += float(row.estimated_cost_usd or 0)
            target["event_count"] += 1
        return list(groups.values())

    async def reconcile_run(self, workflow_run_id: int) -> dict[str, Any]:
        entries = await self.aggregate_for_run(workflow_run_id)
        totals = {
            "input_tokens": sum(entry["input_tokens"] for entry in entries),
            "output_tokens": sum(entry["output_tokens"] for entry in entries),
            "total_tokens": sum(entry["total_tokens"] for entry in entries),
            "cache_read_tokens": sum(entry["cache_read_tokens"] for entry in entries),
            "cache_write_tokens": sum(entry["cache_write_tokens"] for entry in entries),
            "estimated_cost_usd": sum(entry["estimated_cost_usd"] for entry in entries),
        }
        return {"entries": entries, "totals": totals, "warnings": []}

    async def find_provider_request_event(
        self,
        *,
        operation_ids: list[str],
        organization_id: int,
    ) -> tuple[UsageEventModel, WorkflowRunModel] | None:
        """Find a billed request, only inside this organization."""
        async with self.async_session() as session:
            result = await session.execute(
                select(UsageEventModel, WorkflowRunModel)
                .join(
                    WorkflowRunModel,
                    WorkflowRunModel.id == UsageEventModel.workflow_run_id,
                )
                .join(WorkflowModel, WorkflowModel.id == WorkflowRunModel.workflow_id)
                .where(
                    UsageEventModel.operation_id.in_(operation_ids),
                    UsageEventModel.usage_source == UsageSource.PROVIDER_BILLED.value,
                    UsageEventModel.status == UsageStatus.RECORDED.value,
                    WorkflowModel.organization_id == organization_id,
                )
                .limit(1)
            )
            row = result.first()
        return (row[0], row[1]) if row else None

    async def list_provider_usage_events(
        self, *, workflow_run_id: int
    ) -> list[UsageEventModel]:
        """Events that came from, or were expected from, the provider."""
        async with self.async_session() as session:
            result = await session.execute(
                select(UsageEventModel)
                .where(
                    UsageEventModel.workflow_run_id == workflow_run_id,
                    UsageEventModel.usage_source.in_(
                        (
                            UsageSource.PROVIDER_BILLED.value,
                            UsageSource.PROVIDER_UNREPORTED.value,
                        )
                    ),
                )
                .order_by(UsageEventModel.created_at, UsageEventModel.id)
            )
            return list(result.scalars().all())
