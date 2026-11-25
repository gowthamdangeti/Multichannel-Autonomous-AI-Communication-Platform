"""Public API endpoints for public agent execution, creation, fetching, duplication, updating, deletion, text chat, and complete lifecycle management.

These endpoints are accessible with API key authentication (X-API-Key header).
"""

import inspect
import json
import random
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Any, Awaitable, Callable, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Header, HTTPException, Query
from fastapi.responses import JSONResponse, StreamingResponse
from loguru import logger
from pydantic import BaseModel, Field, ValidationError

from api.db import db_client
from api.db.agent_trigger_client import TriggerPathConflictError
from api.enums import TriggerState, WorkflowStatus
from api.services.quota_service import authorize_workflow_run_start
from api.services.telephony.factory import (
    get_default_telephony_provider,
    get_telephony_provider_by_id,
)
from api.services.configuration.ai_model_configuration import (
    WORKFLOW_PLATFORM_MODEL_CONFIGURATION_ID_KEY,
)
from api.services.workflow.dto import ReactFlowDTO
from api.services.workflow.duplicate import duplicate_workflow
from api.services.workflow.template_generation import (
    WorkflowGenerationError,
    generate_workflow_from_description,
)
from api.services.workflow.text_chat_session_service import (
    TextChatPendingTurnLostError,
    TextChatSessionExecutionError,
    TextChatSessionRevisionConflictError,
    TextChatTurnNotFoundError,
    append_text_chat_user_message,
    default_text_chat_checkpoint,
    default_text_chat_session_data,
    execute_pending_text_chat_turn,
    initialize_text_chat_session,
    normalize_text_chat_checkpoint,
    normalize_text_chat_session_data,
    rewind_text_chat_session_state,
)
from api.services.workflow.trigger_paths import (
    ensure_trigger_paths,
    extract_trigger_paths,
    regenerate_trigger_uuids,
    validate_trigger_paths,
)
from api.services.workflow.workflow_graph import WorkflowGraph
from api.routes.organization_usage import (
    CurrentUsageResponse,
    DailyUsageBreakdownResponse,
    UsageHistoryResponse,
    WorkflowRunUsageResponse,
)
from api.services.reports.run_report import generate_usage_runs_report_csv
from api.services.workflow.conversation_display import resolve_display_title
from api.services.workflow.run_usage_response import (
    format_public_cost_info,
    format_public_usage_info,
)
from api.utils.artifacts import artifact_url
from api.utils.common import get_backend_endpoints
from api.utils.recording_artifacts import (
    get_recording_storage_key,
    has_recording_track,
)

router = APIRouter(prefix="/public/agent")
public_workflow_router = APIRouter(prefix="/public/workflow")
public_organization_router = APIRouter(prefix="/public/organizations")




class TriggerCallRequest(BaseModel):
    """Request model for triggering or scheduling a call via API."""

    phone_number: str = Field(min_length=3, max_length=64)
    initial_context: Optional[dict] = None
    telephony_configuration_id: int | None = None
    scheduled_at: datetime | None = None
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=128)


class TriggerCallResponse(BaseModel):
    """Response model for successful call initiation"""

    status: str
    workflow_run_id: int
    workflow_run_name: str


class ScheduledCallResponse(BaseModel):
    """Response model for a durable future call schedule."""

    status: str
    scheduled_call_id: int
    scheduled_at: datetime


class CreatePublicAgentRequest(BaseModel):
    """Request model for creating an agent/workflow via public API key."""

    name: Optional[str] = Field(default=None, max_length=128)
    description: Optional[str] = Field(default=None, max_length=500)
    system_prompt: Optional[str] = Field(default=None)
    workflow_definition: Optional[dict] = Field(default=None)
    call_type: Optional[str] = Field(default="outbound")
    use_case: Optional[str] = Field(default=None)
    activity_description: Optional[str] = Field(default=None)
    platform_model_configuration_id: Optional[int] = Field(default=None)
    folder_id: Optional[int] = Field(default=None)


class UpdatePublicAgentRequest(BaseModel):
    """Request model for updating an existing agent via public API key."""

    name: Optional[str] = Field(default=None, max_length=128)
    system_prompt: Optional[str] = Field(default=None)
    workflow_definition: Optional[dict] = Field(default=None)
    template_context_variables: Optional[dict] = Field(default=None)
    workflow_configurations: Optional[dict] = Field(default=None)
    platform_model_configuration_id: Optional[int] = Field(default=None)
    folder_id: Optional[int] = Field(default=None)


class UpdatePublicAgentFolderRequest(BaseModel):
    """Request model for updating agent folder assignment."""

    folder_id: Optional[int] = Field(default=None)


class UpdatePublicAgentStatusRequest(BaseModel):
    """Request model for updating agent status (active/archived)."""

    status: str = Field(description="Target status: 'active' or 'archived'")


class DuplicatePublicAgentRequest(BaseModel):
    """Request model for duplicating an agent via public API key."""

    workflow_id: Optional[int] = Field(default=None)
    workflow_uuid: Optional[str] = Field(default=None)
    name: Optional[str] = Field(default=None, max_length=128)


class CreatePublicAgentResponse(BaseModel):
    """Response model for public agent creation, fetching, updating, and duplication."""

    workflow_id: int
    workflow_uuid: str
    name: str
    status: str
    trigger_path: Optional[str] = None
    created_at: datetime
    workflow_definition: Optional[dict] = None
    template_context_variables: Optional[dict] = None
    workflow_configurations: Optional[dict] = None
    folder_id: Optional[int] = None


class PublicAgentCountResponse(BaseModel):
    """Response model for public agent count endpoint."""

    total: int
    active: int
    archived: int


class CreatePublicAgentTextChatSessionRequest(BaseModel):
    """Request model for initiating a text chat session with a public agent."""

    name: Optional[str] = None
    initial_context: Optional[dict] = None
    annotations: Optional[dict] = None


class AppendPublicAgentTextChatMessageRequest(BaseModel):
    """Request model for sending a message in a text chat session."""

    text: str = Field(min_length=1)
    expected_revision: Optional[int] = None


class RewindPublicAgentTextChatSessionRequest(BaseModel):
    """Request model for rewinding a text chat session."""

    cursor_turn_id: Optional[str] = None
    expected_revision: Optional[int] = None


class PublicAgentAmbientNoiseUploadRequest(BaseModel):
    """Request model for requesting ambient noise upload URL."""

    workflow_id: Optional[int] = None
    filename: str
    mime_type: str = "audio/wav"
    file_size: int = Field(..., gt=0, le=10_485_760, description="Max 10MB")


class DuplicatePublicAgentTemplateRequest(BaseModel):
    """Request model for duplicating an agent template."""

    template_id: Optional[int] = None
    workflow_name: Optional[str] = Field(default=None, max_length=128)



@dataclass
class ResolvedAgentTarget:
    workflow: object
    organization_id: int
    identifier_type: str
    identifier_value: str
    trigger_type: str | None = None
    trigger_data: dict | None = None


def _find_trigger_node(workflow_definition: dict, trigger_path: str) -> dict | None:
    for node in workflow_definition.get("nodes", []):
        if node.get("type") not in {"trigger", "retrigger"}:
            continue
        if node.get("data", {}).get("trigger_path") == trigger_path:
            return node
    return None


def trigger_exists_in_workflow(workflow_definition: dict, trigger_path: str) -> bool:
    """Check if trigger node exists in workflow definition."""
    return _find_trigger_node(workflow_definition, trigger_path) is not None


async def _validate_api_key(x_api_key: str):
    """Validate the org API key used to invoke a public agent endpoint."""
    api_key = await db_client.validate_api_key(x_api_key)
    if not api_key:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return api_key


async def _resolve_workflow_by_identifier(identifier: str, organization_id: int):
    """Helper to lookup a workflow by numeric ID, string UUID, or trigger path within org scope."""
    workflow = None
    if identifier.isdigit():
        workflow = await db_client.get_workflow(
            int(identifier), organization_id=organization_id
        )
    if workflow is None:
        workflow = await db_client.get_workflow_by_uuid(
            identifier, organization_id=organization_id
        )
    if workflow is None:
        try:
            trigger_res = db_client.get_agent_trigger_by_path(identifier)
            if inspect.isawaitable(trigger_res):
                trigger = await trigger_res
            else:
                trigger = trigger_res if not hasattr(trigger_res, "_mock_name") else None
            if trigger and getattr(trigger, "organization_id", None) == organization_id:
                workflow = await db_client.get_workflow(
                    trigger.workflow_id, organization_id=organization_id
                )
        except Exception:
            pass
    return workflow



def _ensure_workflow_is_active(workflow) -> None:
    if workflow.status != WorkflowStatus.ACTIVE.value:
        raise HTTPException(status_code=404, detail="Workflow is not active")


def _get_execution_user_id(workflow) -> int:
    if workflow.user_id is None:
        raise HTTPException(
            status_code=409,
            detail="Workflow has no execution owner",
        )
    return workflow.user_id


async def _get_workflow_definition_for_execution(workflow, *, use_draft: bool) -> dict:
    """Return the definition that would execute for this public agent request."""
    if use_draft:
        draft = await db_client.get_draft_version(workflow.id)
        if draft:
            return draft.workflow_json

    if workflow.released_definition is None:
        raise HTTPException(
            status_code=404, detail="Workflow has no published definition"
        )

    return workflow.released_definition.workflow_json


