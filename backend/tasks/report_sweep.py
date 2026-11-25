"""Sweep runs whose report generation froze in a non-terminal status.

A run can be left at 'pending'/'processing' when the worker dies mid-job
(OOM, deploy, crash) before a terminal status write. The task itself now
writes 'failed' on cancellation, but a hard kill skips every handler, so
this cron sweep is the last line of defense: anything non-terminal for
longer than STALE_MINUTES becomes 'failed', which re-enables the UI's
Regenerate action (the route 409s while pending/processing).
"""

from datetime import UTC, datetime, timedelta

from loguru import logger

from api.db import db_client

# Must exceed the 900s per-job ARQ budget (generate_run_report /
# generate_campaign_report Function timeouts) plus a safety margin, so the
# sweep never fails a job that is still legitimately running.
STALE_MINUTES = 20


async def sweep_stale_report_generations(ctx) -> dict:
    stale_before = datetime.now(UTC) - timedelta(minutes=STALE_MINUTES)
    try:
        stale_runs = await db_client.get_stale_report_runs(stale_before)
    except Exception as e:
        logger.error(f"Report sweep: failed to query stale runs: {e}")
        return {"swept": 0, "error": str(e)}

    if not stale_runs:
        return {"swept": 0}

    swept = 0
    for run in stale_runs:
        try:
            await db_client.update_workflow_run(
                run_id=run.id, report_generation_status="failed"
            )
            swept += 1
            logger.warning(
                f"Report sweep: run {run.id} stuck at "
                f"'{run.report_generation_status}' since "
                f"{run.report_status_updated_at or run.created_at}; marked failed"
            )
        except Exception as e:
            logger.error(f"Report sweep: failed to mark run {run.id} failed: {e}")

    return {"swept": swept}
