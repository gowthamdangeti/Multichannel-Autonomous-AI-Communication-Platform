from datetime import UTC, datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import Date, Float, String, and_, cast, desc, func, select, text

from api.constants import ALL_TIME_DAYS
from api.db.base_client import BaseDBClient
from api.db.models import WorkflowDefinitionModel, WorkflowModel, WorkflowRunModel


class ReportsClient(BaseDBClient):
    async def get_workflow_runs_for_daily_report(
        self,
        organization_id: int,
        start_utc: datetime,
        end_utc: datetime,
        workflow_id: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """
        Optimized method for daily reports - fetches only required JSON fields.
        Uses PostgreSQL JSON operators to extract only needed fields from JSON columns.

        Args:
            organization_id: The organization ID to filter by
            start_utc: Start datetime in UTC
            end_utc: End datetime in UTC
            workflow_id: Optional workflow ID to filter by

        Returns:
            List of dictionaries with report-specific fields
        """
        async with self.async_session() as session:
            # Select only the specific JSON fields needed for daily reports
            # Using PostgreSQL's JSON operators to extract specific fields
            query = (
                select(
                    WorkflowRunModel.id,
                    WorkflowRunModel.workflow_id,
                    WorkflowRunModel.created_at,
                    # Extract only specific fields from JSON columns
                    # Use TRIM and REPLACE to remove any quotes from JSON values
                    func.coalesce(
                        func.replace(
                            func.replace(
                                func.cast(
                                    WorkflowRunModel.gathered_context[
                                        "mapped_call_disposition"
                                    ],
                                    String,
                                ),
                                '"',
                                "",
                            ),
                            "'",
                            "",
                        ),
                        "UNKNOWN",
                    ).label("disposition"),
                    func.coalesce(
                        func.replace(
                            func.replace(
                                func.cast(
                                    WorkflowRunModel.gathered_context[
                                        "customer_phone_number"
                                    ],
                                    String,
                                ),
                                '"',
                                "",
                            ),
                            "'",
                            "",
                        ),
                        func.replace(
                            func.replace(
                                func.cast(
                                    WorkflowRunModel.initial_context["phone_number"],
                                    String,
                                ),
                                '"',
                                "",
                            ),
                            "'",
                            "",
                        ),
                        "",
                    ).label("phone_number"),
                    func.coalesce(
                        func.replace(
                            func.replace(
                                func.cast(
                                    WorkflowRunModel.usage_info[
                                        "call_duration_seconds"
                                    ],
                                    String,
                                ),
                                '"',
                                "",
                            ),
                            "'",
                            "",
                        ),
                        "0",
                    ).label("call_duration_seconds"),
                    WorkflowModel.name.label("workflow_name"),
                )
                .select_from(WorkflowRunModel)
                .join(WorkflowModel, WorkflowRunModel.workflow_id == WorkflowModel.id)
                .where(
                    and_(
                        WorkflowModel.organization_id == organization_id,
                        WorkflowRunModel.created_at >= start_utc,
                        WorkflowRunModel.created_at <= end_utc,
                    )
                )
            )

            if workflow_id is not None:
                query = query.where(WorkflowRunModel.workflow_id == workflow_id)

            result = await session.execute(query)
            rows = result.all()

            return [
                {
                    "id": row.id,
                    "workflow_id": row.workflow_id,
                    "workflow_name": row.workflow_name,
                    "created_at": row.created_at,
                    "gathered_context": {
                        "mapped_call_disposition": row.disposition,
                        "customer_phone_number": row.phone_number,  # Also provide it here for compatibility
                    },
                    "usage_info": {"call_duration_seconds": row.call_duration_seconds},
                    "initial_context": {"phone_number": row.phone_number},
                }
                for row in rows
            ]

    async def get_workflows_for_organization(
        self, organization_id: int
    ) -> List[WorkflowModel]:
        """
        Get all workflows for an organization.

        Args:
            organization_id: The organization ID
        """
        async with self.async_session() as session:
            query = (
                select(WorkflowModel)
                .where(WorkflowModel.organization_id == organization_id)
                .order_by(WorkflowModel.name)
            )

            result = await session.execute(query)
            return result.scalars().all()

    async def get_workflow_runs_for_analytics(
        self,
        workflow_id: int,
        organization_id: int,
        since: datetime | None,
        limit: int,
        campaign_id: int | None = None,
    ) -> List[Dict[str, Any]]:
        """An agent's recent runs, newest first, with the columns its rollup reads.

        ``campaign_id`` narrows them to one campaign's runs (campaign analytics).
        """
        columns = (
            WorkflowRunModel.id,
            WorkflowRunModel.name,
            WorkflowRunModel.conversation_title,
            WorkflowRunModel.created_at,
            WorkflowRunModel.usage_info,
            WorkflowRunModel.logs,
            WorkflowRunModel.gathered_context,
            WorkflowRunModel.initial_context,
            WorkflowRunModel.annotations,
            # Feeds the read-time preset-name backfill, same source order as the
            # run-detail route: the run's definition, else the workflow.
            WorkflowDefinitionModel.workflow_configurations.label(
                "definition_workflow_configurations"
            ),
            WorkflowModel.workflow_configurations.label(
                "workflow_workflow_configurations"
            ),
        )
        query = (
            select(*columns)
            .join(WorkflowModel, WorkflowRunModel.workflow_id == WorkflowModel.id)
            .outerjoin(
                WorkflowDefinitionModel,
                WorkflowRunModel.definition_id == WorkflowDefinitionModel.id,
            )
            .where(
                WorkflowRunModel.workflow_id == workflow_id,
                WorkflowModel.organization_id == organization_id,
            )
            .order_by(desc(WorkflowRunModel.created_at))
            .limit(limit)
        )
        if since is not None:
            query = query.where(WorkflowRunModel.created_at >= since)
        if campaign_id is not None:
            query = query.where(WorkflowRunModel.campaign_id == campaign_id)
        async with self.async_session() as session:
            result = await session.execute(query)
            return [dict(row) for row in result.mappings().all()]

    async def get_org_stats(
        self, organization_id: int, days: int = 30
    ) -> Dict[str, Any]:
        """Rolling N-day stats for the org dashboard, or all of them for ALL_TIME_DAYS."""
        now = datetime.now(UTC)
        is_all_time = days == ALL_TIME_DAYS

        async with self.async_session() as session:
            if is_all_time:
                first_run = await session.scalar(
                    select(func.min(WorkflowRunModel.created_at))
                    .join(
                        WorkflowModel, WorkflowModel.id == WorkflowRunModel.workflow_id
                    )
                    .where(WorkflowModel.organization_id == organization_id)
                )
                period_start = first_run or now
            else:
                period_start = now - timedelta(days=days)
            prev_start = period_start - timedelta(days=days)

            def _run_q(start, end):
                return (
                    select(
                        cast(WorkflowRunModel.created_at, Date).label("day"),
                        func.count().label("calls"),
                        func.sum(
                            func.coalesce(
                                cast(
                                    text(
                                        "(workflow_runs.usage_info->>'call_duration_seconds')"
                                    ),
                                    Float,
                                ),
                                0.0,
                            )
                        ).label("total_duration"),
                    )
                    .join(
                        WorkflowModel, WorkflowModel.id == WorkflowRunModel.workflow_id
                    )
                    .where(
                        and_(
                            WorkflowModel.organization_id == organization_id,
                            WorkflowRunModel.created_at >= start,
                            WorkflowRunModel.created_at < end,
                        )
                    )
                    .group_by("day")
                    .order_by("day")
                )

            current_rows = (await session.execute(_run_q(period_start, now))).fetchall()
            # All time has no earlier period to compare against.
            prev_rows = (
                []
                if is_all_time
                else (
                    await session.execute(_run_q(prev_start, period_start))
                ).fetchall()
            )

            current_calls = sum(r.calls for r in current_rows)
            prev_calls = sum(r.calls for r in prev_rows)
            total_duration = sum((r.total_duration or 0) for r in current_rows)
            avg_duration = (total_duration / current_calls) if current_calls else 0

            # One row per calendar day through today, including quiet days.
            span_days = (now.date() - period_start.date()).days
            daily: Dict[str, Dict[str, Any]] = {}
            for i in range(span_days + 1):
                d = (period_start + timedelta(days=i)).strftime("%Y-%m-%d")
                daily[d] = {"date": d, "calls": 0, "duration": 0}
            for r in current_rows:
                d = str(r.day)
                if d in daily:
                    daily[d]["calls"] = r.calls
                    daily[d]["duration"] = round(r.total_duration or 0)

            # Duration expression (seconds) reused across per-agent aggregation.
            duration_expr = func.coalesce(
                cast(
                    text("(workflow_runs.usage_info->>'call_duration_seconds')"),
                    Float,
                ),
                0.0,
            )

            def _org_period_query(*columns):
                """Base select over this org's runs within the current period."""
                return (
                    select(*columns)
                    .join(
                        WorkflowModel, WorkflowModel.id == WorkflowRunModel.workflow_id
                    )
                    .where(
                        and_(
                            WorkflowModel.organization_id == organization_id,
                            WorkflowRunModel.created_at >= period_start,
                        )
                    )
                )

            # Top workflows by call count (with average duration for the scatter).
            top_wf_rows = (
                await session.execute(
                    select(
                        WorkflowModel.name,
                        func.count(WorkflowRunModel.id).label("calls"),
                        func.coalesce(func.avg(duration_expr), 0.0).label("avg_dur"),
                    )
                    .join(
                        WorkflowRunModel,
                        WorkflowRunModel.workflow_id == WorkflowModel.id,
                    )
                    .where(
                        and_(
                            WorkflowModel.organization_id == organization_id,
                            WorkflowRunModel.created_at >= period_start,
                        )
                    )
                    .group_by(WorkflowModel.id, WorkflowModel.name)
                    .order_by(desc("calls"))
                    .limit(8)
                )
            ).fetchall()

            # Mode / channel breakdown.
            mode_rows = (
                await session.execute(
                    _org_period_query(
                        WorkflowRunModel.mode, func.count().label("cnt")
                    ).group_by(WorkflowRunModel.mode)
                )
            ).fetchall()

            # Run state (completion funnel) breakdown.
            state_rows = (
                await session.execute(
                    _org_period_query(
                        WorkflowRunModel.state, func.count().label("cnt")
                    ).group_by(WorkflowRunModel.state)
                )
            ).fetchall()

            # Inbound vs outbound breakdown.
            call_type_rows = (
                await session.execute(
                    _org_period_query(
                        WorkflowRunModel.call_type, func.count().label("cnt")
                    ).group_by(WorkflowRunModel.call_type)
                )
            ).fetchall()

            # Calls by hour of day (0–23).
            hour_rows = (
                await session.execute(
                    _org_period_query(
                        func.extract("hour", WorkflowRunModel.created_at).label("hour"),
                        func.count().label("cnt"),
                    ).group_by("hour")
                )
            ).fetchall()
            hourly = [{"hour": h, "calls": 0} for h in range(24)]
            for r in hour_rows:
                idx = int(r.hour)
                if 0 <= idx < 24:
                    hourly[idx]["calls"] = r.cnt

            # Calls by weekday. Postgres dow: 0=Sunday … 6=Saturday.
            dow_rows = (
                await session.execute(
                    _org_period_query(
                        func.extract("dow", WorkflowRunModel.created_at).label("dow"),
                        func.count().label("cnt"),
                    ).group_by("dow")
                )
            ).fetchall()
            weekday_labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
            weekday_counts = {label: 0 for label in weekday_labels}
            for r in dow_rows:
                # Convert Postgres Sun=0..Sat=6 to Mon..Sun ordering.
                label = weekday_labels[(int(r.dow) + 6) % 7]
                weekday_counts[label] = r.cnt

            return {
                "current_calls": current_calls,
                "prev_calls": prev_calls,
                "total_minutes": round(total_duration / 60, 1),
                "avg_duration_seconds": round(avg_duration, 1),
                "daily": list(daily.values()),
                "top_workflows": [
                    {
                        "name": r.name,
                        "calls": r.calls,
                        "avg_duration": round(r.avg_dur or 0, 1),
                    }
                    for r in top_wf_rows
                ],
                "mode_breakdown": [{"mode": r.mode, "count": r.cnt} for r in mode_rows],
                "state_breakdown": [
                    {"state": r.state, "count": r.cnt} for r in state_rows
                ],
                "call_type_breakdown": [
                    {"type": r.call_type, "count": r.cnt} for r in call_type_rows
                ],
                "hourly": hourly,
                "weekday": [
                    {"day": label, "calls": weekday_counts[label]}
                    for label in weekday_labels
                ],
            }
