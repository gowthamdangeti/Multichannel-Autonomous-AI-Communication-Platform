"""ARQ Background Tasks for Email Synchronization, AI Processing, Rules, and Follow-ups."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, UTC
from typing import Any, Dict, List, Optional
from loguru import logger
from sqlalchemy import select, update, and_, delete

from api.db import db_client
from api.db.models import (
    EmailAIRunModel,
    EmailDigestModel,
    EmailFollowUpModel,
    EmailMessageModel,
    EmailRuleExecutionModel,
    EmailRuleModel,
    GmailAccountModel,
    OutlookAccountModel,
)
from api.services.email.ai_service import process_email_ai_pipeline
from api.services.email.gmail_sync import sync_gmail_account
from api.services.email.outlook_sync import sync_outlook_account
from api.services.email.rules_engine import evaluate_rules_for_message
from api.tasks.function_names import FunctionNames


async def sync_gmail_account_task(
    ctx: Dict[str, Any], account_id: int, organization_id: int
) -> Dict[str, Any]:
    """Sync an individual Gmail account and enqueue AI processing for new messages."""
    logger.info(f"[ARQ] Starting sync_gmail_account_task for account={account_id}, org={organization_id}")
    async with db_client.async_session() as session:
        stmt = select(GmailAccountModel).where(
            GmailAccountModel.id == account_id,
            GmailAccountModel.organization_id == organization_id,
        )
        res = await session.execute(stmt)
        account = res.scalar_one_or_none()
        if not account:
            logger.warning(f"[ARQ] Gmail account {account_id} not found in org {organization_id}")
            return {"status": "not_found", "account_id": account_id}

        try:
            result = await sync_gmail_account(
                session=session,
                account=account,
                organization_id=organization_id,
            )
            # Find unprocessed messages for this account and enqueue AI pipeline
            unprocessed_stmt = select(EmailMessageModel.id).where(
                EmailMessageModel.organization_id == organization_id,
                EmailMessageModel.gmail_account_id == account_id,
                EmailMessageModel.ai_category.is_(None),
            ).limit(50)
            unproc_res = await session.execute(unprocessed_stmt)
            new_ids = list(unproc_res.scalars().all())

            if new_ids:
                # Mark as 'processing' immediately to prevent race conditions during rapid auto-sync intervals
                await session.execute(
                    update(EmailMessageModel)
                    .where(EmailMessageModel.id.in_(new_ids))
                    .values(ai_category="processing")
                )
                await session.commit()

            from api.tasks.arq import enqueue_job
            for msg_id in new_ids:
                job = await enqueue_job(
                    FunctionNames.PROCESS_NEW_EMAIL,
                    message_id=msg_id,
                    organization_id=organization_id,
                    _job_id=f"proc_email_{msg_id}",
                )
                if job is None:
                    # ARQ Redis not available - process inline
                    try:
                        await process_new_email({}, message_id=msg_id, organization_id=organization_id)
                    except Exception as p_err:
                        logger.error(f"Inline processing failed for message {msg_id}: {p_err}")

            return {
                "status": "success",
                "account_id": account_id,
                "sync_result": result,
                "enqueued_for_processing": len(new_ids),
            }
        except Exception as exc:
            logger.exception(f"[ARQ] Error syncing Gmail account {account_id}: {exc}")
            try:
                account.status = "error"
                await session.commit()
            except Exception:
                pass
            return {"status": "error", "account_id": account_id, "error": str(exc)}


async def sync_outlook_account_task(
    ctx: Dict[str, Any], account_id: int, organization_id: int
) -> Dict[str, Any]:
    """Sync an individual Outlook account and enqueue AI processing for new messages."""
    logger.info(f"[ARQ] Starting sync_outlook_account_task for account={account_id}, org={organization_id}")
    async with db_client.async_session() as session:
        stmt = select(OutlookAccountModel).where(
            OutlookAccountModel.id == account_id,
            OutlookAccountModel.organization_id == organization_id,
        )
        res = await session.execute(stmt)
        account = res.scalar_one_or_none()
        if not account:
            logger.warning(f"[ARQ] Outlook account {account_id} not found in org {organization_id}")
            return {"status": "not_found", "account_id": account_id}

        try:
            result = await sync_outlook_account(
                session=session,
                account=account,
                organization_id=organization_id,
            )
            unprocessed_stmt = select(EmailMessageModel.id).where(
                EmailMessageModel.organization_id == organization_id,
                EmailMessageModel.outlook_account_id == account_id,
                EmailMessageModel.ai_category.is_(None),
            ).limit(50)
            unproc_res = await session.execute(unprocessed_stmt)
            new_ids = list(unproc_res.scalars().all())

            if new_ids:
                # Mark as 'processing' immediately to prevent race conditions during rapid auto-sync intervals
                await session.execute(
                    update(EmailMessageModel)
                    .where(EmailMessageModel.id.in_(new_ids))
                    .values(ai_category="processing")
                )
                await session.commit()

            from api.tasks.arq import enqueue_job
            for msg_id in new_ids:
                job = await enqueue_job(
                    FunctionNames.PROCESS_NEW_EMAIL,
                    message_id=msg_id,
                    organization_id=organization_id,
                    _job_id=f"proc_email_{msg_id}",
                )
                if job is None:
                    try:
                        await process_new_email({}, message_id=msg_id, organization_id=organization_id)
                    except Exception as p_err:
                        logger.error(f"Inline processing failed for message {msg_id}: {p_err}")

            return {
                "status": "success",
                "account_id": account_id,
                "sync_result": result,
                "enqueued_for_processing": len(new_ids),
            }
        except Exception as exc:
            logger.exception(f"[ARQ] Error syncing Outlook account {account_id}: {exc}")
            try:
                account.status = "error"
                await session.commit()
            except Exception:
                pass
            return {"status": "error", "account_id": account_id, "error": str(exc)}


async def sync_all_email_accounts(ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Scheduled cron worker (every 5 minutes): Enqueues sync for all connected accounts."""
    logger.info("[ARQ] Running sync_all_email_accounts scheduled sweep")
    from api.tasks.arq import enqueue_job

    async with db_client.async_session() as session:
        # 1. Active Gmail accounts
        gmail_stmt = select(GmailAccountModel.id, GmailAccountModel.organization_id).where(
            GmailAccountModel.status.in_(["connected", "syncing"])
        )
        gmail_res = await session.execute(gmail_stmt)
        gmail_accounts = list(gmail_res.all())

        # 2. Active Outlook accounts
        outlook_stmt = select(OutlookAccountModel.id, OutlookAccountModel.organization_id).where(
            OutlookAccountModel.status.in_(["connected", "syncing"])
        )
        outlook_res = await session.execute(outlook_stmt)
        outlook_accounts = list(outlook_res.all())

    enqueued_count = 0
    # Time bucket for job deduplication (2-second bucket for fast auto-sync)
    bucket = int(datetime.now(UTC).timestamp() // 2)

    for acc_id, org_id in gmail_accounts:
        job = await enqueue_job(
            FunctionNames.SYNC_GMAIL_ACCOUNT,
            account_id=acc_id,
            organization_id=org_id,
            _job_id=f"sync_gmail_{acc_id}_{bucket}",
        )
        if job is None:
            try:
                await sync_gmail_account_task({}, account_id=acc_id, organization_id=org_id)
            except Exception as e:
                logger.debug(f"Direct gmail sync error: {e}")
        enqueued_count += 1

    for acc_id, org_id in outlook_accounts:
        job = await enqueue_job(
            FunctionNames.SYNC_OUTLOOK_ACCOUNT,
            account_id=acc_id,
            organization_id=org_id,
            _job_id=f"sync_outlook_{acc_id}_{bucket}",
        )
        if job is None:
            try:
                await sync_outlook_account_task({}, account_id=acc_id, organization_id=org_id)
            except Exception as e:
                logger.debug(f"Direct outlook sync error: {e}")
        enqueued_count += 1

    return {
        "status": "success",
        "gmail_accounts": len(gmail_accounts),
        "outlook_accounts": len(outlook_accounts),
        "total_enqueued": enqueued_count,
    }


async def process_new_email(
    ctx: Dict[str, Any], message_id: int, organization_id: int
) -> Dict[str, Any]:
    """Execute complete processing pipeline: AI classification + summaries + rules engine."""
    logger.info(f"[ARQ] Running process_new_email for message={message_id}, org={organization_id}")
    async with db_client.async_session() as session:
        stmt = select(EmailMessageModel).where(
            EmailMessageModel.id == message_id,
            EmailMessageModel.organization_id == organization_id,
        )
        res = await session.execute(stmt)
        message = res.scalar_one_or_none()
        if not message:
            return {"status": "message_not_found", "message_id": message_id}

        # Step 1: AI Pipeline
        ai_run = await process_email_ai_pipeline(session, message)

        # Step 2: Rules Engine
        rule_executions = await evaluate_rules_for_message(session, message, dry_run=False)
        await session.commit()

        return {
            "status": "success",
            "message_id": message_id,
            "category": message.ai_category,
            "priority": message.ai_priority,
            "ai_run_id": ai_run.id if ai_run else None,
            "rule_executions_count": len(rule_executions),
        }


async def analyze_email(
    ctx: Dict[str, Any], message_id: int, organization_id: int
) -> Dict[str, Any]:
    """Run or re-run AI analysis and reply generation for an email on-demand."""
    logger.info(f"[ARQ] analyze_email for message={message_id}, org={organization_id}")
    async with db_client.async_session() as session:
        stmt = select(EmailMessageModel).where(
            EmailMessageModel.id == message_id,
            EmailMessageModel.organization_id == organization_id,
        )
        res = await session.execute(stmt)
        message = res.scalar_one_or_none()
        if not message:
            return {"status": "not_found", "message_id": message_id}

        ai_run = await process_email_ai_pipeline(session, message)
        await session.commit()
        return {
            "status": "success",
            "message_id": message_id,
            "ai_run_id": ai_run.id,
            "summary": ai_run.summary,
            "draft_reply": ai_run.draft_reply,
        }


async def evaluate_email_rules(
    ctx: Dict[str, Any], message_id: int, organization_id: int
) -> Dict[str, Any]:
    """Evaluate active organization rules for an email message on-demand."""
    logger.info(f"[ARQ] evaluate_email_rules for message={message_id}, org={organization_id}")
    async with db_client.async_session() as session:
        stmt = select(EmailMessageModel).where(
            EmailMessageModel.id == message_id,
            EmailMessageModel.organization_id == organization_id,
        )
        res = await session.execute(stmt)
        message = res.scalar_one_or_none()
        if not message:
            return {"status": "not_found", "message_id": message_id}

        executions = await evaluate_rules_for_message(session, message, dry_run=False)
        await session.commit()
        return {
            "status": "success",
            "message_id": message_id,
            "applied_rules": len(executions),
        }


async def update_followup_status(ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Hourly cron worker: Scans pending follow-ups and flags overdue responses."""
    logger.info("[ARQ] Running update_followup_status hourly check")
    now = datetime.now(UTC)
    updated_count = 0

    async with db_client.async_session() as session:
        stmt = select(EmailFollowUpModel).where(
            EmailFollowUpModel.status.in_(["needs_reply", "awaiting_reply"])
        )
        res = await session.execute(stmt)
        followups = list(res.scalars().all())

        for fup in followups:
            # Overdue if due_date is passed or if older than 3 days without contact
            is_overdue = False
            if fup.due_date and fup.due_date < now:
                is_overdue = True
            elif fup.created_at and (now - fup.created_at) > timedelta(days=3):
                is_overdue = True

            if is_overdue and not (fup.notes and "overdue" in fup.notes.lower()):
                fup.notes = (fup.notes or "") + " [Overdue: Response pending > 3 days]"
                fup.updated_at = now
                updated_count += 1

        if updated_count > 0:
            await session.commit()

    return {"status": "success", "overdue_flagged": updated_count}


async def generate_email_digest(
    ctx: Dict[str, Any], organization_id: Optional[int] = None
) -> Dict[str, Any]:
    """Generate daily digest summary of inbox, pending replies, and key metrics."""
    logger.info(f"[ARQ] generate_email_digest for org={organization_id}")
    now = datetime.now(UTC)
    yesterday = now - timedelta(days=1)

    digests_created = 0
    async with db_client.async_session() as session:
        org_ids = []
        if organization_id:
            org_ids = [organization_id]
        else:
            # Get distinct orgs that have connected email accounts
            q_gmail = select(GmailAccountModel.organization_id).distinct()
            q_outlook = select(OutlookAccountModel.organization_id).distinct()
            res_g = await session.execute(q_gmail)
            res_o = await session.execute(q_outlook)
            org_ids = list(set(res_g.scalars().all()) | set(res_o.scalars().all()))

        for org_id in org_ids:
            # Count received in last 24h
            msg_stmt = select(EmailMessageModel).where(
                EmailMessageModel.organization_id == org_id,
                EmailMessageModel.created_at >= yesterday,
            )
            msg_res = await session.execute(msg_stmt)
            recent_msgs = list(msg_res.scalars().all())

            # Pending followups
            fup_stmt = select(EmailFollowUpModel).where(
                EmailFollowUpModel.organization_id == org_id,
                EmailFollowUpModel.status == "needs_reply",
            )
            fup_res = await session.execute(fup_stmt)
            pending_fups = list(fup_res.scalars().all())

            digest_payload = {
                "total_received_24h": len(recent_msgs),
                "needs_reply_count": len(pending_fups),
                "categories": {},
                "important_subjects": [
                    m.subject for m in recent_msgs if m.ai_priority in ("high", "urgent")
                ][:5],
            }
            for m in recent_msgs:
                cat = m.ai_category or "unclassified"
                digest_payload["categories"][cat] = digest_payload["categories"].get(cat, 0) + 1

            summary_text = (
                f"Inbox summary for {now.strftime('%Y-%m-%d')}: {len(recent_msgs)} new emails, "
                f"{len(pending_fups)} requiring reply, {len(digest_payload['important_subjects'])} high priority."
            )

            digest = EmailDigestModel(
                organization_id=org_id,
                digest_date=now.date(),
                frequency="daily",
                summary=summary_text,
                content=digest_payload,
                unread_count=sum(1 for m in recent_msgs if not m.is_read),
                action_items=[f"Reply to {len(pending_fups)} pending emails"],
            )
            session.add(digest)
            digests_created += 1

        await session.commit()

    return {"status": "success", "digests_created": digests_created}


async def cleanup_email_processing_records(
    ctx: Dict[str, Any], days_to_keep: int = 90
) -> Dict[str, Any]:
    """Purge stale rule execution logs older than retention period."""
    logger.info(f"[ARQ] cleanup_email_processing_records: days_to_keep={days_to_keep}")
    cutoff = datetime.now(UTC) - timedelta(days=days_to_keep)
    deleted_executions = 0

    async with db_client.async_session() as session:
        stmt = delete(EmailRuleExecutionModel).where(
            EmailRuleExecutionModel.executed_at < cutoff
        )
        res = await session.execute(stmt)
        deleted_executions = res.rowcount or 0
        await session.commit()

    return {"status": "success", "deleted_executions": deleted_executions}

