import json
from datetime import datetime
from typing import Any, Dict, List, Literal, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse, StreamingResponse
from loguru import logger
from pydantic import BaseModel, Field, field_validator, model_validator

from api.constants import (
    DEFAULT_CAMPAIGN_RETRY_CONFIG,
    DEFAULT_ORG_CONCURRENCY_LIMIT,
)
from api.db import db_client
from api.db.models import UserModel
from api.enums import OrganizationConfigurationKey
from api.services.auth.depends import get_user
from api.services.campaign.runner import campaign_runner_service
from api.services.campaign.source_sync import CampaignSourceSyncService
from api.services.campaign.source_sync_factory import get_sync_service
from api.services.agents_llm import openai_params
from api.services.configuration.ai_model_configuration import (
    get_effective_ai_model_configuration_for_workflow,
)
from api.services.quota_service import authorize_workflow_run_start
from api.services.reports import (
    build_campaign_report_context,
    extract_campaign_report_variables,
    finalize_campaign_variables,
    generate_campaign_report_csv,
    render_template_html,
)
from api.services.reports.pdf_report import generate_campaign_report_pdf
from api.services.reports.variable_engine import (
    CAMPAIGN_BUILTIN_VARS,
    ReportVariable,
    ReportVariableType,
    missing_cached_vars,
    resolve_definitions,
)
from api.services.reports.extraction import _is_quota_error
from api.services.storage import storage_fs

router = APIRouter(prefix="/campaign")


async def _get_org_concurrent_limit(organization_id: int) -> int:
    """Get the concurrent call limit for an organization."""
    try:
        config = await db_client.get_configuration(
            organization_id,
            OrganizationConfigurationKey.CONCURRENT_CALL_LIMIT.value,
        )
        if config and config.value:
            return int(config.value.get("value", DEFAULT_ORG_CONCURRENCY_LIMIT))
    except Exception:
        pass
    return DEFAULT_ORG_CONCURRENCY_LIMIT


async def _get_from_numbers_count(organization_id: int) -> int:
    """Active phone-number count from the org's default telephony config.
    Used to validate ``max_concurrency`` against caller-id supply."""
    try:
        default_cfg = await db_client.get_default_telephony_configuration(
            organization_id
        )
        if default_cfg:
            addresses = await db_client.list_active_normalized_addresses_for_config(
                default_cfg.id
            )
            return len(addresses)
    except Exception:
        pass
    return 0


async def _validate_max_concurrency(max_concurrency: int, organization_id: int) -> None:
    """Validate max_concurrency against org limit and configured phone numbers.

    Raises HTTPException(400) if the value exceeds the effective limit.
    """
    org_limit = await _get_org_concurrent_limit(organization_id)
    from_numbers_count = await _get_from_numbers_count(organization_id)
    effective_limit = (
        min(org_limit, from_numbers_count) if from_numbers_count > 0 else org_limit
    )
    if max_concurrency > effective_limit:
        if from_numbers_count > 0 and from_numbers_count < org_limit:
            raise HTTPException(
                status_code=400,
                detail=f"max_concurrency ({max_concurrency}) cannot exceed {effective_limit}. You have {from_numbers_count} phone number(s) configured. Add more CLIs in telephony configuration to increase concurrency.",
            )
        raise HTTPException(
            status_code=400,
            detail=f"max_concurrency ({max_concurrency}) cannot exceed organization limit ({effective_limit})",
        )


class RetryConfigRequest(BaseModel):
    enabled: bool = True
    max_retries: int = Field(default=2, ge=0, le=10)
    retry_delay_seconds: int = Field(default=120, ge=30, le=3600)
    retry_on_busy: bool = True
    retry_on_no_answer: bool = True
    retry_on_voicemail: bool = True


class RetryConfigResponse(BaseModel):
    enabled: bool
    max_retries: int
    retry_delay_seconds: int
    retry_on_busy: bool
    retry_on_no_answer: bool
    retry_on_voicemail: bool


class TimeSlotRequest(BaseModel):
    day_of_week: int = Field(..., ge=0, le=6)
    start_time: str = Field(..., pattern=r"^\d{2}:\d{2}$")
    end_time: str = Field(..., pattern=r"^\d{2}:\d{2}$")

    @model_validator(mode="after")
    def validate_times(self):
        if self.start_time >= self.end_time:
            raise ValueError("start_time must be before end_time")
        return self


class ScheduleConfigRequest(BaseModel):
    enabled: bool = True
    mode: Literal["window", "start_at"] = "window"
    timezone: str = "UTC"
    slots: List[TimeSlotRequest] = Field(default_factory=list, max_length=50)
    start_at: Optional[str] = None

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (KeyError, Exception):
            raise ValueError(f"Invalid timezone: {value}")
        return value

    @model_validator(mode="after")
    def validate_schedule_mode(self):
        if not self.enabled:
            return self
        if self.mode == "window" and not self.slots:
            raise ValueError("At least one time slot is required for a call window")
        if self.mode == "start_at":
            if not self.start_at:
                raise ValueError("start_at is required for an automatic campaign start")
            try:
                datetime.fromisoformat(self.start_at)
            except ValueError as exc:
                raise ValueError("start_at must be a valid local date and time") from exc
        return self


class TimeSlotResponse(BaseModel):
    day_of_week: int
    start_time: str
    end_time: str


class ScheduleConfigResponse(BaseModel):
    enabled: bool
    mode: Literal["window", "start_at"] = "window"
    timezone: str
    slots: List[TimeSlotResponse]
    start_at: Optional[str] = None


class CircuitBreakerConfigRequest(BaseModel):
    enabled: bool = True
    failure_threshold: float = Field(default=0.5, ge=0.0, le=1.0)
    window_seconds: int = Field(default=120, ge=30, le=600)
    min_calls_in_window: int = Field(default=5, ge=1, le=100)


class CircuitBreakerConfigResponse(BaseModel):
    enabled: bool = False
    failure_threshold: float = 0.5
    window_seconds: int = 120
    min_calls_in_window: int = 5


class ReportVariableRequest(BaseModel):
    name: str = Field(..., min_length=1)
    type: str = Field(default="text", pattern="^(text|number|yes_no|list|range|score)$")
    description: str = ""


class ReportVariableResponse(BaseModel):
    name: str
    type: str
    description: str = ""


class CreateCampaignRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    workflow_id: int
    source_type: str = Field(..., pattern="^csv$")
    source_id: str  # CSV file key
    # Optional during the legacy → multi-config migration window. Required in
    # a follow-up. When omitted, the dispatcher falls back to the org's
    # default config.
    telephony_configuration_id: Optional[int] = None
    retry_config: Optional[RetryConfigRequest] = None
    max_concurrency: Optional[int] = Field(default=None, ge=1, le=100)
    schedule_config: Optional[ScheduleConfigRequest] = None
    circuit_breaker: Optional[CircuitBreakerConfigRequest] = None
    report_template: Optional[str] = None
    report_variables: Optional[List[ReportVariableRequest]] = None


class UpdateCampaignRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    retry_config: Optional[RetryConfigRequest] = None
    max_concurrency: Optional[int] = Field(default=None, ge=1, le=100)
    schedule_config: Optional[ScheduleConfigRequest] = None
    circuit_breaker: Optional[CircuitBreakerConfigRequest] = None
    report_template: Optional[str] = None
    report_variables: Optional[List[ReportVariableRequest]] = None


class CampaignLogEntryResponse(BaseModel):
    """A single timestamped entry from the campaign's append-only log.

    Surfaced in the UI so operators can see why a campaign moved to
    paused / failed without digging through server logs.
    """

    ts: str
    level: str
    event: str
    message: str
    details: Optional[Dict[str, Any]] = None


class CampaignResponse(BaseModel):
    id: int
    name: str
    workflow_id: int
    workflow_name: str
    state: str
    source_type: str
    source_id: str
    total_rows: Optional[int]
    processed_rows: int
    failed_rows: int
    created_at: datetime
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    retry_config: RetryConfigResponse
    max_concurrency: Optional[int] = None
    schedule_config: Optional[ScheduleConfigResponse] = None
    circuit_breaker: Optional[CircuitBreakerConfigResponse] = None
    executed_count: int = 0
    total_queued_count: int = 0
    parent_campaign_id: Optional[int] = None
    redialed_campaign_id: Optional[int] = None
    telephony_configuration_id: Optional[int] = None
    telephony_configuration_name: Optional[str] = None
    report_template: Optional[str] = None
    report_variables: Optional[List[ReportVariableResponse]] = None
    has_report_template: bool = False
    report_generation_status: Optional[str] = None
    report_generated_at: Optional[str] = None
    report_s3_key: Optional[str] = None
    orchestrator_metadata: Optional[Dict[str, Any]] = None
    logs: List[CampaignLogEntryResponse] = Field(default_factory=list)


class CampaignsResponse(BaseModel):
    campaigns: List[CampaignResponse]


class CampaignSourceColumnsResponse(BaseModel):
    required_columns: List[str]


class WorkflowRunResponse(BaseModel):
    id: int
    workflow_id: int
    state: str
    created_at: datetime
    completed_at: Optional[datetime]


class CampaignRunsResponse(BaseModel):
    """Paginated response for campaign workflow runs"""

    runs: List[dict]  # WorkflowRunResponseSchema from schemas
    total_count: int
    page: int
    limit: int
    total_pages: int


class CampaignRunStateCount(BaseModel):
    state: str
    count: int


class CampaignRunDailyAnalytics(BaseModel):
    date: str
    calls: int
    duration: float


class CampaignRunAnalyticsResponse(BaseModel):
    total_calls: int
    completed_calls: int
    average_duration_seconds: float
    state_breakdown: List[CampaignRunStateCount]
    daily: List[CampaignRunDailyAnalytics]


class CampaignCallTargetResponse(BaseModel):
    id: Optional[int] = None
    phone_number: str
    context_variables: Dict[str, Any] = Field(default_factory=dict)
    state: str


class CampaignCallTargetRequest(BaseModel):
    phone_number: str = Field(..., min_length=2, max_length=64)
    context_variables: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("phone_number")
    @classmethod
    def validate_phone_number(cls, value: str) -> str:
        value = value.strip()
        if not value.startswith("+"):
            raise ValueError("phone_number must include a country code and start with '+'")
        return value

    @model_validator(mode="after")
    def prevent_phone_number_override(self):
        if "phone_number" in self.context_variables:
            raise ValueError("context_variables must not contain phone_number")
        return self