async def _resolve_trigger_target(
    trigger_path: str,
    organization_id: int,
    *,
    use_draft: bool,
) -> ResolvedAgentTarget:
    """Resolve a trigger UUID to a workflow, scoped to the API key's org."""
    trigger = await db_client.get_agent_trigger_by_path(trigger_path)
    if not trigger:
        raise HTTPException(status_code=404, detail="Agent trigger not found")

    if organization_id != trigger.organization_id:
        raise HTTPException(status_code=403, detail="Access denied")

    if trigger.state != TriggerState.ACTIVE.value:
        raise HTTPException(status_code=404, detail="Agent trigger is not active")

    workflow = await db_client.get_workflow(
        trigger.workflow_id,
        organization_id=organization_id,
    )
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    _ensure_workflow_is_active(workflow)
    workflow_definition = await _get_workflow_definition_for_execution(
        workflow,
        use_draft=use_draft,
    )
    trigger_node = _find_trigger_node(workflow_definition, trigger_path)
    if not trigger_node or not trigger_node.get("data", {}).get("enabled", True):
        raise HTTPException(
            status_code=404,
            detail="Trigger not found in the selected Agent",
        )

    return ResolvedAgentTarget(
        workflow=workflow,
        organization_id=organization_id,
        identifier_type="trigger_path",
        identifier_value=trigger_path,
        trigger_type=trigger_node.get("type"),
        trigger_data=trigger_node.get("data", {}),
    )


async def _resolve_workflow_uuid_target(
    workflow_uuid: str,
    organization_id: int,
    *,
    use_draft: bool,
) -> ResolvedAgentTarget:
    """Resolve a workflow UUID directly, scoped to the API key's org."""
    workflow = await db_client.get_workflow_by_uuid(workflow_uuid, organization_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    _ensure_workflow_is_active(workflow)
    await _get_workflow_definition_for_execution(workflow, use_draft=use_draft)

    return ResolvedAgentTarget(
        workflow=workflow,
        organization_id=organization_id,
        identifier_type="workflow_uuid",
        identifier_value=workflow_uuid,
    )


async def _execute_resolved_target(
    target: ResolvedAgentTarget,
    request: TriggerCallRequest,
    *,
    use_draft: bool,
    api_key_id: int | None,
    api_key_created_by: int | None,
) -> TriggerCallResponse:
    """Shared execution path once the target workflow has been resolved."""
    execution_user_id = _get_execution_user_id(target.workflow)

    if request.telephony_configuration_id is not None:
        cfg = await db_client.get_telephony_configuration_for_org(
            request.telephony_configuration_id,
            target.organization_id,
        )
        if not cfg:
            raise HTTPException(
                status_code=404, detail="Telephony configuration not found"
            )
        try:
            provider = await get_telephony_provider_by_id(
                cfg.id, target.organization_id
            )
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail="Telephony provider not configured for this configuration",
            )
        resolved_cfg_id = cfg.id
    else:
        try:
            provider = await get_default_telephony_provider(target.organization_id)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail="Telephony provider not configured for this organization",
            )
        default_cfg = await db_client.get_default_telephony_configuration(
            target.organization_id
        )
        resolved_cfg_id = default_cfg.id if default_cfg else None

    if not provider.validate_config():
        raise HTTPException(
            status_code=400,
            detail="Telephony provider not configured for this organization",
        )

    workflow_run_mode = provider.PROVIDER_NAME

    mode_label = "TEST" if use_draft else "API"
    workflow_run_name = f"WR-{mode_label}-{random.randint(1000, 9999)}"
    initial_context = {
        "provider": provider.PROVIDER_NAME,
        "phone_number": request.phone_number,
        "trigger_mode": "test" if use_draft else "production",
        "telephony_configuration_id": resolved_cfg_id,
        "agent_identifier": target.identifier_value,
        "agent_identifier_type": target.identifier_type,
        "workflow_uuid": target.workflow.workflow_uuid,
    }
    if target.identifier_type == "trigger_path":
        initial_context["agent_uuid"] = target.identifier_value
    if api_key_id is not None:
        initial_context["api_key_id"] = api_key_id
    if api_key_created_by is not None:
        initial_context["api_key_created_by"] = api_key_created_by
    initial_context.update(request.initial_context or {})

    workflow_run = await db_client.create_workflow_run(
        name=workflow_run_name,
        workflow_id=target.workflow.id,
        mode=workflow_run_mode,
        initial_context=initial_context,
        user_id=execution_user_id,
        use_draft=use_draft,
        organization_id=target.organization_id,
    )

    logger.info(
        f"Created workflow run {workflow_run.id} for public agent "
        f"{target.identifier_type}={target.identifier_value} "
        f"(mode={'test' if use_draft else 'production'}) "
        f"to phone number {request.phone_number}"
    )

    quota_result = await authorize_workflow_run_start(
        workflow_id=target.workflow.id,
        workflow_run_id=workflow_run.id,
    )
    if not quota_result.has_quota:
        raise HTTPException(status_code=402, detail=quota_result.error_message)

    backend_endpoint, _ = await get_backend_endpoints()
    webhook_endpoint = provider.WEBHOOK_ENDPOINT

    webhook_url = (
        f"{backend_endpoint}/api/v1/telephony/{webhook_endpoint}"
        f"?workflow_id={target.workflow.id}"
        f"&user_id={execution_user_id}"
        f"&workflow_run_id={workflow_run.id}"
        f"&organization_id={target.organization_id}"
    )

    try:
        await provider.initiate_call(
            to_number=request.phone_number,
            webhook_url=webhook_url,
            workflow_run_id=workflow_run.id,
            workflow_id=target.workflow.id,
            user_id=execution_user_id,
        )
    except Exception as e:
        logger.warning(
            f"Failed to initiate call for workflow run {workflow_run.id}: {e}"
        )
        raise HTTPException(
            status_code=400,
            detail=f"Failed to initiate call: {e}",
        )

    logger.info(
        f"Call initiated successfully for workflow run {workflow_run.id} "
        f"via {target.identifier_type}={target.identifier_value}"
    )

    return TriggerCallResponse(
        status="initiated",
        workflow_run_id=workflow_run.id,
        workflow_run_name=workflow_run_name,
    )


async def _enqueue_scheduled_dispatch(scheduled_at: datetime) -> None:
    from api.tasks.arq import enqueue_job
    from api.tasks.function_names import FunctionNames

    await enqueue_job(
        FunctionNames.DISPATCH_DUE_SCHEDULED_CALLS,
        _defer_until=scheduled_at,
    )


def _compute_effective_schedule(
    trigger_data: dict,
    *,
    requested_at: datetime | None,
    now: datetime | None = None,
) -> datetime:
    """Compute and validate a Scheduled Retrigger's effective UTC call time."""
    current_time = (now or datetime.now(UTC)).astimezone(UTC)
    mode = trigger_data.get("schedule_mode", "request_time")

    try:
        max_future_days = int(trigger_data.get("max_future_days", 365))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail="max_future_days must be an integer") from exc
    if not 1 <= max_future_days <= 3650:
        raise HTTPException(
            status_code=422, detail="max_future_days must be between 1 and 3650"
        )

    if mode == "request_time":
        if requested_at is None or requested_at.utcoffset() is None:
            raise HTTPException(
                status_code=422,
                detail="scheduled_at must be an ISO 8601 timestamp with a UTC offset",
            )
        scheduled_at = requested_at.astimezone(UTC)
    elif mode == "delay":
        if requested_at is not None:
            raise HTTPException(
                status_code=422,
                detail="scheduled_at must not be provided when schedule_mode is delay",
            )
        try:
            delay_seconds = int(trigger_data.get("schedule_offset_seconds", 3600))
        except (TypeError, ValueError) as exc:
            raise HTTPException(
                status_code=422, detail="schedule_offset_seconds must be an integer"
            ) from exc
        if not 1 <= delay_seconds <= 604800:
            raise HTTPException(
                status_code=422,
                detail="schedule_offset_seconds must be between 1 and 604800",
            )
        scheduled_at = current_time + timedelta(seconds=delay_seconds)
    elif mode in {"date_at", "tomorrow_at"}:
        if requested_at is not None:
            raise HTTPException(
                status_code=422,
                detail=f"scheduled_at must not be provided when schedule_mode is {mode}",
            )
        schedule_time = trigger_data.get("schedule_time", "18:00")
        try:
            local_time = time.fromisoformat(schedule_time)
        except (TypeError, ValueError) as exc:
            raise HTTPException(
                status_code=422, detail="schedule_time must use 24-hour HH:MM format"
            ) from exc
        if local_time.second or local_time.microsecond or local_time.tzinfo is not None:
            raise HTTPException(
                status_code=422, detail="schedule_time must use 24-hour HH:MM format"
            )

        timezone_name = trigger_data.get("schedule_timezone", "UTC")
        try:
            timezone = ZoneInfo(timezone_name)
        except (TypeError, ZoneInfoNotFoundError) as exc:
            raise HTTPException(
                status_code=422, detail="schedule_timezone must be a valid IANA timezone"
            ) from exc

        if mode == "date_at":
            try:
                local_date = date.fromisoformat(trigger_data.get("schedule_date", ""))
            except (TypeError, ValueError) as exc:
                raise HTTPException(
                    status_code=422, detail="schedule_date must use YYYY-MM-DD format"
                ) from exc
        else:
            local_date = current_time.astimezone(timezone).date() + timedelta(days=1)

        local_scheduled_at = datetime.combine(local_date, local_time, tzinfo=timezone)
        scheduled_at = local_scheduled_at.astimezone(UTC)
        if scheduled_at.astimezone(timezone).replace(tzinfo=None) != local_scheduled_at.replace(
            tzinfo=None
        ):
            raise HTTPException(
                status_code=422,
                detail="schedule_time does not exist on schedule_date in schedule_timezone",
            )
    else:
        raise HTTPException(status_code=422, detail="Unsupported schedule_mode")

    if scheduled_at <= current_time:
        raise HTTPException(status_code=422, detail="scheduled_at must be in the future")
    if scheduled_at > current_time + timedelta(days=max_future_days):
        raise HTTPException(
            status_code=422,
            detail=f"scheduled_at cannot be more than {max_future_days} days ahead",
        )
    return scheduled_at


