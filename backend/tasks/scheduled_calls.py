"""Dispatch durable outbound calls created by Scheduled Retrigger nodes."""

from fastapi import HTTPException
from loguru import logger

from api.db import db_client


async def dispatch_due_scheduled_calls(_ctx) -> None:
    """Claim and dispatch due calls; concurrent workers cannot claim the same row."""
    scheduled_calls = await db_client.claim_due_scheduled_calls()

    for scheduled_call in scheduled_calls:
        try:
            # Imported lazily to avoid a module cycle: the public route enqueues
            # this task, while this task reuses its organization-scoped call path.
            from api.routes.public_agent import (
                TriggerCallRequest,
                _execute_resolved_target,
                _resolve_trigger_target,
            )

            target = await _resolve_trigger_target(
                scheduled_call.trigger_path,
                scheduled_call.organization_id,
                use_draft=False,
            )
            response = await _execute_resolved_target(
                target,
                TriggerCallRequest(
                    phone_number=scheduled_call.phone_number,
                    initial_context=scheduled_call.initial_context,
                    telephony_configuration_id=(
                        scheduled_call.telephony_configuration_id
                    ),
                ),
                use_draft=False,
                api_key_id=None,
                api_key_created_by=None,
            )
            await db_client.mark_scheduled_call_dispatched(
                scheduled_call.id, response.workflow_run_id
            )
        except HTTPException as exc:
            await db_client.mark_scheduled_call_failed(
                scheduled_call.id, str(exc.detail)
            )
            logger.warning(
                "Scheduled call {} dispatch rejected: {}",
                scheduled_call.id,
                exc.detail,
            )
        except Exception as exc:
            await db_client.mark_scheduled_call_failed(
                scheduled_call.id, str(exc)
            )
            logger.exception(
                "Scheduled call {} dispatch failed", scheduled_call.id
            )