class CampaignCallTargetUpdateRequest(BaseModel):
    phone_number: Optional[str] = Field(default=None, min_length=2, max_length=64)
    context_variables: Optional[Dict[str, Any]] = None

    @field_validator("phone_number")
    @classmethod
    def validate_optional_phone_number(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        value = value.strip()
        if not value.startswith("+"):
            raise ValueError("phone_number must include a country code and start with '+'")
        return value

    @model_validator(mode="after")
    def prevent_context_phone_number_override(self):
        if self.context_variables is not None and "phone_number" in self.context_variables:
            raise ValueError("context_variables must not contain phone_number")
        return self


class CampaignCallTargetsResponse(BaseModel):
    targets: List[CampaignCallTargetResponse]
    total_count: int
    page: int
    limit: int
    total_pages: int


class CampaignProgressResponse(BaseModel):
    campaign_id: int
    state: str
    total_rows: int
    processed_rows: int
    failed_calls: int
    progress_percentage: float
    source_sync: dict
    rate_limit: int
    started_at: Optional[datetime]
    completed_at: Optional[datetime]


# Default retry config for campaigns


def _build_campaign_response(
    campaign,
    workflow_name: str,
    executed_count: int = 0,
    total_queued_count: int = 0,
    telephony_configuration_name: Optional[str] = None,
    workflow_report_template: Optional[str] = None,
    workflow_report_variables: Optional[List[ReportVariableResponse]] = None,
) -> CampaignResponse:
    """Build a CampaignResponse from a campaign model."""
    # Get retry_config from campaign or use defaults
    retry_config = (
        campaign.retry_config
        if campaign.retry_config
        else DEFAULT_CAMPAIGN_RETRY_CONFIG
    )

    # Get metadata fields from orchestrator_metadata
    max_concurrency = None
    schedule_config = None
    circuit_breaker_config = CircuitBreakerConfigResponse()
    parent_campaign_id = None
    redialed_campaign_id = None
    report_template = None
    report_variables = None
    if campaign.orchestrator_metadata:
        max_concurrency = campaign.orchestrator_metadata.get("max_concurrency")
        sc = campaign.orchestrator_metadata.get("schedule_config")
        if sc:
            schedule_config = ScheduleConfigResponse(
                enabled=sc.get("enabled", False),
                mode=sc.get("mode", "window"),
                timezone=sc.get("timezone", "UTC"),
                slots=[TimeSlotResponse(**slot) for slot in sc.get("slots", [])],
                start_at=sc.get("start_at"),
            )
        cb = campaign.orchestrator_metadata.get("circuit_breaker")
        if cb:
            circuit_breaker_config = CircuitBreakerConfigResponse(**cb)
        parent_campaign_id = campaign.orchestrator_metadata.get("parent_campaign_id")
        redialed_campaign_id = campaign.orchestrator_metadata.get(
            "redialed_campaign_id"
        )
        report_template = campaign.orchestrator_metadata.get("report_template")
        raw_report_vars = campaign.orchestrator_metadata.get("report_variables")
        if raw_report_vars:
            report_variables = [ReportVariableResponse(**v) for v in raw_report_vars]

    report_gen_status = None
    report_gen_at = None
    report_s3_key = None
    if campaign.orchestrator_metadata:
        report_gen_status = campaign.orchestrator_metadata.get("report_generation_status")
        report_gen_at = campaign.orchestrator_metadata.get("report_generated_at")
        report_s3_key = campaign.orchestrator_metadata.get("report_s3_key")
        if not report_gen_status:
            if campaign.orchestrator_metadata.get("report_variables_values") or report_gen_at:
                report_gen_status = "completed"

    if report_template is None and workflow_report_template:
        report_template = workflow_report_template
    if report_variables is None and workflow_report_variables:
        report_variables = workflow_report_variables

    has_report_template = bool(report_template and report_template.strip())

    return CampaignResponse(
        id=campaign.id,
        name=campaign.name,
        workflow_id=campaign.workflow_id,
        workflow_name=workflow_name,
        state=campaign.state,
        source_type=campaign.source_type,
        source_id=campaign.source_id,
        total_rows=campaign.total_rows,
        processed_rows=campaign.processed_rows,
        failed_rows=campaign.failed_rows,
        created_at=campaign.created_at,
        started_at=campaign.started_at,
        completed_at=campaign.completed_at,
        retry_config=RetryConfigResponse(**retry_config),
        max_concurrency=max_concurrency,
        schedule_config=schedule_config,
        circuit_breaker=circuit_breaker_config,
        executed_count=executed_count,
        total_queued_count=total_queued_count,
        parent_campaign_id=parent_campaign_id,
        redialed_campaign_id=redialed_campaign_id,
        telephony_configuration_id=campaign.telephony_configuration_id,
        telephony_configuration_name=telephony_configuration_name,
        report_template=report_template,
        report_variables=report_variables,
        has_report_template=has_report_template,
        report_generation_status=report_gen_status,
        report_generated_at=report_gen_at,
        report_s3_key=report_s3_key,
        orchestrator_metadata=campaign.orchestrator_metadata,
        logs=[
            CampaignLogEntryResponse(**entry)
            for entry in (campaign.logs or [])
            if isinstance(entry, dict)
        ],
    )


async def _get_campaign_stats(campaign_id: int) -> tuple[int, int]:
    """Return (executed_count, total_queued_count) for a campaign."""
    stats_map = await db_client.get_queued_runs_stats_for_campaigns([campaign_id])
    s = stats_map.get(campaign_id, {})
    return s.get("executed", 0), s.get("total", 0)


async def _get_telephony_configuration_name(
    config_id: Optional[int], organization_id: int
) -> Optional[str]:
    """Resolve the display name for a campaign's telephony configuration.

    Org-scoped lookup so a stale FK from another org (shouldn't happen, but
    cheap to enforce) doesn't leak across tenants.
    """
    if config_id is None:
        return None
    cfg = await db_client.get_telephony_configuration_for_org(
        config_id, organization_id
    )
    return cfg.name if cfg else None


@router.post("/create")
async def create_campaign(
    request: CreateCampaignRequest,
    user: UserModel = Depends(get_user),
) -> CampaignResponse:
    """Create a new campaign"""
    # Verify workflow exists and belongs to organization
    workflow_name = await db_client.get_workflow_name(request.workflow_id, user.id)
    if not workflow_name:
        raise HTTPException(status_code=404, detail="Workflow not found")

    # Validate source data (phone_number column and format)
    sync_service = get_sync_service(request.source_type)
    validation_result = await sync_service.validate_source(
        request.source_id, user.selected_organization_id
    )
    if not validation_result.is_valid:
        raise HTTPException(status_code=400, detail=validation_result.error.message)

    # Validate template variables against source data columns
    workflow = await db_client.get_workflow(
        request.workflow_id, organization_id=user.selected_organization_id
    )
    if workflow:
        from api.services.workflow.dto import ReactFlowDTO
        from api.services.workflow.workflow_graph import WorkflowGraph

        workflow_def = workflow.released_definition.workflow_json
        if workflow_def:
            try:
                dto = ReactFlowDTO(**workflow_def)
                graph = WorkflowGraph(dto)
                required_vars = graph.get_required_template_variables()

                if (
                    required_vars
                    and validation_result.headers
                    and validation_result.rows
                ):
                    template_validation = (
                        CampaignSourceSyncService.validate_template_columns(
                            validation_result.headers,
                            validation_result.rows,
                            required_vars,
                        )
                    )
                    if not template_validation.is_valid:
                        raise HTTPException(
                            status_code=400,
                            detail=template_validation.error.message,
                        )
            except HTTPException:
                raise
            except Exception:
                pass  # Don't block campaign creation if template extraction fails

    if request.max_concurrency is not None:
        await _validate_max_concurrency(
            request.max_concurrency, user.selected_organization_id
        )

    # Resolve which telephony config the campaign is pinned to. Explicit value
    # wins; otherwise default to the org's default config so legacy clients keep
    # working through the migration window.
    telephony_configuration_id = request.telephony_configuration_id
    if telephony_configuration_id:
        cfg = await db_client.get_telephony_configuration_for_org(
            telephony_configuration_id, user.selected_organization_id
        )
        if not cfg:
            raise HTTPException(
                status_code=400, detail="telephony_configuration_not_found"
            )
    else:
        default_cfg = await db_client.get_default_telephony_configuration(
            user.selected_organization_id
        )
        if default_cfg:
            telephony_configuration_id = default_cfg.id

    # Build retry_config dict if provided
    retry_config = None
    if request.retry_config:
        retry_config = request.retry_config.model_dump()

    # Build schedule_config dict if provided
    schedule_config = None
    if request.schedule_config:
        schedule_config = request.schedule_config.model_dump()

    # Build circuit_breaker dict if provided
    circuit_breaker_config = None
    if request.circuit_breaker:
        circuit_breaker_config = request.circuit_breaker.model_dump()

    campaign = await db_client.create_campaign(
        name=request.name,
        workflow_id=request.workflow_id,
        source_type=request.source_type,
        source_id=request.source_id,
        user_id=user.id,
        organization_id=user.selected_organization_id,
        retry_config=retry_config,
        max_concurrency=request.max_concurrency,
        schedule_config=schedule_config,
        circuit_breaker=circuit_breaker_config,
        telephony_configuration_id=telephony_configuration_id,
        report_template=request.report_template,
        report_variables=(
            [v.model_dump() for v in request.report_variables]
            if request.report_variables
            else None
        ),
    )

    cfg_name = await _get_telephony_configuration_name(
        campaign.telephony_configuration_id, user.selected_organization_id
    )
    return _build_campaign_response(
        campaign, workflow_name, telephony_configuration_name=cfg_name
    )


@router.get("", include_in_schema=False)
@router.get("/")
async def get_campaigns(
    user: UserModel = Depends(get_user),
) -> CampaignsResponse:
    """Get campaigns for user's organization"""
    campaigns = await db_client.get_campaigns(user.selected_organization_id)

    # Get workflow names for all campaigns
    workflow_ids = list(set(c.workflow_id for c in campaigns))
    workflows = await db_client.get_workflows_by_ids(
        workflow_ids, user.selected_organization_id
    )
    workflow_map = {w.id: w.name for w in workflows}

    stats_map = await db_client.get_queued_runs_stats_for_campaigns(
        [c.id for c in campaigns]
    )

    # Build {config_id: name} map by fetching all configs for the org once,
    # rather than one lookup per campaign.
    org_configs = await db_client.list_telephony_configurations(
        user.selected_organization_id
    )
    config_name_map = {cfg.id: cfg.name for cfg in org_configs}
    workflow_configs_map = {w.id: (w.workflow_configurations or {}) for w in workflows}

    campaign_responses = []
    for c in campaigns:
        wf_cfg = workflow_configs_map.get(c.workflow_id, {})
        wf_template = wf_cfg.get("report_template")
        raw_wf_vars = wf_cfg.get("report_variables")
        wf_vars = [
            ReportVariableResponse(**v)
            for v in raw_wf_vars
            if isinstance(v, dict) and "name" in v
        ] if raw_wf_vars and isinstance(raw_wf_vars, list) else None

        campaign_responses.append(
            _build_campaign_response(
                c,
                workflow_map.get(c.workflow_id, "Unknown"),
                executed_count=stats_map.get(c.id, {}).get("executed", 0),
                total_queued_count=stats_map.get(c.id, {}).get("total", 0),
                telephony_configuration_name=config_name_map.get(
                    c.telephony_configuration_id
                ),
                workflow_report_template=wf_template,
                workflow_report_variables=wf_vars,
            )
        )

    return CampaignsResponse(campaigns=campaign_responses)

async def _materialize_campaign_call_targets(campaign, organization_id: int) -> None:
    """Snapshot the validated CSV once so campaign operators can safely edit it."""
    if campaign.call_targets_initialized:
        return
    sync_service = get_sync_service(campaign.source_type)
    source = await sync_service.validate_source(campaign.source_id, organization_id)
    if not source.is_valid or source.headers is None or source.rows is None:
        detail = source.error.message if source.error else "Campaign source is unavailable"
        raise HTTPException(status_code=409, detail=detail)

    phone_index = source.headers.index("phone_number")
    targets = []
    for row in source.rows:
        if len(row) <= phone_index or not row[phone_index].strip():
            continue
        padded_row = row + [""] * (len(source.headers) - len(row))
        context_variables = dict(zip(source.headers, padded_row))
        phone_number = context_variables.pop("phone_number").strip()
        targets.append(
            {"phone_number": phone_number, "context_variables": context_variables}
        )
    await db_client.initialize_call_targets(campaign.id, targets)


async def _get_editable_campaign(campaign_id: int, user: UserModel):
    campaign = await db_client.get_campaign(campaign_id, user.selected_organization_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if campaign.state != "created":
        raise HTTPException(status_code=409, detail="Call targets can only be edited before the campaign starts")
    if await db_client.count_queued_runs(campaign_id):
        raise HTTPException(status_code=409, detail="Call targets are already queued for dispatch")
    await _materialize_campaign_call_targets(campaign, user.selected_organization_id)
    return campaign


@router.get("/{campaign_id}/call-targets")
async def get_campaign_call_targets(
    campaign_id: int,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    user: UserModel = Depends(get_user),
) -> CampaignCallTargetsResponse:
    """List reviewed campaign contacts or the immutable dispatched queue."""
    campaign = await db_client.get_campaign(campaign_id, user.selected_organization_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    offset = (page - 1) * limit
    queued_runs, queued_count = await db_client.get_campaign_call_targets(
        campaign_id, limit, offset
    )
    if queued_count:
        return CampaignCallTargetsResponse(
            targets=[
                CampaignCallTargetResponse(
                    phone_number=str((queued_run.context_variables or {}).get("phone_number", "")),
                    context_variables={
                        key: value
                        for key, value in (queued_run.context_variables or {}).items()
                        if key != "phone_number"
                    },
                    state=queued_run.state,
                )
                for queued_run in queued_runs
                if (queued_run.context_variables or {}).get("phone_number")
            ],
            total_count=queued_count,
            page=page,
            limit=limit,
            total_pages=(queued_count + limit - 1) // limit,
        )

    if campaign.state == "created":
        await _materialize_campaign_call_targets(campaign, user.selected_organization_id)
        targets, total_count = await db_client.get_editable_call_targets(
            campaign_id, limit, offset
        )
        return CampaignCallTargetsResponse(
            targets=[
                CampaignCallTargetResponse(
                    id=target.id,
                    phone_number=target.phone_number,
                    context_variables=target.context_variables or {},
                    state="pending",
                )
                for target in targets
            ],
            total_count=total_count,
            page=page,
            limit=limit,
            total_pages=(total_count + limit - 1) // limit,
        )

    return CampaignCallTargetsResponse(targets=[], total_count=0, page=page, limit=limit, total_pages=0)


@router.post("/{campaign_id}/call-targets", response_model=CampaignCallTargetResponse)
async def create_campaign_call_target(
    campaign_id: int,
    request: CampaignCallTargetRequest,
    user: UserModel = Depends(get_user),
) -> CampaignCallTargetResponse:
    await _get_editable_campaign(campaign_id, user)
    target = await db_client.create_call_target(
        campaign_id, request.phone_number, request.context_variables
    )
    return CampaignCallTargetResponse(
        id=target.id,
        phone_number=target.phone_number,
        context_variables=target.context_variables or {},
        state="pending",
    )


@router.patch("/{campaign_id}/call-targets/{target_id}", response_model=CampaignCallTargetResponse)
async def update_campaign_call_target(
    campaign_id: int,
    target_id: int,
    request: CampaignCallTargetUpdateRequest,
    user: UserModel = Depends(get_user),
) -> CampaignCallTargetResponse:
    await _get_editable_campaign(campaign_id, user)
    updates = request.model_dump(exclude_none=True)
    target = await db_client.update_call_target(campaign_id, target_id, **updates)
    if not target:
        raise HTTPException(status_code=404, detail="Call target not found")
    return CampaignCallTargetResponse(
        id=target.id,
        phone_number=target.phone_number,
        context_variables=target.context_variables or {},
        state="pending",
    )


@router.delete("/{campaign_id}/call-targets/{target_id}", status_code=204)
async def delete_campaign_call_target(
    campaign_id: int,
    target_id: int,
    user: UserModel = Depends(get_user),
) -> None:
    await _get_editable_campaign(campaign_id, user)
    if not await db_client.delete_call_target(campaign_id, target_id):
        raise HTTPException(status_code=404, detail="Call target not found")



@router.get("/workflow/{workflow_id}/source-columns")
async def get_campaign_source_columns(
    workflow_id: int,
    user: UserModel = Depends(get_user),
) -> CampaignSourceColumnsResponse:
    """Return the CSV columns required to run a campaign with this workflow."""
    workflow = await db_client.get_workflow(
        workflow_id, organization_id=user.selected_organization_id
    )
    if not workflow or not workflow.released_definition:
        raise HTTPException(status_code=404, detail="Workflow not found")

    from api.services.workflow.dto import ReactFlowDTO
    from api.services.workflow.workflow_graph import WorkflowGraph

    try:
        graph = WorkflowGraph(ReactFlowDTO(**workflow.released_definition.workflow_json))
        required_columns = graph.get_required_template_variables()
    except Exception as exc:
        raise HTTPException(
            status_code=422,
            detail=f"Unable to determine workflow template variables: {exc}",
        ) from exc

    return CampaignSourceColumnsResponse(
        required_columns=["phone_number", *sorted(required_columns - {"phone_number"})]
    )

@router.delete("/{campaign_id}", status_code=204)
async def delete_campaign(
    campaign_id: int,
    user: UserModel = Depends(get_user),
) -> None:
    """Delete a campaign and cancel all queued or scheduled calls."""
    deleted = await db_client.delete_campaign(
        campaign_id, user.selected_organization_id
    )
    if not deleted:
        raise HTTPException(status_code=404, detail="Campaign not found")

@router.get("/{campaign_id}")
async def get_campaign(
    campaign_id: int,
    user: UserModel = Depends(get_user),
) -> CampaignResponse:
    """Get campaign details"""
    campaign = await db_client.get_campaign(campaign_id, user.selected_organization_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    workflow_name = await db_client.get_workflow_name(campaign.workflow_id, user.id)

    executed, total = await _get_campaign_stats(campaign.id)
    cfg_name = await _get_telephony_configuration_name(
        campaign.telephony_configuration_id, user.selected_organization_id
    )

    wf_template = None
    wf_vars = None
    if campaign.workflow_id:
        try:
            workflow = await db_client.get_workflow(
                campaign.workflow_id, user.selected_organization_id
            )
            if workflow and workflow.workflow_configurations:
                wf_template = workflow.workflow_configurations.get("report_template")
                raw_wf_vars = workflow.workflow_configurations.get("report_variables")
                if raw_wf_vars and isinstance(raw_wf_vars, list):
                    wf_vars = [
                        ReportVariableResponse(**v)
                        for v in raw_wf_vars
                        if isinstance(v, dict) and "name" in v
                    ]
        except Exception:
            pass

    return _build_campaign_response(
        campaign,
        workflow_name or "Unknown",
        executed,
        total,
        telephony_configuration_name=cfg_name,
        workflow_report_template=wf_template,
        workflow_report_variables=wf_vars,
    )


@router.post("/{campaign_id}/start")
async def start_campaign(
    campaign_id: int,
    user: UserModel = Depends(get_user),
) -> CampaignResponse:
    """Start campaign execution"""
    # Block start if the org has no telephony configuration at all.
    configs = await db_client.list_telephony_configurations(
        user.selected_organization_id
    )
    if not configs:
        raise HTTPException(
            status_code=401,
            detail="You must configure telephony first by going to APP_URL/configure-telephony",
        )

    # Verify campaign exists and belongs to organization
    campaign = await db_client.get_campaign(campaign_id, user.selected_organization_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    # Check Convozent quota before starting campaign (apply per-workflow
    # model_overrides so we evaluate the keys this campaign will use).
    quota_result = await authorize_workflow_run_start(
        workflow_id=campaign.workflow_id,
        actor_user=user,
    )
    if not quota_result.has_quota:
        raise HTTPException(status_code=402, detail=quota_result.error_message)

    # Start the campaign using the runner service
    try:
        await campaign_runner_service.start_campaign(campaign_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Get updated campaign
    campaign = await db_client.get_campaign(campaign_id, user.selected_organization_id)
    workflow_name = await db_client.get_workflow_name(campaign.workflow_id, user.id)

    executed, total = await _get_campaign_stats(campaign.id)
    cfg_name = await _get_telephony_configuration_name(
        campaign.telephony_configuration_id, user.selected_organization_id
    )
    return _build_campaign_response(
        campaign,
        workflow_name or "Unknown",
        executed,
        total,
        telephony_configuration_name=cfg_name,
    )


@router.post("/{campaign_id}/pause")
async def pause_campaign(
    campaign_id: int,
    user: UserModel = Depends(get_user),
) -> CampaignResponse:
    """Pause campaign execution"""
    # Verify campaign exists and belongs to organization
    campaign = await db_client.get_campaign(campaign_id, user.selected_organization_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    # Pause the campaign using the runner service
    try:
        await campaign_runner_service.pause_campaign(campaign_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Get updated campaign
    campaign = await db_client.get_campaign(campaign_id, user.selected_organization_id)
    workflow_name = await db_client.get_workflow_name(campaign.workflow_id, user.id)

    executed, total = await _get_campaign_stats(campaign.id)
    cfg_name = await _get_telephony_configuration_name(
        campaign.telephony_configuration_id, user.selected_organization_id
    )
    return _build_campaign_response(
        campaign,
        workflow_name or "Unknown",
        executed,
        total,
        telephony_configuration_name=cfg_name,
    )


@router.patch("/{campaign_id}")
async def update_campaign(
    campaign_id: int,
    request: UpdateCampaignRequest,
    user: UserModel = Depends(get_user),
) -> CampaignResponse:
    """Update campaign settings (name, retry config, max concurrency, schedule)"""
    campaign = await db_client.get_campaign(campaign_id, user.selected_organization_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    if campaign.state in ["completed", "failed"]:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot update a {campaign.state} campaign",
        )

    if request.max_concurrency is not None:
        await _validate_max_concurrency(
            request.max_concurrency, user.selected_organization_id
        )

    # Build update kwargs
    update_kwargs = {}

    if request.name is not None:
        update_kwargs["name"] = request.name

    if request.retry_config is not None:
        update_kwargs["retry_config"] = request.retry_config.model_dump()

    # Merge max_concurrency and schedule_config into orchestrator_metadata
    metadata = campaign.orchestrator_metadata or {}
    metadata_changed = False

    if request.max_concurrency is not None:
        metadata["max_concurrency"] = request.max_concurrency
        metadata_changed = True

    if request.schedule_config is not None:
        metadata["schedule_config"] = request.schedule_config.model_dump()
        metadata_changed = True

    if request.circuit_breaker is not None:
        metadata["circuit_breaker"] = request.circuit_breaker.model_dump()
        metadata_changed = True

    if request.report_template is not None:
        metadata["report_template"] = request.report_template
        metadata_changed = True

    if request.report_variables is not None:
        metadata["report_variables"] = [v.model_dump() for v in request.report_variables]
        metadata_changed = True

    if metadata_changed:
        update_kwargs["orchestrator_metadata"] = metadata

    if update_kwargs:
        await db_client.update_campaign(campaign_id=campaign_id, **update_kwargs)

    # Re-fetch to return updated data
    campaign = await db_client.get_campaign(campaign_id, user.selected_organization_id)
    workflow_name = await db_client.get_workflow_name(campaign.workflow_id, user.id)

    executed, total = await _get_campaign_stats(campaign.id)
    cfg_name = await _get_telephony_configuration_name(
        campaign.telephony_configuration_id, user.selected_organization_id
    )
    return _build_campaign_response(
        campaign,
        workflow_name or "Unknown",
        executed,
        total,
        telephony_configuration_name=cfg_name,
    )


@router.get("/{campaign_id}/runs")
async def get_campaign_runs(
    campaign_id: int,
    page: int = 1,
    limit: int = 50,
    filters: Optional[str] = Query(None, description="JSON-encoded filter criteria"),
    sort_by: Optional[str] = Query(
        None, description="Field to sort by (e.g., 'duration', 'created_at')"
    ),
    sort_order: Optional[str] = Query(
        "desc", description="Sort order ('asc' or 'desc')"
    ),
    user: UserModel = Depends(get_user),
) -> CampaignRunsResponse:
    """Get campaign workflow runs with pagination, filters and sorting"""
    offset = (page - 1) * limit

    # Parse filters if provided
    filter_criteria = []
    if filters:
        try:
            filter_criteria = json.loads(filters)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid filter format")

        # Restrict allowed filter attributes for regular users
        allowed_attributes = {
            "dateRange",
            "dispositionCode",
            "duration",
            "status",
            "tokenUsage",
        }
        for filter_item in filter_criteria:
            attribute = filter_item.get("attribute")
            if attribute and attribute not in allowed_attributes:
                raise HTTPException(
                    status_code=403, detail=f"Invalid attribute '{attribute}'"
                )

    try:
        runs, total_count = await db_client.get_campaign_runs_paginated(
            campaign_id,
            user.selected_organization_id,
            limit=limit,
            offset=offset,
            filters=filter_criteria if filter_criteria else None,
            sort_by=sort_by,
            sort_order=sort_order,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    total_pages = (total_count + limit - 1) // limit

    return CampaignRunsResponse(
        runs=[run.model_dump() for run in runs],
        total_count=total_count,
        page=page,
        limit=limit,
        total_pages=total_pages,
    )


@router.get("/{campaign_id}/analytics")
async def get_campaign_run_analytics(
    campaign_id: int,
    user: UserModel = Depends(get_user),
) -> CampaignRunAnalyticsResponse:
    """Return aggregate workflow-run metrics for one campaign."""
    try:
        analytics = await db_client.get_campaign_run_analytics(
            campaign_id, user.selected_organization_id
        )
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error))

    return CampaignRunAnalyticsResponse(**analytics)


class RedialCampaignRequest(BaseModel):
    name: Optional[str] = Field(
        None, min_length=1, max_length=255, description="Name for the redial campaign"
    )
    retry_on_voicemail: bool = True
    retry_on_no_answer: bool = True
    retry_on_busy: bool = True
    retry_config: Optional[RetryConfigRequest] = None

    @model_validator(mode="after")
    def validate_at_least_one_reason(self):
        if not (
            self.retry_on_voicemail or self.retry_on_no_answer or self.retry_on_busy
        ):
            raise ValueError(
                "At least one of retry_on_voicemail, retry_on_no_answer, "
                "retry_on_busy must be true"
            )
        return self


@router.post("/{campaign_id}/redial")
async def redial_campaign(
    campaign_id: int,
    request: RedialCampaignRequest,
    user: UserModel = Depends(get_user),
) -> CampaignResponse:
    """Create a new campaign that re-dials unique subscribers from a completed
    campaign whose latest call resulted in voicemail, no-answer, or busy.

    The new campaign is created in 'created' state with queued_runs pre-seeded
    from the parent's original initial contexts. A campaign can be redialed at
    most once.
    """
    parent = await db_client.get_campaign(campaign_id, user.selected_organization_id)
    if not parent:
        raise HTTPException(status_code=404, detail="Campaign not found")

    if parent.state != "completed":
        raise HTTPException(
            status_code=400,
            detail=f"Only completed campaigns can be redialed (current state: {parent.state})",
        )

    parent_meta = parent.orchestrator_metadata or {}
    if parent_meta.get("redialed_campaign_id"):
        raise HTTPException(
            status_code=400,
            detail="This campaign has already been redialed",
        )

    candidates = await db_client.get_redial_candidates(
        campaign_id=parent.id,
        include_voicemail=request.retry_on_voicemail,
        include_no_answer=request.retry_on_no_answer,
        include_busy=request.retry_on_busy,
    )
    if not candidates:
        raise HTTPException(
            status_code=400,
            detail="No subscribers match the selected redial criteria",
        )

    queued_runs_data = [
        {
            "campaign_id": 0,  # replaced inside create_redial_campaign
            "source_uuid": c["source_uuid"],
            "context_variables": c["context_variables"],
            "state": "queued",
        }
        for c in candidates
    ]

    retry_config = (
        request.retry_config.model_dump()
        if request.retry_config
        else parent.retry_config
    )
    new_name = request.name or f"{parent.name} (Redial)"

    try:
        child = await db_client.create_redial_campaign(
            parent_campaign=parent,
            new_name=new_name,
            retry_config=retry_config,
            queued_runs_data=queued_runs_data,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    workflow_name = await db_client.get_workflow_name(child.workflow_id, user.id)
    executed, total = await _get_campaign_stats(child.id)
    cfg_name = await _get_telephony_configuration_name(
        child.telephony_configuration_id, user.selected_organization_id
    )
    return _build_campaign_response(
        child,
        workflow_name or "Unknown",
        executed,
        total,
        telephony_configuration_name=cfg_name,
    )


@router.post("/{campaign_id}/resume")
async def resume_campaign(
    campaign_id: int,
    user: UserModel = Depends(get_user),
) -> CampaignResponse:
    """Resume a paused campaign"""
    # Block resume if the org has no telephony configuration at all.
    configs = await db_client.list_telephony_configurations(
        user.selected_organization_id
    )
    if not configs:
        raise HTTPException(
            status_code=401,
            detail="You must configure telephony first by going to APP_URL/configure-telephony",
        )

    # Verify campaign exists and belongs to organization
    campaign = await db_client.get_campaign(campaign_id, user.selected_organization_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    # Check Convozent quota before resuming campaign (apply per-workflow
    # model_overrides so we evaluate the keys this campaign will use).
    quota_result = await authorize_workflow_run_start(
        workflow_id=campaign.workflow_id,
        actor_user=user,
    )
    if not quota_result.has_quota:
        raise HTTPException(status_code=402, detail=quota_result.error_message)

    # Resume the campaign using the runner service
    try:
        await campaign_runner_service.resume_campaign(campaign_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Get updated campaign
    campaign = await db_client.get_campaign(campaign_id, user.selected_organization_id)
    workflow_name = await db_client.get_workflow_name(campaign.workflow_id, user.id)

    executed, total = await _get_campaign_stats(campaign.id)
    cfg_name = await _get_telephony_configuration_name(
        campaign.telephony_configuration_id, user.selected_organization_id
    )
    return _build_campaign_response(
        campaign,
        workflow_name or "Unknown",
        executed,
        total,
        telephony_configuration_name=cfg_name,
    )


@router.get("/{campaign_id}/progress")
async def get_campaign_progress(
    campaign_id: int,
    user: UserModel = Depends(get_user),
) -> CampaignProgressResponse:
    """Get current campaign progress and statistics"""
    # Verify campaign exists and belongs to organization
    campaign = await db_client.get_campaign(campaign_id, user.selected_organization_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    # Get progress from runner service
    try:
        progress = await campaign_runner_service.get_campaign_status(campaign_id)
        return CampaignProgressResponse(**progress)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


class CampaignSourceDownloadResponse(BaseModel):
    download_url: str
    expires_in: int


@router.get("/{campaign_id}/source-download-url")
async def get_campaign_source_download_url(
    campaign_id: int,
    user: UserModel = Depends(get_user),
) -> CampaignSourceDownloadResponse:
    """Get presigned download URL for campaign CSV source file
    Validates that the campaign belongs to the user's organization for security.
    """
    # Verify campaign exists and belongs to organization
    campaign = await db_client.get_campaign(campaign_id, user.selected_organization_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    # Only generate download URL for CSV files
    if campaign.source_type != "csv":
        raise HTTPException(
            status_code=400,
            detail=f"Download URL only available for CSV sources. This campaign uses {campaign.source_type}",
        )

    # Verify the file key belongs to the user's organization
    # File key format: campaigns/{org_id}/{uuid}_{filename}.csv
    if not campaign.source_id.startswith(f"campaigns/{user.selected_organization_id}/"):
        raise HTTPException(
            status_code=403,
            detail="Access denied: Source file does not belong to your organization",
        )

    # Generate presigned download URL
    try:
        download_url = await storage_fs.aget_signed_url(
            campaign.source_id,
            expiration=3600,  # 1 hour
        )

        if not download_url:
            raise HTTPException(
                status_code=500, detail="Failed to generate download URL"
            )

        return CampaignSourceDownloadResponse(
            download_url=download_url, expires_in=3600
        )
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to generate download URL: {str(e)}"
        )


@router.get("/{campaign_id}/report")
async def download_campaign_report(
    campaign_id: int,
    user: UserModel = Depends(get_user),
    start_date: Optional[datetime] = Query(
        None, description="Filter runs created on or after this datetime (ISO 8601)"
    ),
    end_date: Optional[datetime] = Query(
        None, description="Filter runs created on or before this datetime (ISO 8601)"
    ),
) -> StreamingResponse:
    """Download a CSV report of completed campaign runs."""
    campaign = await db_client.get_campaign(campaign_id, user.selected_organization_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    output, filename = await generate_campaign_report_csv(
        campaign_id, start_date=start_date, end_date=end_date
    )

    return StreamingResponse(
        output,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{campaign_id}/report/pdf")
async def download_campaign_report_pdf(
    campaign_id: int,
    user: UserModel = Depends(get_user),
    start_date: Optional[datetime] = Query(
        None, description="Filter runs created on or after this datetime (ISO 8601)"
    ),
    end_date: Optional[datetime] = Query(
        None, description="Filter runs created on or before this datetime (ISO 8601)"
    ),
) -> StreamingResponse:
    """Download a ZIP of PDF reports generated from the campaign's report template."""
    campaign = await db_client.get_campaign(campaign_id, user.selected_organization_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    metadata = campaign.orchestrator_metadata or {}
    template_html = metadata.get("report_template")

    if not template_html:
        raise HTTPException(
            status_code=400,
            detail="No report template configured. Add a report template before downloading PDF reports.",
        )

    output, filename = await generate_campaign_report_pdf(
        campaign_id, template_html, start_date=start_date, end_date=end_date
    )

    return StreamingResponse(
        output,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{campaign_id}/report/preview")
async def get_campaign_report_preview(
    campaign_id: int,
    user: UserModel = Depends(get_user),
    refresh: bool = Query(False, description="Force LLM regeneration of report variables"),
) -> JSONResponse:
    """Return the rendered HTML report preview for a campaign, with LLM-generated qualitative variables."""
    campaign = await db_client.get_campaign(campaign_id, user.selected_organization_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    metadata = dict(campaign.orchestrator_metadata or {})
    template_html = metadata.get("report_template")

    workflow_configs = {}
    if campaign.workflow_id:
        try:
            workflow = await db_client.get_workflow(
                campaign.workflow_id, user.selected_organization_id
            )
            if workflow and workflow.workflow_configurations:
                workflow_configs = workflow.workflow_configurations
                if not template_html:
                    template_html = workflow_configs.get("report_template")
        except Exception:
            pass

    if not template_html:
        from api.constants import DEFAULT_CAMPAIGN_REPORT_TEMPLATE
        template_html = DEFAULT_CAMPAIGN_REPORT_TEMPLATE

    # Fetch runs and queued runs for campaign
    runs = await db_client.get_workflow_runs_by_campaign(campaign_id)
    queued_runs = await db_client.get_queued_runs_for_campaign(campaign_id)
    provider_name = await _get_telephony_configuration_name(
        campaign.telephony_configuration_id, user.selected_organization_id
    )

    # Resolve report_variables_defs from campaign metadata or workflow
    raw_vars = metadata.get("report_variables") or workflow_configs.get("report_variables")
    report_variables_defs = None
    if raw_vars and isinstance(raw_vars, list):
        report_variables_defs = [
            ReportVariable(
                name=v["name"],
                type=ReportVariableType(v.get("type", "text")),
                description=v.get("description", ""),
            )
            for v in raw_vars
            if isinstance(v, dict) and "name" in v
        ]

    # Discover undeclared variables from template; exclude builtin metrics
    all_llm_variable_defs = resolve_definitions(
        template_html, report_variables_defs, exclude=CAMPAIGN_BUILTIN_VARS
    )

    # Build preliminary numerical/telephony context
    context = build_campaign_report_context(
        campaign,
        runs,
        queued_runs,
        provider_name,
        report_variables_defs=report_variables_defs,
    )

    # Check cached LLM generated variables; empty cached values count as missing
    # so regeneration self-heals without force_refresh.
    cached_llm_vars = {} if refresh else metadata.get("report_variables_values", {})
    missing_vars = missing_cached_vars(all_llm_variable_defs, cached_llm_vars)

    campaign_summary_data = None
    llm_config = None
    if missing_vars and (runs or queued_runs):
        try:
            llm_resolved = await get_effective_ai_model_configuration_for_workflow(
                user_id=None,
                organization_id=user.selected_organization_id,
                workflow_configurations=workflow_configs,
            )
            if llm_resolved and llm_resolved.llm:
                base_url, model, api_key = openai_params(llm_resolved.llm)
                llm_config = {"api_key": api_key, "model": model, "base_url": base_url}

                # Construct representative summary data for LLM
                sample_outcomes = []
                for r in runs[:15]:
                    init = r.initial_context or {}
                    gathered = r.gathered_context or {}
                    sample_outcomes.append({
                        "name": init.get("name") or init.get("full_name") or "Contact",
                        "phone": init.get("phone_number") or getattr(r, "caller_number", ""),
                        "disposition": gathered.get("mapped_call_disposition") or r.state,
                        "duration_sec": (r.usage_info or {}).get("call_duration_seconds", 0),
                        "extracted": gathered.get("extracted_variables", {}),
                    })

                campaign_summary_data = {
                    "campaign_name": campaign.name,
                    "campaign_status": campaign.state,
                    "total_targets": context.get("total_targets", 0),
                    "total_calls": context.get("total_calls", 0),
                    "connected_calls": context.get("connected_calls", 0),
                    "connection_rate": f"{context.get('connection_rate', 0)}%",
                    "average_call_duration": context.get("average_call_duration", "0s"),
                    "call_dispositions": context.get("call_dispositions", {}),
                    "sample_customer_outcomes": sample_outcomes,
                }

                newly_extracted = await extract_campaign_report_variables(
                    campaign_summary_data, missing_vars, llm_config
                )
                if newly_extracted:
                    cached_llm_vars = {**cached_llm_vars, **newly_extracted}
                    metadata["report_variables_values"] = cached_llm_vars
                    await db_client.update_campaign(
                        campaign_id, orchestrator_metadata=metadata
                    )
        except Exception as e:
            if _is_quota_error(e):
                raise HTTPException(
                    status_code=429,
                    detail="LLM quota exhausted while generating campaign report variables. Try again later.",
                )
            logger.warning(f"Could not generate campaign LLM variables: {e}")

    # Complete every defined variable on a render copy: rollups, gap-fill,
    # placeholders. Persist to cache only when an LLM actually ran this request
    # or a prior extracted cache exists — caching placeholders from a configless
    # request would block future real extraction.
    render_vars = dict(cached_llm_vars)
    finalize_meta: dict = {}
    if all_llm_variable_defs:
        finalize_meta = await finalize_campaign_variables(
            render_vars,
            all_llm_variable_defs,
            payload=campaign_summary_data,
            llm_config=llm_config,
        )
        if cached_llm_vars:
            cached_llm_vars = render_vars
            metadata["report_variables_values"] = cached_llm_vars
            metadata["report_variables_meta"] = finalize_meta
            await db_client.update_campaign(campaign_id, orchestrator_metadata=metadata)

    # Re-build final context with completed variables injected
    context = build_campaign_report_context(
        campaign,
        runs,
        queued_runs,
        provider_name,
        report_variables_defs=report_variables_defs,
        llm_generated_variables=render_vars,
    )

    try:
        rendered = render_template_html(template_html, context)
    except Exception as e:
        logger.error(f"Failed to render campaign report for campaign {campaign_id}: {e}")
        raise HTTPException(
            status_code=400,
            detail=f"Failed to render campaign report template: {e}",
        )

    return JSONResponse(
        content={
            "rendered_html": rendered,
            "campaign_name": campaign.name,
            "campaign_id": campaign.id,
        }
    )


@router.post("/{campaign_id}/report/regenerate")
async def regenerate_campaign_report(
    campaign_id: int,
    user: UserModel = Depends(get_user),
) -> JSONResponse:
    """Clear cached LLM report variables and regenerate campaign report preview."""
    campaign = await db_client.get_campaign(campaign_id, user.selected_organization_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    metadata = dict(campaign.orchestrator_metadata or {})
    if "report_variables_values" in metadata:
        del metadata["report_variables_values"]
        await db_client.update_campaign(campaign_id, orchestrator_metadata=metadata)

    return await get_campaign_report_preview(campaign_id, user=user, refresh=True)


@router.post("/{campaign_id}/report/generate")
async def generate_campaign_report_endpoint(
    campaign_id: int,
    user: UserModel = Depends(get_user),
    force_refresh: bool = Query(True, description="Force LLM regeneration of qualitative variables"),
) -> JSONResponse:
    """Enqueue background ARQ task to generate/regenerate the campaign AI report."""
    campaign = await db_client.get_campaign(campaign_id, user.selected_organization_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    metadata = dict(campaign.orchestrator_metadata or {})
    metadata["report_generation_status"] = "generating"
    metadata["report_error"] = None
    if force_refresh and "report_variables_values" in metadata:
        del metadata["report_variables_values"]
    await db_client.update_campaign(campaign_id, orchestrator_metadata=metadata)

    try:
        from api.tasks.arq import enqueue_job
        from api.tasks.function_names import FunctionNames
        await enqueue_job(
            FunctionNames.GENERATE_CAMPAIGN_REPORT,
            campaign_id=campaign_id,
            force_refresh=force_refresh,
        )
    except Exception as e:
        logger.error(f"Failed to enqueue generate_campaign_report for campaign {campaign_id}: {e}")
        try:
            from api.tasks.campaign_report_tasks import generate_campaign_report
            await generate_campaign_report({}, campaign_id=campaign_id, force_refresh=force_refresh)
        except Exception as sync_e:
            raise HTTPException(status_code=500, detail=f"Report generation failed: {sync_e}")

    return JSONResponse(
        status_code=202,
        content={
            "status": "generating",
            "message": "Campaign report generation initiated in background.",
            "campaign_id": campaign_id,
        },
    )


@router.get("/{campaign_id}/report/status")
async def get_campaign_report_status(
    campaign_id: int,
    user: UserModel = Depends(get_user),
) -> JSONResponse:
    """Check the status of campaign report generation."""
    campaign = await db_client.get_campaign(campaign_id, user.selected_organization_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    metadata = campaign.orchestrator_metadata or {}
    status = metadata.get("report_generation_status", "pending")
    if not status or status == "pending":
        if metadata.get("report_variables_values") or metadata.get("report_generated_at"):
            status = "completed"

    return JSONResponse(
        content={
            "campaign_id": campaign_id,
            "status": status,
            "generated_at": metadata.get("report_generated_at"),
            "pdf_key": metadata.get("report_s3_key"),
            "error": metadata.get("report_error"),
        }
    )


