"""Finish runs whose call ended without the pipeline's completion handler.

A server crash or freeze skips ``on_pipeline_finished``, so the run stays open
and its usage is never fetched. This cron closes those runs. It leaves wallets
alone: such a run's own usage record is partial, so it can't be debited safely.
"""

from datetime import UTC, datetime, timedelta

from loguru import logger

from api.db import db_client
from api.db.models import WorkflowRunModel
from api.enums import WorkflowRunState
from api.tasks.function_names import FunctionNames

DEFAULT_MAX_CALL_SECONDS = 300
# Past a run's own call limit plus this margin, its call can't still be live.
STALE_MARGIN = timedelta(minutes=30)
# Older runs are history; recovering them would rewrite old records.
MAX_RECOVERY_AGE = timedelta(days=7)
INTERRUPTED_DISPOSITION = "pipeline_interrupted"


def get_call_limit(*, run: WorkflowRunModel) -> timedelta:
    configurations = (run.definition.workflow_configurations if run.definition else None) or {}
    seconds = configurations.get("max_call_duration") or DEFAULT_MAX_CALL_SECONDS
    return timedelta(seconds=int(seconds))


def is_past_call_limit(*, run: WorkflowRunModel, now: datetime) -> bool:
    return now - run.created_at > get_call_limit(run=run) + STALE_MARGIN


async def _close_run(*, run: WorkflowRunModel, now: datetime) -> None:
    from api.tasks.arq import enqueue_job  # arq imports this module

    await db_client.update_workflow_run(
        run_id=run.id,
        is_completed=True,
        state=WorkflowRunState.COMPLETED.value,
        gathered_context={"call_disposition": INTERRUPTED_DISPOSITION},
    )
    await enqueue_job(
        FunctionNames.SYNC_PROVIDER_USAGE,
        run.id,
        now.isoformat(),
        _job_id=f"sync-provider-usage-{run.id}",
    )


async def sweep_stuck_runs(ctx: dict) -> dict:
    now = datetime.now(UTC)
    runs = await db_client.list_stuck_runs(
        started_before=now - STALE_MARGIN,
        started_after=now - MAX_RECOVERY_AGE,
    )
    swept = 0
    for run in runs:
        if not is_past_call_limit(run=run, now=now):
            continue
        try:
            await _close_run(run=run, now=now)
            swept += 1
            logger.warning(f"Stuck run sweep: closed run {run.id} from {run.created_at}")
        except Exception as exc:
            logger.error(f"Stuck run sweep: could not close run {run.id}: {exc}")
    return {"swept": swept}
