"""Billing ARQ tasks — usage debit + reconciliation.

Enqueue debit instead of awaiting inline so call completion never blocks on
billing and retries are safe (ledger is idempotent per workflow_run_id).
"""
from loguru import logger


async def debit_workflow_run(_ctx, workflow_run_id: int) -> dict:
    from api.services.workflow_run_billing import (
        report_completed_workflow_run_platform_usage,
    )

    await report_completed_workflow_run_platform_usage(int(workflow_run_id))
    return {"ok": True, "workflow_run_id": int(workflow_run_id)}


async def reconcile_billing(_ctx, older_than_minutes: int = 15) -> dict:
    from api.services.billing.reconciliation import reconcile_stale_intents

    count = await reconcile_stale_intents(older_than_minutes=int(older_than_minutes))
    logger.info(f"[billing] reconcile done, touched={count}")
    return {"ok": True, "touched": count}