async def _schedule_resolved_target(
    target: ResolvedAgentTarget,
    request: TriggerCallRequest,
) -> ScheduledCallResponse:
    trigger_data = target.trigger_data or {}
    scheduled_at = _compute_effective_schedule(
        trigger_data,
        requested_at=request.scheduled_at,
    )
    if not request.idempotency_key:
        request.idempotency_key = str(uuid.uuid4())
    initial_context = request.initial_context or {}
    if len(json.dumps(initial_context, ensure_ascii=False).encode("utf-8")) > 65_536:
        raise HTTPException(
            status_code=422, detail="initial_context cannot exceed 64 KiB"
        )
    if request.telephony_configuration_id is not None:
        configuration = await db_client.get_telephony_configuration_for_org(
            request.telephony_configuration_id, target.organization_id
        )
        if not configuration:
            raise HTTPException(
                status_code=404, detail="Telephony configuration not found"
            )
        try:
            provider = await get_telephony_provider_by_id(
                configuration.id, target.organization_id
            )
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail="Telephony provider not configured for this configuration",
            )
    else:
        try:
            provider = await get_default_telephony_provider(target.organization_id)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail="Telephony provider not configured for this organization",
            )
    if not provider.validate_config():
        raise HTTPException(
            status_code=400,
            detail="Telephony provider not configured for this organization",
        )

    try:
        max_attempts = int(trigger_data.get("max_attempts", 3))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail="max_attempts must be an integer") from exc
    if not 1 <= max_attempts <= 10:
        raise HTTPException(
            status_code=422, detail="max_attempts must be between 1 and 10"
        )
    retry_strategy = trigger_data.get("retry_strategy", "linear")
    if retry_strategy not in {"linear", "exponential"}:
        raise HTTPException(
            status_code=422, detail="retry_strategy must be linear or exponential"
        )
    try:
        retry_interval_seconds = int(trigger_data.get("retry_interval_seconds", 3600))
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=422, detail="retry_interval_seconds must be an integer"
        ) from exc
    if not 1 <= retry_interval_seconds <= 604800:
        raise HTTPException(
            status_code=422,
            detail="retry_interval_seconds must be between 1 and 604800",
        )

    scheduled_call, created = await db_client.create_scheduled_call(
        organization_id=target.organization_id,
        target_workflow_id=target.workflow.id,
        trigger_path=target.identifier_value,
        phone_number=request.phone_number,
        initial_context=initial_context,
        telephony_configuration_id=request.telephony_configuration_id,
        scheduled_at=scheduled_at,
        idempotency_key=request.idempotency_key,
        max_attempts=max_attempts,
        retry_strategy=retry_strategy,
        retry_interval_seconds=retry_interval_seconds,
    )
    if not created:
        same_request = (
            scheduled_call.target_workflow_id == target.workflow.id
            and scheduled_call.trigger_path == target.identifier_value
            and scheduled_call.phone_number == request.phone_number
            and scheduled_call.initial_context == initial_context
            and scheduled_call.telephony_configuration_id
            == request.telephony_configuration_id
            and (
                trigger_data.get("schedule_mode", "request_time") != "request_time"
                or scheduled_call.scheduled_at == scheduled_at
            )
        )
        if not same_request:
            raise HTTPException(
                status_code=409,
                detail="idempotency_key is already used by a different schedule",
            )
    else:
        await _enqueue_scheduled_dispatch(scheduled_at)
    response_status = (
        "scheduled"
        if scheduled_call.status in {"pending", "processing", "retry"}
        else scheduled_call.status
    )
    return ScheduledCallResponse(
        status=response_status,
        scheduled_call_id=scheduled_call.id,
        scheduled_at=scheduled_call.scheduled_at,
    )


async def _initiate_call(
    identifier: str,
    request: TriggerCallRequest,
    x_api_key: str,
    *,
    use_draft: bool,
    target_resolver: Callable[..., Awaitable[ResolvedAgentTarget]],
) -> TriggerCallResponse | ScheduledCallResponse:
    """Resolve the requested public target, then schedule or execute it."""
    api_key = await _validate_api_key(x_api_key)
    target = await target_resolver(
        identifier,
        api_key.organization_id,
        use_draft=use_draft,
    )
    if target.trigger_type == "retrigger":
        if use_draft:
            raise HTTPException(
                status_code=422, detail="Scheduled Retrigger does not support test mode"
            )
        return await _schedule_resolved_target(target, request)
    if request.scheduled_at is not None:
        raise HTTPException(
            status_code=422,
            detail="scheduled_at is only supported by Scheduled Retrigger nodes",
        )
    return await _execute_resolved_target(
        target,
        request,
        use_draft=use_draft,
        api_key_id=api_key.id,
        api_key_created_by=api_key.created_by,
    )


def _build_default_workflow_definition(system_prompt: str | None = None) -> dict:
    prompt_text = system_prompt or "You are a helpful AI phone assistant."
    trigger_uuid = str(uuid.uuid4())
    return {
        "nodes": [
            {
                "id": "trigger-1",
                "type": "trigger",
                "position": {"x": 250, "y": 30},
                "data": {
                    "name": "API Trigger",
                    "trigger_path": trigger_uuid,
                    "enabled": True,
                },
            },
            {
                "id": "start-1",
                "type": "startCall",
                "position": {"x": 250, "y": 180},
                "data": {
                    "name": "Start Call",
                    "prompt": prompt_text,
                    "is_start": True,
                    "allow_interrupt": True,
                },
            },
            {
                "id": "end-1",
                "type": "endCall",
                "position": {"x": 250, "y": 350},
                "data": {
                    "name": "End Call",
                    "prompt": "Call ended.",
                    "is_end": True,
                },
            },
        ],
        "edges": [
            {
                "id": "edge-start-end",
                "source": "start-1",
                "target": "end-1",
                "data": {"label": "Hangup", "condition": "User ends call"},
            }
        ],
    }


def _validate_workflow_definition(workflow_definition: dict | None) -> list[str]:
    """Validate ReactFlow DTO and WorkflowGraph invariants cleanly."""
    if not workflow_definition:
        return []

    errors: list[str] = []
    dto: ReactFlowDTO | None = None
    try:
        dto = ReactFlowDTO.model_validate(workflow_definition)
    except ValidationError as exc:
        for err in exc.errors():
            loc = " -> ".join(str(l) for l in err.get("loc", []))
            errors.append(f"{loc}: {err.get('msg')}")

    if dto:
        try:
            WorkflowGraph(dto)
        except ValueError as exc:
            if isinstance(exc.args[0], list):
                for item in exc.args[0]:
                    if hasattr(item, "message"):
                        errors.append(item.message)
                    else:
                        errors.append(str(item))
            else:
                errors.append(str(exc))

    return errors


