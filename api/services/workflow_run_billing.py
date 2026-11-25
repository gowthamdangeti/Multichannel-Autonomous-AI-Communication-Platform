"""Workflow-run billing — debit wallet credits on completion.

Thin wrapper: usage math lives in services/billing/metering.py,
balance writes in services/billing/wallet.py. This module only resolves
org + rate and delegates. Safe to call from ARQ (retries are idempotent).
"""
from decimal import Decimal

from loguru import logger
from sqlalchemy import select

from api.db.models import WorkflowRunModel


async def report_workflow_run_platform_usage(workflow_run) -> None:
    """Called inline during pipeline run (no-op kept for compat)."""
    return


async def report_completed_workflow_run_platform_usage(workflow_run_id: int) -> None:
    """Debit wallet for completed run. Idempotent per workflow_run_id."""
    try:
        from api.db.models import BillingPlanModel, OrgWalletModel, WorkflowModel
        from api.services.billing.metering import calc_usage_charge
        from api.services.billing.service import billing_service

        async with billing_service.async_session() as s:
            r = await s.execute(select(WorkflowRunModel).where(WorkflowRunModel.id == workflow_run_id))
            run = r.scalar_one_or_none()
            if not run:
                logger.warning(f"[billing] workflow_run {workflow_run_id} not found, skip debit")
                return
            wr = await s.execute(select(WorkflowModel).where(WorkflowModel.id == run.workflow_id))
            wf = wr.scalar_one_or_none()
            if not wf or not wf.organization_id:
                logger.warning(f"[billing] workflow {run.workflow_id} has no org, skip debit")
                return
            org_id = wf.organization_id
            usage = run.usage_info or {}
            duration_sec = usage.get("call_duration_seconds")
            if duration_sec is None:
                logger.info(f"[billing] run {workflow_run_id} has no call_duration_seconds, skip debit")
                return
            try:
                duration_sec = float(duration_sec)
            except Exception:
                duration_sec = 0
            if duration_sec <= 0:
                logger.info(f"[billing] run {workflow_run_id} duration 0, skip debit")
                return

            # Idempotency fast-path (DB unique constraint is the real guard)
            from api.db.billing_client import billing_client

            if await billing_client.has_usage_debit(workflow_run_id):
                logger.info(f"[billing] run {workflow_run_id} already debited, skip")
                return

            wr2 = await s.execute(select(OrgWalletModel).where(OrgWalletModel.organization_id == org_id))
            wallet = wr2.scalar_one_or_none()
            currency = wallet.currency if wallet else "USD"
            rate = Decimal("0.05")
            if wallet and wallet.billing_plan_id:
                pr = await s.execute(select(BillingPlanModel).where(BillingPlanModel.id == wallet.billing_plan_id))
                plan = pr.scalar_one_or_none()
                if plan:
                    rate = Decimal(str(plan.price_per_extra_minute))
                    currency = plan.currency

            charge = calc_usage_charge(
                duration_sec=duration_sec,
                rate=rate,
                currency=currency,
                workflow_run_id=workflow_run_id,
            )
            logger.info(f"[billing] debit org {org_id} run {workflow_run_id}: {charge.amount} {currency}")

        tx, sufficient = await billing_service.debit_wallet(
            org_id=org_id,
            amount=charge.amount,
            currency=charge.currency,
            description=charge.description,
            workflow_run_id=workflow_run_id,
        )
        if not sufficient:
            logger.warning(f"[billing] org {org_id} wallet exhausted after run {workflow_run_id} balance {tx.balance_after}")
        else:
            logger.info(f"[billing] debited {charge.amount} {charge.currency} org {org_id} run {workflow_run_id} new_balance {tx.balance_after}")

    except Exception as e:
        logger.error(f"[billing] failed to debit run {workflow_run_id}: {e}")
        # don't raise - workflow completion should not fail due to billing
        return