@router.get("/count", response_model=PublicAgentCountResponse)
async def get_public_agent_count(
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    """Get workflow/agent count statistics for the API key's organization."""
    api_key = await _validate_api_key(x_api_key)
    counts = await db_client.get_workflow_counts(
        organization_id=api_key.organization_id
    )
    return PublicAgentCountResponse(
        total=counts.get("total", 0),
        active=counts.get("active", 0),
        archived=counts.get("archived", 0),
    )


@router.get("/summary")
async def get_public_agents_summary(
    status: Optional[str] = Query(None),
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    """Get minimal summary (id, workflow_uuid, name, status) for all public agents."""
    api_key = await _validate_api_key(x_api_key)
    workflows = await db_client.get_all_workflows(
        organization_id=api_key.organization_id, status=status
    )
    return [
        {
            "id": wf.id,
            "workflow_uuid": wf.workflow_uuid,
            "name": wf.name,
            "status": wf.status,
        }
        for wf in workflows
    ]
@router.get("/templates")
async def get_public_agent_templates(
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    """Get all available public agent templates."""
    from api.db.workflow_template_client import WorkflowTemplateClient

    await _validate_api_key(x_api_key)
    template_client = WorkflowTemplateClient()
    templates = await template_client.get_all_workflow_templates()
    return [
        {
            "id": template.id,
            "template_name": template.template_name,
            "template_description": template.template_description,
            "template_json": template.template_json,
            "created_at": template.created_at,
        }
        for template in templates
    ]


@router.post("/templates/duplicate", response_model=CreatePublicAgentResponse)
@router.post("/templates/{template_id}/duplicate", response_model=CreatePublicAgentResponse)
@router.post("/create/template/{template_id}", response_model=CreatePublicAgentResponse)
async def duplicate_public_agent_template(
    template_id: Optional[int] = None,
    request: Optional[DuplicatePublicAgentTemplateRequest] = None,
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    """Duplicate an agent template to create a new public agent."""
    from api.db.workflow_template_client import WorkflowTemplateClient

    api_key = await _validate_api_key(x_api_key)
    user_id = api_key.created_by
    if not user_id:
        raise HTTPException(status_code=401, detail="API key has no associated user")

    target_template_id = template_id
    custom_name = None
    if request:
        if request.template_id:
            target_template_id = request.template_id
        if request.workflow_name:
            custom_name = request.workflow_name

    if not target_template_id:
        raise HTTPException(status_code=400, detail="Must provide template_id")

    template_client = WorkflowTemplateClient()
    template = await template_client.get_workflow_template(target_template_id)
    if not template:
        raise HTTPException(
            status_code=404,
            detail=f"Workflow template with id {target_template_id} not found",
        )

    workflow_def = regenerate_trigger_uuids(template.template_json)
    trigger_paths = extract_trigger_paths(workflow_def) if workflow_def else []
    if trigger_paths:
        try:
            await db_client.assert_trigger_paths_available(trigger_paths=trigger_paths)
        except TriggerPathConflictError as e:
            raise HTTPException(status_code=409, detail=str(e))

    agent_name = custom_name or template.template_name or "Template Voice Agent"

    workflow = await db_client.create_workflow(
        name=agent_name,
        workflow_definition=workflow_def,
        user_id=user_id,
        organization_id=api_key.organization_id,
    )

    if trigger_paths:
        await db_client.sync_triggers_for_workflow(
            workflow_id=workflow.id,
            organization_id=api_key.organization_id,
            trigger_paths=trigger_paths,
        )

    primary_trigger = trigger_paths[0] if trigger_paths else None

    return CreatePublicAgentResponse(
        workflow_id=workflow.id,
        workflow_uuid=workflow.workflow_uuid,
        name=workflow.name,
        status=workflow.status,
        trigger_path=primary_trigger,
        created_at=workflow.created_at,
        workflow_definition=workflow_def,
        template_context_variables=getattr(workflow, "template_context_variables", None),
        workflow_configurations=getattr(workflow, "workflow_configurations", None),
        folder_id=getattr(workflow, "folder_id", None),
    )


@router.post("/create", response_model=CreatePublicAgentResponse)
@router.post("", response_model=CreatePublicAgentResponse)
async def create_public_agent(
    request: CreatePublicAgentRequest,
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    """Create a new public AI agent/workflow using API key authentication."""
    api_key = await _validate_api_key(x_api_key)
    user_id = api_key.created_by
    if not user_id:
        raise HTTPException(status_code=401, detail="API key has no associated user")

    # Free tier: 1 agent total — creation guard only, run path untouched.
    from api.services.billing.agent_limits import agent_limit_guard

    await agent_limit_guard.assert_can_create_agent(
        api_key.organization_id, kind="voice"
    )

    agent_name = request.name

    if request.workflow_definition:
        workflow_definition = request.workflow_definition
    elif request.use_case or request.activity_description:
        try:
            generated_name, gen_def = await generate_workflow_from_description(
                call_type=request.call_type or "outbound",
                use_case=request.use_case or agent_name or "Voice Agent",
                activity_description=request.activity_description
                or request.system_prompt
                or request.description
                or "Voice AI Assistant",
                organization_id=api_key.organization_id,
                user_id=user_id,
            )
            workflow_definition = regenerate_trigger_uuids(gen_def)
            if not agent_name:
                agent_name = generated_name
        except WorkflowGenerationError as e:
            logger.warning(
                f"AI workflow generation failed: {e}. Falling back to default definition."
            )
            workflow_definition = _build_default_workflow_definition(
                request.system_prompt or request.description
            )
    else:
        workflow_definition = _build_default_workflow_definition(
            request.system_prompt or request.description
        )

    if not agent_name:
        agent_name = "Public Voice Agent"

    has_trigger = any(
        node.get("type") in {"trigger", "retrigger"}
        for node in (workflow_definition.get("nodes") or [])
    )
    if not has_trigger:
        trigger_uuid = str(uuid.uuid4())
        workflow_definition.setdefault("nodes", []).insert(
            0,
            {
                "id": "trigger-1",
                "type": "trigger",
                "position": {"x": 250, "y": 30},
                "data": {
                    "name": "API Trigger",
                    "trigger_path": trigger_uuid,
                    "enabled": True,
                },
            },
        )

    workflow_definition = ensure_trigger_paths(workflow_definition)
    trigger_path_issues = validate_trigger_paths(workflow_definition)
    if trigger_path_issues:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid trigger path: {[issue.message for issue in trigger_path_issues]}",
        )

    validation_errors = _validate_workflow_definition(workflow_definition)
    if validation_errors:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid workflow definition: {validation_errors}",
        )

    trigger_paths = (
        extract_trigger_paths(workflow_definition) if workflow_definition else []
    )
    if trigger_paths:
        try:
            await db_client.assert_trigger_paths_available(trigger_paths=trigger_paths)
        except TriggerPathConflictError as e:
            raise HTTPException(
                status_code=409,
                detail=f"Trigger path conflict: {e}",
            )

    template_context_variables = {}
    try:
        wf_graph = WorkflowGraph(ReactFlowDTO.model_validate(workflow_definition))
        template_context_variables = {
            var_name: ""
            for var_name in sorted(wf_graph.get_required_template_variables())
        }
    except Exception:
        pass

    workflow_configurations = None
    if request.platform_model_configuration_id is not None:
        workflow_configurations = {
            WORKFLOW_PLATFORM_MODEL_CONFIGURATION_ID_KEY: (
                request.platform_model_configuration_id
            )
        }

    workflow = await db_client.create_workflow(
        name=agent_name,
        workflow_definition=workflow_definition,
        user_id=user_id,
        organization_id=api_key.organization_id,
        workflow_configurations=workflow_configurations,
        template_context_variables=template_context_variables,
    )

    if request.folder_id is not None:
        workflow = await db_client.update_workflow(
            workflow_id=workflow.id,
            folder_id=request.folder_id,
            organization_id=api_key.organization_id,
        )

    if trigger_paths:
        await db_client.sync_triggers_for_workflow(
            workflow_id=workflow.id,
            organization_id=api_key.organization_id,
            trigger_paths=trigger_paths,
        )

    primary_trigger = trigger_paths[0] if trigger_paths else None

    return CreatePublicAgentResponse(
        workflow_id=workflow.id,
        workflow_uuid=workflow.workflow_uuid,
        name=workflow.name,
        status=workflow.status,
        trigger_path=primary_trigger,
        created_at=workflow.created_at,
        workflow_definition=workflow_definition,
        template_context_variables=getattr(
            workflow, "template_context_variables", None
        )
        or template_context_variables,
        workflow_configurations=getattr(
            workflow, "workflow_configurations", None
        )
        or workflow_configurations,
        folder_id=getattr(workflow, "folder_id", None),
    )


@router.get("/fetch", response_model=list[CreatePublicAgentResponse])
@router.get("/list", response_model=list[CreatePublicAgentResponse])
@router.get("", response_model=list[CreatePublicAgentResponse])
async def list_public_agents(
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    """List all public agents for the authenticated API key's organization."""
    api_key = await _validate_api_key(x_api_key)
    workflows = await db_client.get_all_workflows_for_listing(
        organization_id=api_key.organization_id, status=None
    )
    results = []
    for wf in workflows:
        full_wf = await db_client.get_workflow(
            wf.id, organization_id=api_key.organization_id
        )
        if not full_wf:
            continue
        draft = await db_client.get_draft_version(full_wf.id)
        if draft:
            wf_def = draft.workflow_json
            wf_cfg = draft.workflow_configurations
            tmpl_vars = draft.template_context_variables
        elif full_wf.released_definition:
            wf_def = full_wf.released_definition.workflow_json
            wf_cfg = full_wf.released_definition.workflow_configurations
            tmpl_vars = full_wf.released_definition.template_context_variables
        else:
            wf_def = {}
            wf_cfg = getattr(full_wf, "workflow_configurations", None)
            tmpl_vars = getattr(full_wf, "template_context_variables", None)

        trigger_paths = extract_trigger_paths(wf_def) if wf_def else []
        primary_trigger = trigger_paths[0] if trigger_paths else None

        results.append(
            CreatePublicAgentResponse(
                workflow_id=full_wf.id,
                workflow_uuid=full_wf.workflow_uuid,
                name=full_wf.name,
                status=full_wf.status,
                trigger_path=primary_trigger,
                created_at=full_wf.created_at,
                workflow_definition=wf_def,
                template_context_variables=tmpl_vars,
                workflow_configurations=wf_cfg,
            )
        )
    return results


@router.get("/fetch/{identifier}", response_model=CreatePublicAgentResponse)
@router.post("/fetch/{identifier}", response_model=CreatePublicAgentResponse)
@router.get("/details/{identifier}", response_model=CreatePublicAgentResponse)
@router.get("/{identifier}", response_model=CreatePublicAgentResponse)
async def fetch_public_agent(
    identifier: str,
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    """Fetch public agent details by workflow ID or workflow UUID using API key."""
    api_key = await _validate_api_key(x_api_key)
    workflow = await _resolve_workflow_by_identifier(identifier, api_key.organization_id)
    if workflow is None:
        raise HTTPException(status_code=404, detail="Agent workflow not found")

    draft = await db_client.get_draft_version(workflow.id)
    if draft:
        workflow_def = draft.workflow_json
        workflow_configs = draft.workflow_configurations
        template_vars = draft.template_context_variables
    elif workflow.released_definition:
        workflow_def = workflow.released_definition.workflow_json
        workflow_configs = workflow.released_definition.workflow_configurations
        template_vars = workflow.released_definition.template_context_variables
    else:
        workflow_def = {}
        workflow_configs = getattr(workflow, "workflow_configurations", None)
        template_vars = getattr(workflow, "template_context_variables", None)

    trigger_paths = extract_trigger_paths(workflow_def) if workflow_def else []
    primary_trigger = trigger_paths[0] if trigger_paths else None

    return CreatePublicAgentResponse(
        workflow_id=workflow.id,
        workflow_uuid=workflow.workflow_uuid,
        name=workflow.name,
        status=workflow.status,
        trigger_path=primary_trigger,
        created_at=workflow.created_at,
        workflow_definition=workflow_def,
        template_context_variables=template_vars,
        workflow_configurations=workflow_configs,
    )


@router.get("/runs/{run_id}")
async def get_public_agent_run(
    run_id: int,
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    """Get details for a specific run by run ID."""
    api_key = await _validate_api_key(x_api_key)
    run = await db_client.get_workflow_run_by_id(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Workflow run not found")
    if getattr(run, "organization_id", None) and run.organization_id != api_key.organization_id:
        raise HTTPException(status_code=403, detail="Access denied")

    return {
        "id": run.id,
        "workflow_id": run.workflow_id,
        "name": run.name,
        "conversation_title": resolve_display_title(
            getattr(run, "conversation_title", None),
            getattr(getattr(run, "workflow", None), "name", None),
            getattr(run, "name", None),
        ),
        "mode": run.mode,
        "created_at": run.created_at,
        "initial_context": run.initial_context,
    }


@router.put("/update/{identifier}", response_model=CreatePublicAgentResponse)
@router.put("/{identifier}", response_model=CreatePublicAgentResponse)
@router.patch("/{identifier}", response_model=CreatePublicAgentResponse)
async def update_public_agent(
    identifier: str,
    request: UpdatePublicAgentRequest,
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    """Update an existing agent/workflow name, definition, or configurations."""
    api_key = await _validate_api_key(x_api_key)
    workflow = await _resolve_workflow_by_identifier(identifier, api_key.organization_id)
    if workflow is None:
        raise HTTPException(status_code=404, detail="Agent workflow not found")

    workflow_definition = request.workflow_definition
    if workflow_definition is not None:
        workflow_definition = ensure_trigger_paths(workflow_definition)
        trigger_path_issues = validate_trigger_paths(workflow_definition)
        if trigger_path_issues:
            raise HTTPException(
                status_code=422,
                detail=f"Invalid trigger path: {[issue.message for issue in trigger_path_issues]}",
            )
        trigger_paths = extract_trigger_paths(workflow_definition)
        if trigger_paths:
            try:
                await db_client.assert_trigger_paths_available(
                    trigger_paths=trigger_paths,
                    exclude_workflow_id=workflow.id,
                )
            except TriggerPathConflictError as e:
                raise HTTPException(
                    status_code=409,
                    detail=f"Trigger path conflict: {e}",
                )
    elif request.system_prompt:
        draft = await db_client.get_draft_version(workflow.id)
        current_def = (
            draft.workflow_json
            if draft
            else (
                workflow.released_definition.workflow_json
                if workflow.released_definition
                else None
            )
        )
        if current_def:
            workflow_definition = json.loads(json.dumps(current_def))
            for node in workflow_definition.get("nodes", []):
                if node.get("type") == "startCall":
                    node.setdefault("data", {})["prompt"] = request.system_prompt
        else:
            workflow_definition = _build_default_workflow_definition(
                request.system_prompt
            )

    workflow_configurations = request.workflow_configurations
    if request.platform_model_configuration_id is not None:
        workflow_configurations = workflow_configurations or {}
        workflow_configurations[WORKFLOW_PLATFORM_MODEL_CONFIGURATION_ID_KEY] = (
            request.platform_model_configuration_id
        )

    updated_workflow = await db_client.update_workflow(
        workflow_id=workflow.id,
        name=request.name,
        workflow_definition=workflow_definition,
        template_context_variables=request.template_context_variables,
        workflow_configurations=workflow_configurations,
        folder_id=request.folder_id,
        organization_id=api_key.organization_id,
    )

    if workflow_definition:
        trigger_paths = extract_trigger_paths(workflow_definition)
        await db_client.sync_triggers_for_workflow(
            workflow_id=updated_workflow.id,
            organization_id=api_key.organization_id,
            trigger_paths=trigger_paths,
        )

    draft = await db_client.get_draft_version(updated_workflow.id)
    if draft:
        wf_def = draft.workflow_json
        wf_cfg = draft.workflow_configurations
        tmpl_vars = draft.template_context_variables
    elif updated_workflow.released_definition:
        wf_def = updated_workflow.released_definition.workflow_json
        wf_cfg = updated_workflow.released_definition.workflow_configurations
        tmpl_vars = updated_workflow.released_definition.template_context_variables
    else:
        wf_def = {}
        wf_cfg = getattr(updated_workflow, "workflow_configurations", None)
        tmpl_vars = getattr(updated_workflow, "template_context_variables", None)

    trigger_paths = extract_trigger_paths(wf_def) if wf_def else []
    primary_trigger = trigger_paths[0] if trigger_paths else None

    return CreatePublicAgentResponse(
        workflow_id=updated_workflow.id,
        workflow_uuid=updated_workflow.workflow_uuid,
        name=updated_workflow.name,
        status=updated_workflow.status,
        trigger_path=primary_trigger,
        created_at=updated_workflow.created_at,
        workflow_definition=wf_def,
        template_context_variables=tmpl_vars,
        workflow_configurations=wf_cfg,
        folder_id=getattr(updated_workflow, "folder_id", None),
    )


@router.put("/{identifier}/status", response_model=CreatePublicAgentResponse)
async def update_public_agent_status(
    identifier: str,
    request: UpdatePublicAgentStatusRequest,
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    """Update agent status (e.g. archive or reactivate an agent)."""
    api_key = await _validate_api_key(x_api_key)
    workflow = await _resolve_workflow_by_identifier(identifier, api_key.organization_id)
    if workflow is None:
        raise HTTPException(status_code=404, detail="Agent workflow not found")

    updated_workflow = await db_client.update_workflow_status(
        workflow_id=workflow.id,
        status=request.status,
        organization_id=api_key.organization_id,
    )

    draft = await db_client.get_draft_version(updated_workflow.id)
    wf_def = (
        draft.workflow_json
        if draft
        else (
            updated_workflow.released_definition.workflow_json
            if updated_workflow.released_definition
            else {}
        )
    )
    trigger_paths = extract_trigger_paths(wf_def) if wf_def else []

    return CreatePublicAgentResponse(
        workflow_id=updated_workflow.id,
        workflow_uuid=updated_workflow.workflow_uuid,
        name=updated_workflow.name,
        status=updated_workflow.status,
        trigger_path=trigger_paths[0] if trigger_paths else None,
        created_at=updated_workflow.created_at,
        workflow_definition=wf_def,
        template_context_variables=updated_workflow.template_context_variables,
        workflow_configurations=updated_workflow.workflow_configurations,
    )


@router.delete("/{identifier}", response_model=CreatePublicAgentResponse)
async def delete_public_agent(
    identifier: str,
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    """Archive / soft-delete a public agent using API key."""
    api_key = await _validate_api_key(x_api_key)
    workflow = await _resolve_workflow_by_identifier(identifier, api_key.organization_id)
    if workflow is None:
        raise HTTPException(status_code=404, detail="Agent workflow not found")

    updated_workflow = await db_client.update_workflow_status(
        workflow_id=workflow.id,
        status=WorkflowStatus.ARCHIVED.value,
        organization_id=api_key.organization_id,
    )

    draft = await db_client.get_draft_version(updated_workflow.id)
    wf_def = (
        draft.workflow_json
        if draft
        else (
            updated_workflow.released_definition.workflow_json
            if updated_workflow.released_definition
            else {}
        )
    )
    trigger_paths = extract_trigger_paths(wf_def) if wf_def else []

    return CreatePublicAgentResponse(
        workflow_id=updated_workflow.id,
        workflow_uuid=updated_workflow.workflow_uuid,
        name=updated_workflow.name,
        status=updated_workflow.status,
        trigger_path=trigger_paths[0] if trigger_paths else None,
        created_at=updated_workflow.created_at,
        workflow_definition=wf_def,
        template_context_variables=updated_workflow.template_context_variables,
        workflow_configurations=updated_workflow.workflow_configurations,
    )


@router.post("/{identifier}/publish", response_model=CreatePublicAgentResponse)
async def publish_public_agent(
    identifier: str,
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    """Publish the current draft version of an agent via API key."""
    api_key = await _validate_api_key(x_api_key)
    workflow = await _resolve_workflow_by_identifier(identifier, api_key.organization_id)
    if workflow is None:
        raise HTTPException(status_code=404, detail="Agent workflow not found")

    draft = await db_client.get_draft_version(workflow.id)
    if draft is None:
        raise HTTPException(status_code=400, detail="No draft to publish")

    validation_errors = _validate_workflow_definition(draft.workflow_json)
    if validation_errors:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid workflow definition: {validation_errors}",
        )

    try:
        await db_client.publish_workflow_draft(workflow.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    published_wf = await db_client.get_workflow(
        workflow.id, organization_id=api_key.organization_id
    )
    wf_def = published_wf.released_definition.workflow_json
    trigger_paths = extract_trigger_paths(wf_def) if wf_def else []

    return CreatePublicAgentResponse(
        workflow_id=published_wf.id,
        workflow_uuid=published_wf.workflow_uuid,
        name=published_wf.name,
        status=published_wf.status,
        trigger_path=trigger_paths[0] if trigger_paths else None,
        created_at=published_wf.created_at,
        workflow_definition=wf_def,
        template_context_variables=published_wf.released_definition.template_context_variables,
        workflow_configurations=published_wf.released_definition.workflow_configurations,
    )


@router.post("/{identifier}/create-draft")
async def create_public_agent_draft(
    identifier: str,
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    """Create a draft version from the published version of a public agent."""
    api_key = await _validate_api_key(x_api_key)
    workflow = await _resolve_workflow_by_identifier(identifier, api_key.organization_id)
    if workflow is None:
        raise HTTPException(status_code=404, detail="Agent workflow not found")

    draft = await db_client.save_workflow_draft(workflow.id)
    return {
        "id": draft.id,
        "version_number": draft.version_number,
        "status": draft.status,
        "created_at": draft.created_at,
        "published_at": draft.published_at,
        "workflow_json": draft.workflow_json,
        "workflow_configurations": draft.workflow_configurations,
        "template_context_variables": draft.template_context_variables,
    }


@router.get("/{identifier}/versions")
async def get_public_agent_versions(
    identifier: str,
    limit: Optional[int] = Query(None, ge=1, le=100),
    offset: int = Query(0, ge=0),
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    """List version history for a public agent by ID or UUID."""
    api_key = await _validate_api_key(x_api_key)
    workflow = await _resolve_workflow_by_identifier(identifier, api_key.organization_id)
    if workflow is None:
        raise HTTPException(status_code=404, detail="Agent workflow not found")

    versions = await db_client.get_workflow_versions(
        workflow.id, limit=limit, offset=offset
    )
    return [
        {
            "id": v.id,
            "version_number": v.version_number,
            "status": v.status,
            "created_at": v.created_at,
            "published_at": v.published_at,
            "workflow_json": v.workflow_json,
            "workflow_configurations": v.workflow_configurations,
            "template_context_variables": v.template_context_variables,
        }
        for v in versions
        if v.version_number is not None
    ]


@router.get("/{identifier}/runs")
async def get_public_agent_runs(
    identifier: str,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    """Get call/execution runs history for a public agent."""
    api_key = await _validate_api_key(x_api_key)
    workflow = await _resolve_workflow_by_identifier(identifier, api_key.organization_id)
    if workflow is None:
        raise HTTPException(status_code=404, detail="Agent workflow not found")

    runs = await db_client.get_workflow_runs_by_workflow_id(
        workflow_id=workflow.id,
        limit=limit,
        offset=offset,
        organization_id=api_key.organization_id,
    )
    return [
        {
            "id": r.id,
            "workflow_id": r.workflow_id,
            "name": r.name,
            "conversation_title": resolve_display_title(
                getattr(r, "conversation_title", None),
                getattr(workflow, "name", None),
                getattr(r, "name", None),
            ),
            "mode": r.mode,
            "created_at": r.created_at,
            "initial_context": r.initial_context,
        }
        for r in runs
    ]


def _build_public_text_chat_response(
    text_session: Any,
) -> dict[str, Any]:
    workflow_run = text_session.workflow_run
    return {
        "workflow_run_id": workflow_run.id,
        "workflow_id": workflow_run.workflow_id,
        "name": workflow_run.name,
        "mode": workflow_run.mode,
        "state": getattr(workflow_run.state, "value", str(workflow_run.state)),
        "is_completed": workflow_run.is_completed,
        "revision": text_session.revision,
        "initial_context": workflow_run.initial_context,
        "gathered_context": getattr(workflow_run, "gathered_context", None),
        "annotations": getattr(workflow_run, "annotations", None),
        "session_data": normalize_text_chat_session_data(text_session.session_data),
        "checkpoint": normalize_text_chat_checkpoint(text_session.checkpoint),
        "created_at": text_session.created_at,
        "updated_at": getattr(text_session, "updated_at", None),
    }


async def _execute_public_pending_turn_response(
    *,
    workflow_id: int,
    run_id: int,
    text_session: Any,
) -> dict[str, Any]:
    try:
        updated_text_session = await execute_pending_text_chat_turn(
            workflow_id=workflow_id,
            run_id=run_id,
            text_session=text_session,
        )
    except TextChatSessionRevisionConflictError as e:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Text chat session revision conflict",
                "expected_revision": e.expected_revision,
                "actual_revision": e.actual_revision,
            },
        )
    except TextChatPendingTurnLostError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except TextChatSessionExecutionError as e:
        raise HTTPException(status_code=500, detail=str(e))

    return _build_public_text_chat_response(updated_text_session)


async def _load_public_text_session_or_404(
    workflow_id: int,
    run_id: int,
    organization_id: int,
) -> Any:
    from pipecat.utils.run_context import set_current_run_id
    from api.enums import WorkflowRunMode

    set_current_run_id(run_id)
    text_session = await db_client.get_workflow_run_text_session(
        run_id, organization_id=organization_id
    )
    if not text_session or not text_session.workflow_run:
        raise HTTPException(status_code=404, detail="Text chat session not found")
    if text_session.workflow_run.workflow_id != workflow_id:
        raise HTTPException(status_code=404, detail="Text chat session not found")
    if text_session.workflow_run.mode != WorkflowRunMode.TEXTCHAT.value:
        raise HTTPException(
            status_code=400, detail="Workflow run is not a text chat session"
        )
    return text_session


@router.post("/{identifier}/text-chat/sessions")
async def create_public_agent_text_chat_session(
    identifier: str,
    request: CreatePublicAgentTextChatSessionRequest,
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    """Initiate an interactive text chat session with a public agent via API key."""
    from pipecat.utils.run_context import set_current_run_id
    from api.enums import WorkflowRunMode

    api_key = await _validate_api_key(x_api_key)
    user_id = api_key.created_by
    if not user_id:
        raise HTTPException(status_code=401, detail="API key has no associated user")

    workflow = await _resolve_workflow_by_identifier(identifier, api_key.organization_id)
    if workflow is None:
        raise HTTPException(status_code=404, detail="Agent workflow not found")

    _ensure_workflow_is_active(workflow)

    name = request.name or f"TextChat-{random.randint(1000, 9999)}"
    initial_context = {
        "provider": "text-chat",
        "agent_identifier": identifier,
        "workflow_uuid": workflow.workflow_uuid,
    }
    if request.initial_context:
        initial_context.update(request.initial_context)

    try:
        workflow_run = await db_client.create_workflow_run(
            name=name,
            workflow_id=workflow.id,
            mode=WorkflowRunMode.TEXTCHAT.value,
            initial_context=initial_context,
            user_id=user_id,
            use_draft=False,
            organization_id=api_key.organization_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    if request.annotations:
        workflow_run = await db_client.update_workflow_run(
            workflow_run.id,
            annotations=request.annotations,
        )

    set_current_run_id(workflow_run.id)

    quota_result = await authorize_workflow_run_start(
        workflow_id=workflow.id,
        workflow_run_id=workflow_run.id,
    )
    if not quota_result.has_quota:
        raise HTTPException(status_code=402, detail=quota_result.error_message)

    text_session = await db_client.ensure_workflow_run_text_session(
        workflow_run.id,
        session_data=default_text_chat_session_data(),
        checkpoint=default_text_chat_checkpoint(),
    )

    try:
        text_session = await initialize_text_chat_session(
            run_id=workflow_run.id,
            text_session=text_session,
        )
    except TextChatSessionRevisionConflictError as e:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Text chat session revision conflict",
                "expected_revision": e.expected_revision,
                "actual_revision": e.actual_revision,
            },
        )

    return await _execute_public_pending_turn_response(
        workflow_id=workflow.id,
        run_id=workflow_run.id,
        text_session=text_session,
    )


@router.get("/{identifier}/text-chat/sessions/{run_id}")
async def get_public_agent_text_chat_session(
    identifier: str,
    run_id: int,
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    """Get current state for a public agent text chat session."""
    api_key = await _validate_api_key(x_api_key)
    workflow = await _resolve_workflow_by_identifier(identifier, api_key.organization_id)
    if workflow is None:
        raise HTTPException(status_code=404, detail="Agent workflow not found")

    text_session = await _load_public_text_session_or_404(
        workflow.id, run_id, api_key.organization_id
    )
    return _build_public_text_chat_response(text_session)


@router.post("/{identifier}/text-chat/sessions/{run_id}/messages")
async def append_public_agent_text_chat_message(
    identifier: str,
    run_id: int,
    request: AppendPublicAgentTextChatMessageRequest,
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    """Send a user message in a public agent text chat session and get assistant response."""
    api_key = await _validate_api_key(x_api_key)
    user_id = api_key.created_by
    if not user_id:
        raise HTTPException(status_code=401, detail="API key has no associated user")

    workflow = await _resolve_workflow_by_identifier(identifier, api_key.organization_id)
    if workflow is None:
        raise HTTPException(status_code=404, detail="Agent workflow not found")

    text_session = await _load_public_text_session_or_404(
        workflow.id, run_id, api_key.organization_id
    )

    quota_result = await authorize_workflow_run_start(
        workflow_id=workflow.id,
        workflow_run_id=run_id,
    )
    if not quota_result.has_quota:
        raise HTTPException(status_code=402, detail=quota_result.error_message)

    try:
        text_session = await append_text_chat_user_message(
            run_id=run_id,
            text_session=text_session,
            user_text=request.text,
            expected_revision=request.expected_revision,
        )
    except TextChatSessionRevisionConflictError as e:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Text chat session revision conflict",
                "expected_revision": e.expected_revision,
                "actual_revision": e.actual_revision,
            },
        )

    return await _execute_public_pending_turn_response(
        workflow_id=workflow.id,
        run_id=run_id,
        text_session=text_session,
    )


@router.post("/{identifier}/text-chat/sessions/{run_id}/rewind")
async def rewind_public_agent_text_chat_session(
    identifier: str,
    run_id: int,
    request: RewindPublicAgentTextChatSessionRequest,
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    """Rewind text chat session to a previous turn or revision."""
    api_key = await _validate_api_key(x_api_key)
    workflow = await _resolve_workflow_by_identifier(identifier, api_key.organization_id)
    if workflow is None:
        raise HTTPException(status_code=404, detail="Agent workflow not found")

    text_session = await _load_public_text_session_or_404(
        workflow.id, run_id, api_key.organization_id
    )

    try:
        text_session = await rewind_text_chat_session_state(
            run_id=run_id,
            text_session=text_session,
            cursor_turn_id=request.cursor_turn_id,
            expected_revision=request.expected_revision,
        )
    except TextChatTurnNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except TextChatSessionRevisionConflictError as e:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Text chat session revision conflict",
                "expected_revision": e.expected_revision,
                "actual_revision": e.actual_revision,
            },
        )

    return _build_public_text_chat_response(text_session)


async def _build_public_workflow_run_response(run: Any) -> dict[str, Any]:
    public_access_token = getattr(run, "public_access_token", None)
    extra = getattr(run, "extra", None)
    user_recording_url = get_recording_storage_key(extra, "user")
    bot_recording_url = get_recording_storage_key(extra, "bot")
    has_user_rec = has_recording_track(extra, "user")
    has_bot_rec = has_recording_track(extra, "bot")

    if (
        getattr(run, "transcript_url", None)
        or getattr(run, "recording_url", None)
        or has_user_rec
        or has_bot_rec
    ) and not public_access_token:
        public_access_token = await db_client.ensure_public_access_token(run.id)

    return {
        "id": run.id,
        "workflow_id": run.workflow_id,
        "name": run.name,
        "conversation_title": resolve_display_title(
            getattr(run, "conversation_title", None),
            getattr(getattr(run, "workflow", None), "name", None),
            getattr(run, "name", None),
        ),
        "mode": run.mode,
        "is_completed": getattr(run, "is_completed", False),
        "transcript_url": getattr(run, "transcript_url", None),
        "recording_url": getattr(run, "recording_url", None),
        "user_recording_url": user_recording_url,
        "bot_recording_url": bot_recording_url,
        "transcript_public_url": artifact_url(public_access_token, "transcript"),
        "recording_public_url": artifact_url(public_access_token, "recording"),
        "report_public_url": (
            artifact_url(public_access_token, "report")
            if getattr(run, "report_s3_key", None)
            else None
        ),
        "user_recording_public_url": (
            artifact_url(public_access_token, "user_recording")
            if has_user_rec
            else None
        ),
        "bot_recording_public_url": (
            artifact_url(public_access_token, "bot_recording")
            if has_bot_rec
            else None
        ),
        "public_access_token": public_access_token,
        "cost_info": format_public_cost_info(
            getattr(run, "cost_info", None), getattr(run, "usage_info", None)
        ),
        "usage_info": format_public_usage_info(getattr(run, "usage_info", None)),
        "created_at": run.created_at,
        "definition_id": getattr(run, "definition_id", None),
        "initial_context": getattr(run, "initial_context", None),
        "gathered_context": getattr(run, "gathered_context", None),
        "call_type": getattr(run, "call_type", None),
        "logs": getattr(run, "logs", None),
        "annotations": getattr(run, "annotations", None),
        "report_s3_key": getattr(run, "report_s3_key", None),
        "report_generation_status": getattr(run, "report_generation_status", None),
    }


@router.get("/{identifier}/runs/{run_id}")
async def get_public_agent_run_detail(
    identifier: str,
    run_id: int,
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    """Get details for a specific run by agent identifier and run ID."""
    api_key = await _validate_api_key(x_api_key)

    if str(identifier) != "0":
        workflow = await _resolve_workflow_by_identifier(identifier, api_key.organization_id)
        if workflow is None:
            raise HTTPException(status_code=404, detail="Agent workflow not found")
        run = await db_client.get_workflow_run_by_id(run_id)
        if not run or run.workflow_id != workflow.id:
            raise HTTPException(status_code=404, detail="Workflow run not found")
    else:
        run = await db_client.get_workflow_run(run_id, organization_id=api_key.organization_id)
        if not run:
            raise HTTPException(status_code=404, detail="Workflow run not found")

    if getattr(run, "organization_id", None) and run.organization_id != api_key.organization_id:
        raise HTTPException(status_code=403, detail="Access denied")

    return await _build_public_workflow_run_response(run)


@public_workflow_router.get("/{workflow_id}/runs/{run_id}")
async def get_public_workflow_run_detail(
    workflow_id: str,
    run_id: int,
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    """Get details for a specific run via public workflow route (/public/workflow/{workflow_id}/runs/{run_id})."""
    return await get_public_agent_run_detail(
        identifier=workflow_id, run_id=run_id, x_api_key=x_api_key
    )


# ---------------------------------------------------------------------------
# Public Organization Usage Endpoints (X-API-Key Authentication)
# ---------------------------------------------------------------------------


@router.get("/usage/runs", response_model=UsageHistoryResponse)
@router.get("/organization/usage/runs", response_model=UsageHistoryResponse)
@router.get("/organizations/usage/runs", response_model=UsageHistoryResponse)
async def get_public_usage_history(
    start_date: Optional[str] = Query(None, description="ISO 8601 date-time string (UTC)"),
    end_date: Optional[str] = Query(None, description="ISO 8601 date-time string (UTC)"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    filters: Optional[str] = Query(None),
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    """Get paginated workflow runs with usage history for the organization via API key."""
    api_key = await _validate_api_key(x_api_key)

    start_dt = datetime.fromisoformat(start_date) if start_date else None
    end_dt = datetime.fromisoformat(end_date) if end_date else None

    parsed_filters = None
    if filters:
        try:
            parsed_filters = json.loads(filters)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid filters format")

    try:
        offset = (page - 1) * limit
        (
            runs,
            total_count,
            total_tokens,
            total_duration,
        ) = await db_client.get_usage_history(
            api_key.organization_id,
            start_date=start_dt,
            end_date=end_dt,
            limit=limit,
            offset=offset,
            filters=parsed_filters,
        )

        total_pages = (total_count + limit - 1) // limit if limit > 0 else 1

        for run in runs:
            public_access_token = run.get("public_access_token")
            run["transcript_public_url"] = artifact_url(public_access_token, "transcript")
            run["recording_public_url"] = artifact_url(public_access_token, "recording")
            run["report_public_url"] = (
                artifact_url(public_access_token, "report")
                if run.get("report_s3_key")
                else None
            )
            run["user_recording_public_url"] = (
                artifact_url(public_access_token, "user_recording")
                if has_recording_track(run.get("extra"), "user")
                else None
            )
            run["bot_recording_public_url"] = (
                artifact_url(public_access_token, "bot_recording")
                if has_recording_track(run.get("extra"), "bot")
                else None
            )
            run.pop("extra", None)

        return {
            "runs": runs,
            "total_convozent_tokens": total_tokens,
            "total_duration_seconds": total_duration,
            "total_count": total_count,
            "page": page,
            "limit": limit,
            "total_pages": total_pages,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/usage/runs/report")
@router.get("/organization/usage/runs/report")
@router.get("/organizations/usage/runs/report")
async def download_public_usage_runs_report(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    filters: Optional[str] = Query(None),
    x_api_key: str = Header(..., alias="X-API-Key"),
) -> StreamingResponse:
    """Download a CSV of runs matching filters for the organization via API key."""
    api_key = await _validate_api_key(x_api_key)

    start_dt = datetime.fromisoformat(start_date) if start_date else None
    end_dt = datetime.fromisoformat(end_date) if end_date else None

    parsed_filters = None
    if filters:
        try:
            parsed_filters = json.loads(filters)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid filters format")

    output, filename = await generate_usage_runs_report_csv(
        api_key.organization_id,
        start_date=start_dt,
        end_date=end_dt,
        filters=parsed_filters,
    )

    return StreamingResponse(
        output,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/usage/current-period", response_model=CurrentUsageResponse)
@router.get("/organization/usage/current-period", response_model=CurrentUsageResponse)
@router.get("/organizations/usage/current-period", response_model=CurrentUsageResponse)
async def get_public_current_period_usage(
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    """Get current reporting-period usage for the organization via API key."""
    api_key = await _validate_api_key(x_api_key)
    try:
        usage = await db_client.get_current_usage(api_key.organization_id)
        return usage
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/usage/daily-breakdown", response_model=DailyUsageBreakdownResponse)
@router.get("/organization/usage/daily-breakdown", response_model=DailyUsageBreakdownResponse)
@router.get("/organizations/usage/daily-breakdown", response_model=DailyUsageBreakdownResponse)
async def get_public_daily_usage_breakdown(
    days: int = Query(7, ge=1, le=30),
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    """Get daily usage breakdown for the last N days via API key."""
    api_key = await _validate_api_key(x_api_key)
    try:
        org = await db_client.get_organization_by_id(api_key.organization_id)
        if not org or org.price_per_second_usd is None:
            raise HTTPException(
                status_code=400,
                detail="Daily breakdown is only available for organizations with pricing configured",
            )

        end_date = datetime.now()
        start_date = end_date - timedelta(days=days - 1)
        start_date = start_date.replace(hour=0, minute=0, second=0, microsecond=0)

        breakdown = await db_client.get_daily_usage_breakdown(
            api_key.organization_id,
            start_date,
            end_date,
            org.price_per_second_usd,
            user_id=api_key.created_by,
        )
        return breakdown
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@public_organization_router.get("/usage/runs", response_model=UsageHistoryResponse)
async def get_public_organizations_usage_history(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    filters: Optional[str] = Query(None),
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    return await get_public_usage_history(
        start_date=start_date,
        end_date=end_date,
        page=page,
        limit=limit,
        filters=filters,
        x_api_key=x_api_key,
    )


@public_organization_router.get("/usage/runs/report")
async def download_public_organizations_usage_runs_report(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    filters: Optional[str] = Query(None),
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    return await download_public_usage_runs_report(
        start_date=start_date, end_date=end_date, filters=filters, x_api_key=x_api_key
    )


@public_organization_router.get("/usage/current-period", response_model=CurrentUsageResponse)
async def get_public_organizations_current_period_usage(
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    return await get_public_current_period_usage(x_api_key=x_api_key)


@public_organization_router.get("/usage/daily-breakdown", response_model=DailyUsageBreakdownResponse)
async def get_public_organizations_daily_usage_breakdown(
    days: int = Query(7, ge=1, le=30),
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    return await get_public_daily_usage_breakdown(days=days, x_api_key=x_api_key)



@router.get("/{identifier}/runs/{run_id}/report")
async def get_public_agent_run_report(
    identifier: str,
    run_id: int,
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    """Return the rendered HTML report for a workflow run."""
    from api.services.reports.pdf_report import render_template_html
    from api.services.reports.report_context import (
        build_report_context,
    )
    from api.services.reports.variable_engine import (
        resolve_definitions,
    )

    api_key = await _validate_api_key(x_api_key)
    workflow = await _resolve_workflow_by_identifier(identifier, api_key.organization_id)
    if workflow is None:
        raise HTTPException(status_code=404, detail="Agent workflow not found")

    run = await db_client.get_workflow_run(
        run_id, organization_id=api_key.organization_id
    )
    if not run or run.workflow_id != workflow.id:
        raise HTTPException(status_code=404, detail="Workflow run not found")

    if run.report_generation_status != "completed":
        raise HTTPException(
            status_code=404,
            detail="Report not ready yet. Status: " + (run.report_generation_status or "not started"),
        )

    configs = workflow.workflow_configurations or {}
    template_html = configs.get("report_template")
    if not template_html:
        try:
            draft = await db_client.get_draft_version(workflow.id)
            if draft:
                template_html = (draft.workflow_configurations or {}).get("report_template")
        except Exception:
            pass

    if not template_html:
        raise HTTPException(status_code=404, detail="No report template configured")

    raw_vars = configs.get("report_variables", [])
    saved_defs: list = []
    if raw_vars and isinstance(raw_vars, list):
        saved_defs = [v for v in raw_vars if isinstance(v, dict) and v.get("name")]
    report_variables_defs = resolve_definitions(template_html, saved_defs) or None

    try:
        context = build_report_context(run, report_variables_defs=report_variables_defs)
        rendered = render_template_html(template_html, context)
        report_vars = context.get("report_variables", {})
        agent_name = (
            (run.initial_context or {}).get("agent_name")
            or (run.initial_context or {}).get("name")
            or (run.gathered_context or {}).get("agent_name")
            or workflow.name
        )
        return JSONResponse(content={
            "rendered_html": rendered,
            "report_template": template_html,
            "report_variables": report_vars,
            "workflow_name": workflow.name,
            "agent_name": agent_name,
        })
    except Exception as e:
        logger.error(f"Failed to render report for run {run_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to render report: {e}")


@router.get("/{identifier}/report")
@router.get("/{identifier}/report/download")
async def download_public_agent_report_csv(
    identifier: str,
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    """Download a CSV report of completed runs for a public agent."""
    from api.services.reports import generate_workflow_report_csv

    api_key = await _validate_api_key(x_api_key)
    workflow = await _resolve_workflow_by_identifier(identifier, api_key.organization_id)
    if workflow is None:
        raise HTTPException(status_code=404, detail="Agent workflow not found")

    output, filename = await generate_workflow_report_csv(
        workflow.id, start_date=start_date, end_date=end_date
    )

    return StreamingResponse(
        output,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{identifier}/report/pdf")
@router.get("/{identifier}/report/download/pdf")
async def download_public_agent_report_pdf(
    identifier: str,
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    """Download a ZIP of PDF reports generated from the agent's report template."""
    from api.services.reports.pdf_report import generate_workflow_report_pdf

    api_key = await _validate_api_key(x_api_key)
    workflow = await _resolve_workflow_by_identifier(identifier, api_key.organization_id)
    if workflow is None:
        raise HTTPException(status_code=404, detail="Agent workflow not found")

    configs = workflow.workflow_configurations or {}
    template_html = configs.get("report_template")
    if not template_html and workflow.released_definition:
        template_html = (workflow.released_definition.workflow_configurations or {}).get("report_template")
    if not template_html:
        raise HTTPException(
            status_code=400,
            detail="No report template configured. Add a report template before downloading PDF reports.",
        )

    output, filename = await generate_workflow_report_pdf(
        workflow.id, template_html, start_date=start_date, end_date=end_date
    )

    return StreamingResponse(
        output,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.put("/{identifier}/folder")
async def update_public_agent_folder(
    identifier: str,
    request: UpdatePublicAgentFolderRequest,
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    """Assign or move a public agent to a folder."""
    api_key = await _validate_api_key(x_api_key)
    workflow = await _resolve_workflow_by_identifier(identifier, api_key.organization_id)
    if workflow is None:
        raise HTTPException(status_code=404, detail="Agent workflow not found")

    updated_workflow = await db_client.update_workflow(
        workflow_id=workflow.id,
        folder_id=request.folder_id,
        organization_id=api_key.organization_id,
    )
    return {
        "workflow_id": updated_workflow.id,
        "workflow_uuid": updated_workflow.workflow_uuid,
        "folder_id": getattr(updated_workflow, "folder_id", None),
        "name": updated_workflow.name,
        "status": updated_workflow.status,
    }


@router.post("/ambient-noise/upload-url")
@router.post("/{identifier}/ambient-noise/upload-url")
async def get_public_agent_ambient_noise_upload_url(
    request: PublicAgentAmbientNoiseUploadRequest,
    identifier: Optional[str] = None,
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    """Generate presigned PUT URL to upload custom ambient noise for an agent."""
    import re
    from api.enums import StorageBackend
    from api.services.storage import storage_fs

    api_key = await _validate_api_key(x_api_key)
    target_id = request.workflow_id
    if not target_id and identifier:
        wf = await _resolve_workflow_by_identifier(identifier, api_key.organization_id)
        if wf:
            target_id = wf.id

    if not target_id:
        raise HTTPException(status_code=400, detail="Must specify workflow_id or identifier")

    workflow = await db_client.get_workflow(target_id, organization_id=api_key.organization_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Agent workflow not found")

    sanitized = re.sub(r"[^a-zA-Z0-9._-]", "_", request.filename)
    storage_key = (
        f"ambient-noise/{api_key.organization_id}"
        f"/{workflow.id}/{uuid.uuid4()}_{sanitized}"
    )

    upload_url = await storage_fs.aget_presigned_put_url(
        file_path=storage_key,
        expiration=1800,
        content_type=request.mime_type,
        max_size=request.file_size,
    )
    if not upload_url:
        raise HTTPException(status_code=500, detail="Failed to generate upload URL")

    return {
        "upload_url": upload_url,
        "storage_key": storage_key,
        "storage_backend": StorageBackend.get_current_backend().value,
    }


@router.post("/validate")
@router.post("/{identifier}/validate")
async def validate_public_agent(
    identifier: Optional[str] = None,
    workflow_definition: Optional[dict] = None,
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    """Validate a workflow definition for errors using API key."""
    api_key = await _validate_api_key(x_api_key)
    wf_def_to_validate = workflow_definition

    if not wf_def_to_validate and identifier:
        workflow = await _resolve_workflow_by_identifier(identifier, api_key.organization_id)
        if workflow:
            draft = await db_client.get_draft_version(workflow.id)
            wf_def_to_validate = (
                draft.workflow_json
                if draft
                else (
                    workflow.released_definition.workflow_json
                    if workflow.released_definition
                    else None
                )
            )

    if not wf_def_to_validate:
        raise HTTPException(status_code=400, detail="No workflow definition provided for validation")

    errors = _validate_workflow_definition(wf_def_to_validate)
    return {"is_valid": len(errors) == 0, "errors": errors}


@router.post("/duplicate/{identifier}", response_model=CreatePublicAgentResponse)
@router.post("/duplicate", response_model=CreatePublicAgentResponse)
async def duplicate_public_agent(
    identifier: Optional[str] = None,
    request: Optional[DuplicatePublicAgentRequest] = None,
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    """Duplicate an existing agent using API key authentication."""
    api_key = await _validate_api_key(x_api_key)
    user_id = api_key.created_by
    if not user_id:
        raise HTTPException(status_code=401, detail="API key has no associated user")

    source_id = None
    source_uuid = None
    custom_name = None

    if request:
        source_id = request.workflow_id
        source_uuid = request.workflow_uuid
        custom_name = request.name

    if identifier:
        if identifier.isdigit():
            source_id = int(identifier)
        else:
            source_uuid = identifier

    if source_id is None and source_uuid is None:
        raise HTTPException(
            status_code=400, detail="Must provide workflow_id or workflow_uuid to duplicate"
        )

    target_workflow = None
    if source_id is not None:
        target_workflow = await db_client.get_workflow(
            source_id, organization_id=api_key.organization_id
        )
    if target_workflow is None and source_uuid is not None:
        target_workflow = await db_client.get_workflow_by_uuid(
            source_uuid, organization_id=api_key.organization_id
        )

    if target_workflow is None:
        raise HTTPException(status_code=404, detail="Source agent workflow not found")

    new_workflow = await duplicate_workflow(
        workflow_id=target_workflow.id,
        organization_id=api_key.organization_id,
        user_id=user_id,
    )

    if custom_name:
        new_workflow = await db_client.update_workflow(
            workflow_id=new_workflow.id,
            name=custom_name,
            organization_id=api_key.organization_id,
        )

    active_def = await db_client.get_draft_version(new_workflow.id)
    if active_def:
        wf_def = active_def.workflow_json
        wf_cfg = active_def.workflow_configurations
        tmpl_vars = active_def.template_context_variables
    elif new_workflow.released_definition:
        wf_def = new_workflow.released_definition.workflow_json
        wf_cfg = new_workflow.released_definition.workflow_configurations
        tmpl_vars = new_workflow.released_definition.template_context_variables
    else:
        wf_def = {}
        wf_cfg = getattr(new_workflow, "workflow_configurations", None)
        tmpl_vars = getattr(new_workflow, "template_context_variables", None)

    trigger_paths = extract_trigger_paths(wf_def) if wf_def else []
    primary_trigger = trigger_paths[0] if trigger_paths else None

    return CreatePublicAgentResponse(
        workflow_id=new_workflow.id,
        workflow_uuid=new_workflow.workflow_uuid,
        name=new_workflow.name,
        status=new_workflow.status,
        trigger_path=primary_trigger,
        created_at=new_workflow.created_at,
        workflow_definition=wf_def,
        template_context_variables=tmpl_vars,
        workflow_configurations=wf_cfg,
        folder_id=getattr(new_workflow, "folder_id", None),
    )


@router.post("/{uuid}", response_model=TriggerCallResponse | ScheduledCallResponse)
async def initiate_call(
    uuid: str,
    request: TriggerCallRequest,
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    """Initiate a phone call against the published agent."""
    return await _initiate_call(
        uuid,
        request,
        x_api_key,
        use_draft=False,
        target_resolver=_resolve_trigger_target,
    )


@router.post("/test/{uuid}", response_model=TriggerCallResponse)
async def initiate_call_test(
    uuid: str,
    request: TriggerCallRequest,
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    """Initiate a phone call against the latest draft of the agent."""
    return await _initiate_call(
        uuid,
        request,
        x_api_key,
        use_draft=True,
        target_resolver=_resolve_trigger_target,
    )


@router.post("/workflow/{workflow_uuid}", response_model=TriggerCallResponse)
async def initiate_call_by_workflow_uuid(
    workflow_uuid: str,
    request: TriggerCallRequest,
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    """Initiate a phone call against the published workflow identified by UUID."""
    return await _initiate_call(
        workflow_uuid,
        request,
        x_api_key,
        use_draft=False,
        target_resolver=_resolve_workflow_uuid_target,
    )


@router.post("/test/workflow/{workflow_uuid}", response_model=TriggerCallResponse)
async def initiate_call_test_by_workflow_uuid(
    workflow_uuid: str,
    request: TriggerCallRequest,
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    """Initiate a phone call against the latest draft of the workflow by UUID."""
    return await _initiate_call(
        workflow_uuid,
        request,
        x_api_key,
        use_draft=True,
        target_resolver=_resolve_workflow_uuid_target,
    )
