import json
import re
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from fastapi.responses import JSONResponse, StreamingResponse
from loguru import logger
from pydantic import BaseModel, Field, ValidationError

from api.constants import MAX_RANGE_DAYS
from api.db import db_client
from api.db.agent_trigger_client import TriggerPathConflictError
from api.db.models import UserModel, WorkflowModel
from api.db.workflow_template_client import WorkflowTemplateClient
from api.enums import CallType, PostHogEvent, StorageBackend, WorkflowStatus
from api.schemas.agent_analytics import AgentAnalyticsResponse
from api.schemas.ai_model_configuration import OrganizationAIModelConfigurationV2
from api.schemas.provider_usage import ProviderRequestLookup
from api.schemas.workflow import WorkflowRunResponseSchema
from api.sdk_expose import sdk_expose
from api.services.auth.depends import get_user
from api.services.configuration.ai_model_configuration import (
    WORKFLOW_MODEL_CONFIGURATION_V2_OVERRIDE_KEY,
    WORKFLOW_PLATFORM_MODEL_CONFIGURATION_ID_KEY,
    check_for_masked_keys_in_ai_model_configuration_v2,
    compile_ai_model_configuration_v2,
    convert_legacy_ai_model_configuration_to_v2,
    get_resolved_ai_model_configuration,
    merge_ai_model_configuration_v2_secrets,
    resolve_preset_name_for_workflow,
)
from api.services.configuration.check_validity import UserConfigurationValidator
from api.services.configuration.masking import (
    mask_workflow_configurations,
    mask_workflow_definition,
    merge_workflow_api_keys,
)
from api.services.configuration.merge import merge_workflow_configuration_secrets
from api.services.configuration.resolve import (
    enrich_overrides_with_api_keys,
    resolve_effective_config,
)
from api.services.posthog_client import capture_event
from api.services.reports import generate_workflow_report_csv
from api.services.reports.agent_analytics import get_agent_analytics
from api.services.reports.pdf_report import (
    generate_workflow_report_pdf,
    render_template_html,
)
from api.services.reports.report_context import (
    build_report_context,
)
from api.services.reports.variable_engine import (
    resolve_definitions,
)
from api.services.storage import storage_fs
from api.services.workflow.agent_utilization import AgentUtilisationService
from api.services.workflow.conversation_display import resolve_display_title
from api.services.workflow.dto import ReactFlowDTO, sanitize_workflow_definition
from api.services.workflow.duplicate import duplicate_workflow
from api.services.workflow.errors import ItemKind, WorkflowError
from api.services.workflow.run_usage_response import (
    format_public_cost_info,
    format_public_usage_info,
)
from api.services.workflow.template_generation import (
    WorkflowGenerationError,
    generate_workflow_from_description,
)
from api.services.workflow.trigger_paths import (
    TriggerPathIssue,
    ensure_trigger_paths,
    extract_trigger_paths,
    regenerate_trigger_uuids,
    trigger_path_to_node_id,
    validate_trigger_paths,
)
from api.services.workflow.workflow_graph import WorkflowGraph
from api.tasks.arq import enqueue_job
from api.tasks.function_names import FunctionNames
from api.tasks.report_sweep import STALE_MINUTES as REPORT_STALE_MINUTES
from api.utils.artifacts import artifact_url
from api.utils.recording_artifacts import (
    get_recording_storage_key,
    has_recording_track,
)

router = APIRouter(prefix="/workflow")


async def _require_active_plan(
    organization_id: int, allow_admin_override: bool = True
) -> None:
    """Enforce plan before creating agents — but allow Admin to create first, Org buys after.

    Present flow you asked: Admin creates BillingPlan (Admin > Billing Plans), Agent can be created as draft
    without plan, then Admin/Org buys plan (Billing > Subscribe or Admin > Organizations) before Run.
    Billing is still per-Org (org_subscriptions + OrgWallet billing_plan_id), not per-agent.
    If wallet has no plan, block only if wallet exists and is not super-admin override — keeps no-file-edit.
    """
    from api.services.billing.service import billing_service

    wallet = await billing_service.get_wallet(organization_id)
    if not wallet or not wallet.billing_plan_id:
        # Allow draft creation without plan — block only at publish/run via _require_sufficient_credits
        # To keep strict no-free-tier in prod, uncomment next 4 lines:
        # raise HTTPException(
        #     status_code=402,
        #     detail="Please purchase a plan before creating agents. Visit /billing to subscribe. No free tier available.",
        # )
        return


async def _require_sufficient_credits(
    organization_id: int, user: UserModel | None = None
) -> None:
    """Block Test Agent when wallet $0 and exhaustion_policy=pause — prod will pause.

    Test grace let #54/#55 work after $0, but prod will pause — next Run Test must show
    `Insufficient credits` until Billing > Add Credits restores balance.
    Admin (is_superuser) bypass — you already told admin not to buy, only Org buys admin config plan.
    """
    from api.services.billing.service import billing_service

    # Admin bypass — don't block admin section test, only Org users need credits
    if user and getattr(user, "is_superuser", False):
        return

    wallet = await billing_service.get_wallet(organization_id)
    if not wallet:
        raise HTTPException(
            status_code=402,
            detail={
                "message": "No wallet found. Visit Billing to set up credits.",
                "code": "insufficient_credits",
                "error_type": "insufficient_credits",
            },
        )
    try:
        balance = float(wallet.balance) if wallet.balance is not None else 0.0
    except Exception:
        balance = 0.0
    policy = getattr(wallet, "exhaustion_policy", "pause")
    # Pay-as-you-go: allow runs with credits even if no plan (Free Tier + top-up).
    # Only block if balance is 0 on pause, or if no plan AND no balance.
    if not wallet.billing_plan_id:
        if balance <= 0.0:
            raise HTTPException(
                status_code=402,
                detail={
                    "message": "Please add credits or subscribe to a plan before running tests. Visit Billing > Add Credits or Subscribe to Plan.",
                    "code": "insufficient_credits",
                    "error_type": "insufficient_credits",
                },
            )
        return  # has credits, no plan -> allow pay-as-you-go
    if policy == "pause" and balance <= 0.0:
        # Use the plan's rate to tell them how much a run costs
        raise HTTPException(
            status_code=402,
            detail={
                "message": f"Insufficient credits: Wallet ${balance:.2f}. Please add credits in Billing > Add Credits to resume. Current plan requires top-up before next run.",
                "code": "insufficient_credits",
                "error_type": "insufficient_credits",
            },
        )


class ValidateWorkflowResponse(BaseModel):
    is_valid: bool
    errors: list[WorkflowError]


def _trigger_conflict_http_exception(
    workflow_definition: Optional[dict], conflicting_paths: list[str]
) -> HTTPException:
    """Build a 409 with the same detail shape as validate's 422 so the editor
    can highlight the offending trigger node(s) using the same code path."""
    path_to_node = (
        trigger_path_to_node_id(workflow_definition) if workflow_definition else {}
    )
    errors: list[WorkflowError] = [
        WorkflowError(
            kind=ItemKind.node,
            id=path_to_node.get(p),
            field="data.trigger_path",
            message=(
                "Trigger path is already in use. Please choose another one "
                "or leave empty to use a unique one generated by the server."
            ),
        )
        for p in conflicting_paths
    ]
    return HTTPException(
        status_code=409,
        detail=ValidateWorkflowResponse(is_valid=False, errors=errors).model_dump(),
    )


def _trigger_path_validation_http_exception(
    issues: list[TriggerPathIssue],
) -> HTTPException:
    errors = [
        WorkflowError(
            kind=ItemKind.node,
            id=issue.node_id,
            field="data.trigger_path",
            message=issue.message,
        )
        for issue in issues
    ]
    return HTTPException(
        status_code=422,
        detail=ValidateWorkflowResponse(is_valid=False, errors=errors).model_dump(),
    )


async def _validate_workflow_definition(
    workflow_definition: Optional[dict],
    exclude_workflow_id: Optional[int] = None,
) -> list[WorkflowError]:
    """Run DTO + graph + trigger-conflict checks on a workflow definition.

    Returns the list of errors (empty if the definition is valid). This is
    the single source of truth for "is this workflow valid?" — used by the
    /validate route (read-only audit) and the /publish route (gate).
    """
    errors: list[WorkflowError] = []
    if not workflow_definition:
        return errors

    # ----------- DTO Validation ------------
    dto: Optional[ReactFlowDTO] = None
    try:
        dto = ReactFlowDTO.model_validate(workflow_definition)
    except ValidationError as exc:
        errors.extend(_transform_schema_errors(exc, workflow_definition))

    # ----------- Graph Validation if DTO is valid ------------
    try:
        if dto:
            WorkflowGraph(dto)
    except ValueError as e:
        errors.extend(e.args[0])

    # ----------- Trigger Path Format Check ------------
    for issue in validate_trigger_paths(workflow_definition):
        errors.append(
            WorkflowError(
                kind=ItemKind.node,
                id=issue.node_id,
                field="data.trigger_path",
                message=issue.message,
            )
        )

    # ----------- Trigger Path Conflict Check ------------
    trigger_paths = extract_trigger_paths(workflow_definition)
    if trigger_paths:
        conflicts = await db_client.check_trigger_path_conflicts(
            trigger_paths=trigger_paths,
            exclude_workflow_id=exclude_workflow_id,
        )
        if conflicts:
            path_to_node = trigger_path_to_node_id(workflow_definition)
            for conflicting_path in conflicts:
                errors.append(
                    WorkflowError(
                        kind=ItemKind.node,
                        id=path_to_node.get(conflicting_path),
                        field="data.trigger_path",
                        message=(
                            "Trigger path is already in use. Please choose "
                            "another one or leave empty to use a unique one "
                            "generated by the server."
                        ),
                    )
                )

    return errors


def _validation_errors_http_exception(
    errors: list[WorkflowError], status_code: int = 422
) -> HTTPException:
    """Wrap a list of validation errors in the response shape clients expect."""
    return HTTPException(
        status_code=status_code,
        detail=ValidateWorkflowResponse(is_valid=False, errors=errors).model_dump(),
    )


def _validated_utilization(value: str | None) -> str:
    """Normalize/validate an agent utilisation value (public/private/closed)."""
    return AgentUtilisationService.normalize_utilisation(value)


async def _require_agent_access(
    workflow_id: int, user: UserModel, *, utilise: bool = False
) -> WorkflowModel:
    """Load an agent the caller is allowed to use, else 404.

    Every agent-scoped route goes through here so the utilisation policy is
    enforced in exactly one place and a restricted agent is indistinguishable
    from a missing one (no IDOR probing).
    """
    return await AgentUtilisationService.require_agent(
        user, workflow_id, utilise=utilise
    )


class CallDispositionCodes(BaseModel):
    disposition_codes: list[str] = []


class WorkflowResponse(BaseModel):
    id: int
    name: str
    status: str
    created_at: datetime
    workflow_definition: dict
    current_definition_id: int | None
    template_context_variables: dict | None = None
    call_disposition_codes: CallDispositionCodes | None = None
    total_runs: int | None = None
    workflow_configurations: dict | None = None
    version_number: int | None = None
    version_status: str | None = None
    workflow_uuid: str | None = None
    utilization_type: str = "public"
    created_by_user_id: int | None = None
    is_creator: bool = False
    # Explicit grants for the private policy; the creator always has access.
    private_allowed_user_ids: list[int] = []


class WorkflowListResponse(BaseModel):
    """Lightweight response for workflow listings (excludes large fields)."""

    id: int
    name: str
    status: str
    created_at: datetime
    total_runs: int
    folder_id: int | None = None
    workflow_uuid: str | None = None
    platform_model_configuration_id: int | None = None
    utilization_type: str = "public"
    # Agent creator and current caller's creator status (the latter avoids
    # comparing provider ids in the frontend).
    is_creator: bool = False
    created_by_user_id: int | None = None
    # Explicit grants for the private policy; the creator always has access.
    private_allowed_user_ids: list[int] = []


class MoveWorkflowToFolderRequest(BaseModel):
    """Move a workflow into a folder, or to "Uncategorized" when null."""

    folder_id: int | None = None


class WorkflowCountResponse(BaseModel):
    """Response for workflow count endpoint."""

    total: int
    active: int
    archived: int


class WorkflowTemplateResponse(BaseModel):
    id: int
    template_name: str
    template_description: str
    template_json: dict
    created_at: datetime


class CreateWorkflowRequest(BaseModel):
    name: str
    workflow_definition: dict
    utilization_type: str = "public"
    # Explicit grants for utilization_type == "private". Ignored for the other
    # policies (they derive access from the organization / reporting tree).
    private_allowed_user_ids: list[int] | None = None


class DuplicateTemplateRequest(BaseModel):
    template_id: int
    workflow_name: str


class UpdateWorkflowRequest(BaseModel):
    name: str | None = None
    workflow_definition: dict | None = None
    template_context_variables: dict | None = None
    workflow_configurations: dict | None = None
    utilization_type: str | None = None
    # Replace the explicit-grant list. ``None`` leaves it untouched; ``[]`` clears it.
    private_allowed_user_ids: list[int] | None = None


class WorkflowVersionResponse(BaseModel):
    id: int
    version_number: int
    status: str
    created_at: datetime
    published_at: datetime | None = None
    workflow_json: dict
    workflow_configurations: dict | None = None
    template_context_variables: dict | None = None


class UpdateWorkflowStatusRequest(BaseModel):
    status: str  # "active" or "archived"


class CreateWorkflowRunRequest(BaseModel):
    mode: str
    name: str


class CreateWorkflowRunResponse(BaseModel):
    id: int
    workflow_id: int
    name: str
    conversation_title: str | None = None
    mode: str
    created_at: datetime
    definition_id: int
    initial_context: dict | None = None


class CreateWorkflowTemplateRequest(BaseModel):
    call_type: Literal["inbound", "outbound"]
    use_case: str
    activity_description: str
    # Admin-defined model configuration preset the org user selected. Optional
    # for backward-compat / OSS; when set, it is stored on the new agent and
    # drives the pipeline's model/provider/keys/language at runtime.
    platform_model_configuration_id: int | None = None
    # Whether the new agent records video during WebRTC calls/tests. Persisted
    # onto workflow_configurations; recording stays off unless this is true.
    enable_video_recording: bool = False
    # Agent utilisation policy chosen at creation: public/private/closed.
    utilization_type: str = "public"
    # Explicit members for a Private agent created from a template.
    private_allowed_user_ids: list[int] | None = None


@router.post("/{workflow_id}/validate")
async def validate_workflow(
    workflow_id: int,
    user: UserModel = Depends(get_user),
) -> ValidateWorkflowResponse:
    """
    Validate all nodes in a workflow to ensure they have required fields.

    Args:
        workflow_id: The ID of the workflow to validate
        user: The authenticated user

    Returns:
        Object indicating if workflow is valid and any invalid nodes/edges
    """
    workflow = await _require_agent_access(workflow_id, user)

    # Validate draft if it exists (user is editing), else validate published
    draft = await db_client.get_draft_version(workflow_id)
    workflow_definition = (
        draft.workflow_json if draft else workflow.released_definition.workflow_json
    )

    errors = await _validate_workflow_definition(
        workflow_definition, exclude_workflow_id=workflow_id
    )

    if errors:
        raise _validation_errors_http_exception(errors)

    return ValidateWorkflowResponse(is_valid=True, errors=[])


def _transform_schema_errors(
    exc: ValidationError, workflow_definition: dict
) -> list[WorkflowError]:
    out: list[WorkflowError] = []

    for err in exc.errors():
        loc = err["loc"]
        idx = workflow_definition[loc[0]][loc[1]]["id"]

        kind: ItemKind = ItemKind.node if loc[0] == "nodes" else ItemKind.edge

        out.append(
            WorkflowError(
                kind=kind,
                id=idx,
                field=".".join(str(p) for p in err["loc"][2:]) or None,
                message=err["msg"].capitalize(),
            )
        )
    return out


@router.post(
    "/create/definition",
    **sdk_expose(
        method="create_workflow",
        description="Create a new workflow from a workflow definition.",
    ),
)
async def create_workflow(
    request: CreateWorkflowRequest, user: UserModel = Depends(get_user)
) -> WorkflowResponse:
    """
    Create a new workflow from the client

    Args:
        request: The create workflow request
        user: The user to create the workflow for
    """
    await _require_active_plan(user.selected_organization_id)
    # Free tier: 1 agent total — creation guard only, run path untouched.
    from api.services.billing.agent_limits import agent_limit_guard

    await agent_limit_guard.assert_can_create_agent(
        user.selected_organization_id, kind="voice", user=user
    )
    # Auto-mint trigger_path for any trigger node that didn't ship one so
    # clients don't need to generate UUIDs themselves.
    workflow_definition = ensure_trigger_paths(request.workflow_definition)
    trigger_path_issues = validate_trigger_paths(workflow_definition)
    if trigger_path_issues:
        raise _trigger_path_validation_http_exception(trigger_path_issues)

    # Validate trigger path uniqueness BEFORE creating the workflow so we
    # don't leave an orphaned workflow record when the trigger conflicts.
    trigger_paths = (
        extract_trigger_paths(workflow_definition) if workflow_definition else []
    )
    if trigger_paths:
        try:
            await db_client.assert_trigger_paths_available(
                trigger_paths=trigger_paths,
            )
        except TriggerPathConflictError as e:
            raise _trigger_conflict_http_exception(workflow_definition, e.trigger_paths)

    workflow = await db_client.create_workflow(
        request.name,
        workflow_definition,
        user.id,
        user.selected_organization_id,
        utilization_type=_validated_utilization(request.utilization_type),
        private_allowed_user_ids=await AgentUtilisationService.normalize_grantee_ids(
            user.selected_organization_id,
            request.private_allowed_user_ids,
            user.id,
        ),
    )

    capture_event(
        distinct_id=str(user.provider_id),
        event=PostHogEvent.WORKFLOW_CREATED,
        properties={
            "workflow_id": workflow.id,
            "workflow_name": workflow.name,
            "source": "direct",
            "organization_id": user.selected_organization_id,
        },
    )

    if trigger_paths:
        await db_client.sync_triggers_for_workflow(
            workflow_id=workflow.id,
            organization_id=user.selected_organization_id,
            trigger_paths=trigger_paths,
        )

    return {
        "id": workflow.id,
        "name": workflow.name,
        "status": workflow.status,
        "created_at": workflow.created_at,
        "workflow_definition": mask_workflow_definition(workflow_definition),
        "current_definition_id": workflow.current_definition_id,
        "template_context_variables": workflow.template_context_variables,
        "call_disposition_codes": workflow.call_disposition_codes,
        "workflow_configurations": mask_workflow_configurations(
            workflow.workflow_configurations
        ),
        "utilization_type": workflow.utilization_type,
        "private_allowed_user_ids": workflow.private_allowed_user_ids or [],
        "created_by_user_id": workflow.user_id,
        "is_creator": AgentUtilisationService.is_creator(workflow, user),
    }


@router.post("/create/template")
async def create_workflow_from_template(
    request: CreateWorkflowTemplateRequest,
    user: UserModel = Depends(get_user),
) -> WorkflowResponse:
    """Create a new workflow from a natural language template request.

    Generation runs against the organization's own configured LLM (BYOK) —
    the hosted MPS generator this used to call no longer exists.
    """
    await _require_active_plan(user.selected_organization_id)
    from api.services.billing.agent_limits import agent_limit_guard

    await agent_limit_guard.assert_can_create_agent(
        user.selected_organization_id, kind="voice", user=user
    )
    try:
        name, workflow_data = await generate_workflow_from_description(
            call_type=request.call_type,
            use_case=request.use_case,
            activity_description=request.activity_description,
            organization_id=user.selected_organization_id,
            user_id=user.id,
            platform_model_configuration_id=request.platform_model_configuration_id,
        )
    except WorkflowGenerationError as e:
        raise HTTPException(status_code=422, detail=str(e))

    try:
        # Regenerate trigger UUIDs to avoid conflicts with existing triggers.
        workflow_def = regenerate_trigger_uuids(workflow_data)

        # Register every plain placeholder required by the final validated graph.
        # Required variables from the builder description are guaranteed to appear
        # in the AI-generated Global Node by template-generation validation.
        workflow_graph = WorkflowGraph(ReactFlowDTO.model_validate(workflow_def))
        template_context_variables = {
            name: ""
            for name in sorted(workflow_graph.get_required_template_variables())
        }

        trigger_paths = extract_trigger_paths(workflow_def) if workflow_def else []
        if trigger_paths:
            try:
                await db_client.assert_trigger_paths_available(
                    trigger_paths=trigger_paths,
                )
            except TriggerPathConflictError as e:
                raise HTTPException(status_code=409, detail=str(e))

        workflow_configurations = None
        if request.platform_model_configuration_id is not None:
            workflow_configurations = {
                WORKFLOW_PLATFORM_MODEL_CONFIGURATION_ID_KEY: (
                    request.platform_model_configuration_id
                )
            }
        if request.enable_video_recording:
            workflow_configurations = workflow_configurations or {}
            workflow_configurations["enable_video_recording"] = True

        workflow = await db_client.create_workflow(
            name=name,
            workflow_definition=workflow_def,
            user_id=user.id,
            organization_id=user.selected_organization_id,
            workflow_configurations=workflow_configurations,
            template_context_variables=template_context_variables,
            utilization_type=_validated_utilization(request.utilization_type),
            private_allowed_user_ids=await AgentUtilisationService.normalize_grantee_ids(
                user.selected_organization_id,
                request.private_allowed_user_ids,
                user.id,
            ),
        )

        capture_event(
            distinct_id=str(user.provider_id),
            event=PostHogEvent.WORKFLOW_CREATED,
            properties={
                "workflow_id": workflow.id,
                "workflow_name": workflow.name,
                "source": "template",
                "call_type": request.call_type,
                "use_case": request.use_case,
                "organization_id": user.selected_organization_id,
            },
        )

        if trigger_paths:
            await db_client.sync_triggers_for_workflow(
                workflow_id=workflow.id,
                organization_id=user.selected_organization_id,
                trigger_paths=trigger_paths,
            )

        return {
            "id": workflow.id,
            "name": workflow.name,
            "status": workflow.status,
            "created_at": workflow.created_at,
            "workflow_definition": mask_workflow_definition(workflow_def),
            "current_definition_id": workflow.current_definition_id,
            "template_context_variables": workflow.template_context_variables,
            "call_disposition_codes": workflow.call_disposition_codes,
            "workflow_configurations": mask_workflow_configurations(
                workflow.workflow_configurations
            ),
            "utilization_type": workflow.utilization_type,
            "created_by_user_id": workflow.user_id,
            "is_creator": AgentUtilisationService.is_creator(workflow, user),
            "private_allowed_user_ids": workflow.private_allowed_user_ids or [],
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error creating workflow from template: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"An unexpected error occurred: {str(e)}",
        )


class WorkflowSummaryResponse(BaseModel):
    id: int
    name: str


@router.get(
    "/provider-requests/{request_id}",
    response_model=ProviderRequestLookup,
)
async def get_provider_request_route(
    request_id: Annotated[str, Path(min_length=1, max_length=128)],
    user: UserModel = Depends(get_user),
) -> ProviderRequestLookup:
    """Find the call behind a provider's request ID, such as a Soniox uuid."""
    try:
        return await get_provider_request(
            request_id=request_id,
            organization_id=user.selected_organization_id,
        )
    except ProviderRequestNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/count")
async def get_workflow_count(
    user: UserModel = Depends(get_user),
) -> WorkflowCountResponse:
    """Get workflow counts for the authenticated user's organization.

    This is a lightweight endpoint for checking if the user has workflows,
    useful for redirect logic without fetching full workflow data.
    """
    # Count only agents this user may see, so the count drives the same
    # redirect/empty-state logic as the (filtered) agent list.
    accessible_ids = await AgentUtilisationService.get_accessible_agents(user)
    workflows = await db_client.get_all_workflows_for_listing(
        organization_id=user.selected_organization_id, status=None
    )
    visible = [workflow for workflow in workflows if workflow.id in accessible_ids]

    return WorkflowCountResponse(
        total=len(visible),
        active=sum(1 for workflow in visible if workflow.status == WorkflowStatus.ACTIVE.value),
        archived=sum(
            1 for workflow in visible if workflow.status == WorkflowStatus.ARCHIVED.value
        ),
    )


def _validate_status_filter(status: Optional[str]) -> List[str]:
    """Parse and validate a workflow ``status`` query filter.

    Accepts a single value or a comma-separated list. Returns the list of
    validated status values (empty when no filter was supplied). Any value
    outside the ``workflow_status`` enum raises 422 so the request fails as a
    clean client error instead of a 500 from the Postgres enum cast.
    """
    if status is None or status == "":
        return []
    allowed = {s.value for s in WorkflowStatus}
    requested = [s.strip() for s in status.split(",")]
    invalid = sorted({s for s in requested if s not in allowed})
    if invalid:
        invalid_display = ["<empty>" if s == "" else s for s in invalid]
        raise HTTPException(
            status_code=422,
            detail=(
                f"Invalid workflow status filter: {invalid_display}. "
                f"Allowed values: {sorted(allowed)}."
            ),
        )
    return requested


@router.get("/private-grant-candidates")
async def list_private_grant_candidates(
    user: UserModel = Depends(get_user),
):
    """Organization members available to a creator configuring a Private agent.

    This workflow-specific exception requires an active organization
    membership, but not a Teams-menu entitlement; it is not a Teams-management
    API.
    """
    organization_id = user.selected_organization_id
    if not organization_id:
        raise HTTPException(status_code=400, detail="No organization selected")
    membership = await db_client.get_member_team_access(organization_id, user.id)
    if not user.is_superuser and membership is None:
        raise HTTPException(
            status_code=403,
            detail="An active organization membership is required to search grant candidates.",
        )
    return await db_client.list_organization_members(organization_id)

@router.get(
    "/fetch",
    **sdk_expose(
        method="list_workflows",
        description="List all workflows in the authenticated organization.",
    ),
)
async def get_workflows(
    user: UserModel = Depends(get_user),
    status: Optional[str] = Query(
        None,
        description="Filter by status - can be single value (active/archived) or comma-separated (active,archived)",
    ),
) -> List[WorkflowListResponse]:
    """Get all workflows for the authenticated user's organization.

    Returns a lightweight response with only essential fields for listing.
    Use GET /workflow/fetch/{workflow_id} to get full workflow details.
    """
    statuses = _validate_status_filter(status)
    if statuses:
        # Fetch workflows for each requested status and combine the results.
        all_workflows = []
        for status_value in statuses:
            all_workflows.extend(
                await db_client.get_all_workflows_for_listing(
                    organization_id=user.selected_organization_id,
                    status=status_value,
                )
            )
        workflows = all_workflows
    else:
        # No status filter
        workflows = await db_client.get_all_workflows_for_listing(
            organization_id=user.selected_organization_id, status=None
        )

    # Utilisation policy: drop agents this user may not see or utilise, so
    # restricted agents never reach the client through the list/search API.
    accessible_ids = await AgentUtilisationService.get_accessible_agents(user)
    workflows = [workflow for workflow in workflows if workflow.id in accessible_ids]

    # Get run counts for all workflows in a single query
    workflow_ids = [workflow.id for workflow in workflows]
    run_counts = await db_client.get_workflow_run_counts(workflow_ids)

    return [
        WorkflowListResponse(
            id=workflow.id,
            name=workflow.name,
            status=workflow.status,
            created_at=workflow.created_at,
            total_runs=run_counts.get(workflow.id, 0),
            folder_id=workflow.folder_id,
            workflow_uuid=workflow.workflow_uuid,
            platform_model_configuration_id=(
                workflow.workflow_configurations.get("platform_model_configuration_id")
                if getattr(workflow, "workflow_configurations", None)
                else None
            ),
            utilization_type=workflow.utilization_type,
            created_by_user_id=workflow.user_id,
            is_creator=AgentUtilisationService.is_creator(workflow, user),
            private_allowed_user_ids=workflow.private_allowed_user_ids or [],
        )
        for workflow in workflows
    ]


@router.get(
    "/fetch/{workflow_id}",
    **sdk_expose(
        method="get_workflow",
        description="Get a single workflow by ID (returns draft if one exists, else published).",
    ),
)
async def get_workflow(
    workflow_id: int,
    user: UserModel = Depends(get_user),
) -> WorkflowResponse:
    """Get a single workflow by ID.

    If a draft version exists, returns the draft content for editing.
    Otherwise returns the published version's content.
    """
    workflow = await _require_agent_access(workflow_id, user)

    # Check for draft — editor should show draft content if it exists
    draft = await db_client.get_draft_version(workflow_id)

    if draft:
        workflow_def = draft.workflow_json
        workflow_configs = draft.workflow_configurations
        template_vars = draft.template_context_variables
    else:
        published = workflow.released_definition
        workflow_def = published.workflow_json
        workflow_configs = published.workflow_configurations
        template_vars = published.template_context_variables

    active_def = draft or workflow.released_definition
    return {
        "id": workflow.id,
        "name": workflow.name,
        "status": workflow.status,
        "created_at": workflow.created_at,
        "workflow_definition": mask_workflow_definition(workflow_def),
        "current_definition_id": workflow.current_definition_id,
        "template_context_variables": template_vars,
        "call_disposition_codes": workflow.call_disposition_codes,
        "workflow_configurations": mask_workflow_configurations(workflow_configs),
        "utilization_type": workflow.utilization_type,
        "created_by_user_id": workflow.user_id,
        "private_allowed_user_ids": workflow.private_allowed_user_ids or [],
        "is_creator": AgentUtilisationService.is_creator(workflow, user),
        "version_number": active_def.version_number if active_def else None,
        "version_status": active_def.status if active_def else None,
        "workflow_uuid": workflow.workflow_uuid,
    }


@router.get("/{workflow_id}/grantable-users")
async def get_private_grantable_users(
    workflow_id: int,
    user: UserModel = Depends(get_user),
):
    """Organization members a workflow creator may explicitly grant Private access to."""
    workflow = await _require_agent_access(workflow_id, user)
    if not AgentUtilisationService.is_creator(workflow, user):
        raise HTTPException(
            status_code=403,
            detail="Only the agent creator can view and manage its explicit grants.",
        )
    if not workflow.organization_id:
        return []
    return await db_client.list_organization_members(workflow.organization_id)

@router.get("/{workflow_id}/versions")
async def get_workflow_versions(
    workflow_id: int,
    limit: int | None = Query(None, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user: UserModel = Depends(get_user),
) -> list[WorkflowVersionResponse]:
    """List versions for a workflow, newest first.

    Pass `limit`/`offset` to page through long histories. With no `limit`,
    returns every version (legacy behavior).
    """
    await _require_agent_access(workflow_id, user)

    versions = await db_client.get_workflow_versions(
        workflow_id, limit=limit, offset=offset
    )
    return [
        WorkflowVersionResponse(
            id=v.id,
            version_number=v.version_number,
            status=v.status,
            created_at=v.created_at,
            published_at=v.published_at,
            workflow_json=mask_workflow_definition(v.workflow_json),
            workflow_configurations=mask_workflow_configurations(
                v.workflow_configurations
            ),
            template_context_variables=v.template_context_variables,
        )
        for v in versions
        if v.version_number is not None
    ]


@router.post("/{workflow_id}/publish")
async def publish_workflow(
    workflow_id: int,
    user: UserModel = Depends(get_user),
):
    """Publish the current draft version of a workflow.

    Drafts are allowed to be incomplete (so the editor can save mid-edit),
    but a published version is what runtime executes — so this is the gate
    where the full DTO + graph + trigger-conflict checks must pass.
    """
    await _require_agent_access(workflow_id, user)

    draft = await db_client.get_draft_version(workflow_id)
    if draft is None:
        raise HTTPException(status_code=400, detail="No draft to publish")

    errors = await _validate_workflow_definition(
        draft.workflow_json, exclude_workflow_id=workflow_id
    )
    if errors:
        raise _validation_errors_http_exception(errors)

    try:
        published = await db_client.publish_workflow_draft(workflow_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    capture_event(
        distinct_id=str(user.provider_id),
        event=PostHogEvent.WORKFLOW_PUBLISHED,
        properties={
            "workflow_id": workflow_id,
            "version_number": published.version_number,
            "organization_id": user.selected_organization_id,
        },
    )

    return {
        "id": published.id,
        "version_number": published.version_number,
        "status": published.status,
        "published_at": published.published_at,
    }


@router.post("/{workflow_id}/create-draft")
async def create_workflow_draft(
    workflow_id: int,
    user: UserModel = Depends(get_user),
) -> WorkflowVersionResponse:
    """Create a draft version from the current published version.

    If a draft already exists, returns the existing draft.
    """
    await _require_agent_access(workflow_id, user)

    draft = await db_client.save_workflow_draft(workflow_id)
    return WorkflowVersionResponse(
        id=draft.id,
        version_number=draft.version_number,
        status=draft.status,
        created_at=draft.created_at,
        published_at=draft.published_at,
        workflow_json=mask_workflow_definition(draft.workflow_json),
        workflow_configurations=mask_workflow_configurations(
            draft.workflow_configurations
        ),
        template_context_variables=draft.template_context_variables,
    )


@router.get("/summary")
async def get_workflows_summary(
    user: UserModel = Depends(get_user),
    status: Optional[str] = Query(
        None,
        description="Filter by status (e.g. 'active' or 'archived'). Omit to return all.",
    ),
) -> List[WorkflowSummaryResponse]:
    """Get minimal workflow information (id and name only) for all workflows"""
    statuses = _validate_status_filter(status)
    if statuses:
        workflows = []
        for status_value in statuses:
            workflows.extend(
                await db_client.get_all_workflows(
                    organization_id=user.selected_organization_id,
                    status=status_value,
                )
            )
    else:
        workflows = await db_client.get_all_workflows(
            organization_id=user.selected_organization_id, status=None
        )
    # Same utilisation filter as the agent list: no restricted agent names.
    accessible_ids = await AgentUtilisationService.get_accessible_agents(user)
    return [
        WorkflowSummaryResponse(id=workflow.id, name=workflow.name)
        for workflow in workflows
        if workflow.id in accessible_ids
    ]


@router.put("/{workflow_id}/status")
async def update_workflow_status(
    workflow_id: int,
    request: UpdateWorkflowStatusRequest,
    user: UserModel = Depends(get_user),
) -> WorkflowResponse:
    """
    Update the status of a workflow (e.g., archive/unarchive).

    Args:
        workflow_id: The ID of the workflow to update
        request: The status update request

    Returns:
        The updated workflow
    """
    await _require_agent_access(workflow_id, user)
    try:
        workflow = await db_client.update_workflow_status(
            workflow_id=workflow_id,
            status=request.status,
            organization_id=user.selected_organization_id,
        )
        run_count = await db_client.get_workflow_run_count(workflow.id)
        return {
            "id": workflow.id,
            "name": workflow.name,
            "status": workflow.status,
            "created_at": workflow.created_at,
            "workflow_definition": mask_workflow_definition(
                workflow.released_definition.workflow_json
            ),
            "current_definition_id": workflow.current_definition_id,
            "template_context_variables": workflow.template_context_variables,
            "call_disposition_codes": workflow.call_disposition_codes,
            "workflow_configurations": mask_workflow_configurations(
                workflow.workflow_configurations
            ),
            "total_runs": run_count,
            "utilization_type": workflow.utilization_type,
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{workflow_id}/folder")
async def move_workflow_to_folder(
    workflow_id: int,
    request: MoveWorkflowToFolderRequest,
    user: UserModel = Depends(get_user),
) -> WorkflowListResponse:
    """Move a workflow into a folder, or to "Uncategorized" (folder_id=null).

    Validates that the target folder belongs to the caller's organization —
    the FK alone proves the folder exists, not that the caller may use it.
    """
    await _require_agent_access(workflow_id, user)

    # Validate target folder ownership (tenant isolation) unless un-filing.
    if request.folder_id is not None:
        folder = await db_client.get_folder(
            request.folder_id, organization_id=user.selected_organization_id
        )
        if folder is None:
            raise HTTPException(
                status_code=404,
                detail=f"Folder with id {request.folder_id} not found",
            )

    try:
        workflow = await db_client.move_workflow_to_folder(
            workflow_id=workflow_id,
            folder_id=request.folder_id,
            organization_id=user.selected_organization_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    run_count = await db_client.get_workflow_run_count(workflow.id)
    return WorkflowListResponse(
        id=workflow.id,
        name=workflow.name,
        status=workflow.status,
        created_at=workflow.created_at,
        total_runs=run_count,
        folder_id=workflow.folder_id,
        utilization_type=workflow.utilization_type,
        created_by_user_id=workflow.user_id,
        is_creator=AgentUtilisationService.is_creator(workflow, user),
        private_allowed_user_ids=workflow.private_allowed_user_ids or [],
    )


@router.put(
    "/{workflow_id}",
    **sdk_expose(
        method="update_workflow",
        description="Update a workflow's name and/or definition. Saves as a new draft.",
    ),
)
async def update_workflow(
    workflow_id: int,
    request: UpdateWorkflowRequest,
    user: UserModel = Depends(get_user),
) -> WorkflowResponse:
    """
    Update an existing workflow.

    Args:
        workflow_id: The ID of the workflow to update
        request: The update request containing the new name and workflow definition

    Returns:
        The updated workflow

    Raises:
        HTTPException: If the workflow is not found or if there's a database error
    """
    try:
        existing_agent = await _require_agent_access(workflow_id, user)
        # Changing the utilisation policy is the creator's call: widening (or
        # narrowing) who can reach an agent is not something a teammate in a
        # shared branch may decide.
        requested_utilization = (
            _validated_utilization(request.utilization_type)
            if request.utilization_type is not None
            else None
        )
        # Explicit grants are membership-scoped: anything that is not a current
        # member of this organization is dropped, never stored.
        requested_grantees = (
            await AgentUtilisationService.normalize_grantee_ids(
                user.selected_organization_id,
                request.private_allowed_user_ids,
                existing_agent.user_id,
            )
            if request.private_allowed_user_ids is not None
            else None
        )
        if not AgentUtilisationService.is_creator(existing_agent, user):
            if (
                requested_utilization is not None
                and requested_utilization != existing_agent.utilization_type
            ):
                raise HTTPException(
                    status_code=403,
                    detail="Only the agent creator can change its utilisation.",
                )
            if requested_grantees is not None and requested_grantees != (
                existing_agent.private_allowed_user_ids or []
            ):
                raise HTTPException(
                    status_code=403,
                    detail="Only the agent creator can change who has explicit access.",
                )
        # Strip UI runtime-only fields (invalid, validationMessage, etc.) from
        # node.data / edge.data before anything touches the DB — the UI sends
        # nodes wholesale from the React Flow store, which carries those.
        workflow_definition = sanitize_workflow_definition(request.workflow_definition)
        # Mint trigger_path for any trigger node that ships without one. The
        # response echoes workflow_definition so the client picks up the new
        # UUID without a refetch.
        workflow_definition = ensure_trigger_paths(workflow_definition)
        trigger_path_issues = validate_trigger_paths(workflow_definition)
        if trigger_path_issues:
            raise _trigger_path_validation_http_exception(trigger_path_issues)
        if workflow_definition:
            existing_workflow = await db_client.get_workflow(
                workflow_id, organization_id=user.selected_organization_id
            )
            if existing_workflow:
                # Merge against what the user was editing (draft or published)
                existing_draft = await db_client.get_draft_version(workflow_id)
                existing_def = (
                    existing_draft.workflow_json
                    if existing_draft
                    else existing_workflow.released_definition.workflow_json
                )
                workflow_definition = merge_workflow_api_keys(
                    workflow_definition,
                    existing_def,
                )

        # Validate model overrides. v2 uses a complete workflow-level model
        # configuration; legacy v1 uses partial service overlays.
        workflow_configurations = request.workflow_configurations
        if workflow_configurations and workflow_configurations.get(
            WORKFLOW_MODEL_CONFIGURATION_V2_OVERRIDE_KEY
        ):
            existing_workflow = await db_client.get_workflow(
                workflow_id, organization_id=user.selected_organization_id
            )
            if existing_workflow is None:
                raise HTTPException(
                    status_code=404, detail=f"Workflow with id {workflow_id} not found"
                )
            existing_draft = await db_client.get_draft_version(workflow_id)
            existing_configs = (
                existing_draft.workflow_configurations
                if existing_draft
                else existing_workflow.released_definition.workflow_configurations
            )
            existing_v2_override = (existing_configs or {}).get(
                WORKFLOW_MODEL_CONFIGURATION_V2_OVERRIDE_KEY
            )
            try:
                incoming_v2_override = (
                    OrganizationAIModelConfigurationV2.model_validate(
                        workflow_configurations[
                            WORKFLOW_MODEL_CONFIGURATION_V2_OVERRIDE_KEY
                        ]
                    )
                )
                existing_v2_override_config = (
                    OrganizationAIModelConfigurationV2.model_validate(
                        existing_v2_override
                    )
                    if existing_v2_override
                    else None
                )
                v2_override = merge_ai_model_configuration_v2_secrets(
                    incoming_v2_override,
                    existing_v2_override_config,
                )
                if existing_v2_override_config is None:
                    resolved_config = await get_resolved_ai_model_configuration(
                        user_id=user.id,
                        organization_id=user.selected_organization_id,
                    )
                    v2_override = merge_ai_model_configuration_v2_secrets(
                        v2_override,
                        resolved_config.organization_configuration,
                    )
                check_for_masked_keys_in_ai_model_configuration_v2(v2_override)
                effective = compile_ai_model_configuration_v2(v2_override)
                await UserConfigurationValidator().validate(
                    effective,
                    organization_id=user.selected_organization_id,
                    created_by=user.provider_id,
                )
            except (ValidationError, ValueError) as e:
                raise HTTPException(status_code=422, detail=str(e))
            workflow_configurations = {
                **workflow_configurations,
                WORKFLOW_MODEL_CONFIGURATION_V2_OVERRIDE_KEY: v2_override.model_dump(
                    mode="json",
                    exclude_none=True,
                ),
            }
            workflow_configurations.pop("model_overrides", None)
        elif workflow_configurations and workflow_configurations.get("model_overrides"):
            existing_workflow = await db_client.get_workflow(
                workflow_id, organization_id=user.selected_organization_id
            )
            if existing_workflow is None:
                raise HTTPException(
                    status_code=404, detail=f"Workflow with id {workflow_id} not found"
                )
            existing_draft = await db_client.get_draft_version(workflow_id)
            existing_configs = (
                existing_draft.workflow_configurations
                if existing_draft
                else existing_workflow.released_definition.workflow_configurations
            )
            workflow_configurations = merge_workflow_configuration_secrets(
                workflow_configurations,
                existing_configs,
            )
            resolved_config = await get_resolved_ai_model_configuration(
                user_id=user.id,
                organization_id=user.selected_organization_id,
            )
            effective_config = resolved_config.effective
            try:
                enriched_overrides = enrich_overrides_with_api_keys(
                    workflow_configurations["model_overrides"],
                    effective_config,
                )
                effective = resolve_effective_config(
                    effective_config, enriched_overrides
                )
                if resolved_config.source == "organization_v2":
                    v2_override = convert_legacy_ai_model_configuration_to_v2(effective)
                    await UserConfigurationValidator().validate(
                        compile_ai_model_configuration_v2(v2_override),
                        organization_id=user.selected_organization_id,
                        created_by=user.provider_id,
                    )
                else:
                    await UserConfigurationValidator().validate(
                        effective,
                        organization_id=user.selected_organization_id,
                        created_by=user.provider_id,
                    )
            except ValueError as e:
                raise HTTPException(status_code=422, detail=str(e))
            if resolved_config.source == "organization_v2":
                workflow_configurations = {
                    **workflow_configurations,
                    WORKFLOW_MODEL_CONFIGURATION_V2_OVERRIDE_KEY: v2_override.model_dump(
                        mode="json",
                        exclude_none=True,
                    ),
                }
                workflow_configurations.pop("model_overrides", None)
            else:
                workflow_configurations = {
                    **workflow_configurations,
                    "model_overrides": enriched_overrides,
                }

        # Reject upfront if any new trigger path collides with another
        # workflow's trigger — keeps the workflow record from
        # being updated when the trigger sync would fail.
        if workflow_definition:
            new_trigger_paths = extract_trigger_paths(workflow_definition)
            if new_trigger_paths:
                try:
                    await db_client.assert_trigger_paths_available(
                        trigger_paths=new_trigger_paths,
                        exclude_workflow_id=workflow_id,
                    )
                except TriggerPathConflictError as e:
                    raise _trigger_conflict_http_exception(
                        workflow_definition, e.trigger_paths
                    )

        workflow = await db_client.update_workflow(
            workflow_id=workflow_id,
            name=request.name,
            workflow_definition=workflow_definition,
            template_context_variables=request.template_context_variables,
            workflow_configurations=workflow_configurations,
            organization_id=user.selected_organization_id,
            utilization_type=requested_utilization,
            private_allowed_user_ids=requested_grantees,
        )

        # Sync agent triggers if workflow definition was updated
        if workflow_definition:
            trigger_paths = extract_trigger_paths(workflow_definition)
            await db_client.sync_triggers_for_workflow(
                workflow_id=workflow.id,
                organization_id=user.selected_organization_id,
                trigger_paths=trigger_paths,
            )

        # Return draft content if one exists (save creates a draft)
        draft = await db_client.get_draft_version(workflow_id)
        if draft:
            workflow_def = draft.workflow_json
            workflow_configs = draft.workflow_configurations
            template_vars = draft.template_context_variables
        else:
            published = workflow.released_definition
            workflow_def = published.workflow_json
            workflow_configs = published.workflow_configurations
            template_vars = published.template_context_variables

        # Include version info from the active definition (draft or published)
        active_def = draft or workflow.released_definition
        return {
            "id": workflow.id,
            "name": workflow.name,
            "status": workflow.status,
            "created_at": workflow.created_at,
            "workflow_definition": mask_workflow_definition(workflow_def),
            "current_definition_id": workflow.current_definition_id,
            "template_context_variables": template_vars,
            "call_disposition_codes": workflow.call_disposition_codes,
            "utilization_type": workflow.utilization_type,
            "private_allowed_user_ids": workflow.private_allowed_user_ids or [],
            "created_by_user_id": workflow.user_id,
            "is_creator": AgentUtilisationService.is_creator(workflow, user),
            "workflow_configurations": mask_workflow_configurations(workflow_configs),
            "version_number": active_def.version_number if active_def else None,
            "version_status": active_def.status if active_def else None,
        }
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{workflow_id}/duplicate")
async def duplicate_workflow_endpoint(
    workflow_id: int,
    user: UserModel = Depends(get_user),
) -> WorkflowResponse:
    """Duplicate a workflow including its definition, configuration, recordings, and triggers."""
    # Only agents the caller may view can be cloned.
    await _require_agent_access(workflow_id, user)
    try:
        workflow = await duplicate_workflow(
            workflow_id=workflow_id,
            organization_id=user.selected_organization_id,
            user_id=user.id,
        )

        capture_event(
            distinct_id=str(user.provider_id),
            event=PostHogEvent.WORKFLOW_DUPLICATED,
            properties={
                "workflow_id": workflow.id,
                "workflow_name": workflow.name,
                "source_workflow_id": workflow_id,
                "organization_id": user.selected_organization_id,
            },
        )

        return {
            "id": workflow.id,
            "name": workflow.name,
            "status": workflow.status,
            "created_at": workflow.created_at,
            "workflow_definition": mask_workflow_definition(
                workflow.released_definition.workflow_json
            ),
            "current_definition_id": workflow.current_definition_id,
            "template_context_variables": workflow.template_context_variables,
            "call_disposition_codes": workflow.call_disposition_codes,
            "workflow_configurations": mask_workflow_configurations(
                workflow.workflow_configurations
            ),
            "utilization_type": workflow.utilization_type,
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error duplicating workflow {workflow_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{workflow_id}/runs")
async def create_workflow_run(
    workflow_id: int,
    request: CreateWorkflowRunRequest,
    user: UserModel = Depends(get_user),
) -> CreateWorkflowRunResponse:
    """
    Create a new workflow run when the user decides to execute the workflow via chat or voice

    Args:
        workflow_id: The ID of the workflow to run
        request: The create workflow run request
        user: The user to create the workflow run for
    """
    # Executing an agent requires the utilisation permission, not just a
    # visible one — enforced on every run request, not only in the UI.
    await _require_agent_access(workflow_id, user, utilise=True)
    # Prod will pause — block next Test Agent when wallet $0 and Auto-pause (but Admin bypass)
    await _require_sufficient_credits(user.selected_organization_id, user)
    run = await db_client.create_workflow_run(
        request.name,
        workflow_id,
        request.mode,
        user.id,
        use_draft=True,
        organization_id=user.selected_organization_id,
    )
    return {
        "id": run.id,
        "workflow_id": run.workflow_id,
        "name": run.name,
        # New runs have no stored title yet (title job runs post-call) and
        # `run` is detached here, so `run.workflow` cannot lazy-load.
        # Fall back to the run name; list/detail resolve workflow+name.
        "conversation_title": resolve_display_title(
            getattr(run, "conversation_title", None),
            None,
            run.name,
        ),
        "mode": run.mode,
        "created_at": run.created_at,
        "definition_id": run.definition_id,
        "initial_context": run.initial_context,
        "gathered_context": run.gathered_context,
    }


@router.get("/{workflow_id}/runs/{run_id}")
async def get_workflow_run(
    workflow_id: int, run_id: int, user: UserModel = Depends(get_user)
) -> WorkflowRunResponseSchema:
    await _require_agent_access(workflow_id, user)
    run = await db_client.get_workflow_run(
        run_id, organization_id=user.selected_organization_id
    )
    if not run or run.workflow_id != workflow_id:
        raise HTTPException(status_code=404, detail="Workflow run not found")

    public_access_token = run.public_access_token
    user_recording_url = get_recording_storage_key(run.extra, "user")
    bot_recording_url = get_recording_storage_key(run.extra, "bot")
    video_recording_url = get_recording_storage_key(run.extra, "video")
    has_user_recording = has_recording_track(run.extra, "user")
    has_bot_recording = has_recording_track(run.extra, "bot")
    has_video_recording = has_recording_track(run.extra, "video")
    if (
        run.transcript_url
        or run.recording_url
        or has_user_recording
        or has_bot_recording
        or has_video_recording
    ) and not public_access_token:
        public_access_token = await db_client.ensure_public_access_token(run.id)

    configs = (run.workflow.workflow_configurations or {}) if run.workflow else {}
    has_report_template = bool(configs.get("report_template"))
    if not has_report_template and run.workflow_id:
        try:
            draft = await db_client.get_draft_version(run.workflow_id)
            if draft:
                has_report_template = bool(
                    (draft.workflow_configurations or {}).get("report_template")
                )
        except Exception:
            pass

    initial_context = run.initial_context or {}
    rt_cfg = initial_context.get("runtime_configuration")
    if isinstance(rt_cfg, dict):
        wf_configs = (
            (run.definition.workflow_configurations or {})
            if run.definition
            else configs
        )
        if not rt_cfg.get("preset_name"):
            try:
                preset_name = await resolve_preset_name_for_workflow(wf_configs)
                if preset_name:
                    rt_cfg["preset_name"] = preset_name
            except Exception:
                pass
        if not rt_cfg.get("language"):
            try:
                ai_cfg = wf_configs.get("ai_model_configuration", {})
                lang = (
                    (ai_cfg.get("stt") or {}).get("language")
                    or (ai_cfg.get("tts") or {}).get("language")
                    or (ai_cfg.get("realtime") or {}).get("language")
                )
                if not lang:
                    from api.db.platform_client import platform_client
                    from api.services.configuration.ai_model_configuration import (
                        WORKFLOW_PLATFORM_MODEL_CONFIGURATION_ID_KEY,
                    )

                    preset_id = wf_configs.get(
                        WORKFLOW_PLATFORM_MODEL_CONFIGURATION_ID_KEY
                    )
                    preset = None
                    if preset_id is not None:
                        preset = await platform_client.get_model_configuration(
                            int(preset_id)
                        )
                    if preset is None:
                        preset = await platform_client.get_default_model_configuration()
                    if preset and preset.config:
                        pcfg = preset.config if isinstance(preset.config, dict) else {}
                        byok = pcfg.get("byok", {})
                        pipeline = (
                            byok.get("pipeline", {}) if isinstance(byok, dict) else {}
                        )
                        convozent_cfg = pcfg.get("convozent", {})
                        lang = (
                            (pipeline.get("tts") or {}).get("language")
                            or (pipeline.get("stt") or {}).get("language")
                            or (
                                convozent_cfg.get("language")
                                if isinstance(convozent_cfg, dict)
                                else None
                            )
                        )
                if lang and lang != "unknown":
                    rt_cfg["language"] = lang
            except Exception:
                pass

    return {
        "id": run.id,
        "workflow_id": run.workflow_id,
        "name": run.name,
        "conversation_title": resolve_display_title(
            getattr(run, "conversation_title", None),
            run.workflow.name if run.workflow else None,
            run.name,
        ),
        "mode": run.mode,
        "is_completed": run.is_completed,
        "transcript_url": run.transcript_url,
        "recording_url": run.recording_url,
        "user_recording_url": user_recording_url,
        "bot_recording_url": bot_recording_url,
        "video_recording_url": video_recording_url,
        "transcript_public_url": artifact_url(public_access_token, "transcript"),
        "recording_public_url": artifact_url(public_access_token, "recording"),
        "report_public_url": (
            artifact_url(public_access_token, "report") if run.report_s3_key else None
        ),
        "user_recording_public_url": (
            artifact_url(public_access_token, "user_recording")
            if has_user_recording
            else None
        ),
        "bot_recording_public_url": (
            artifact_url(public_access_token, "bot_recording")
            if has_bot_recording
            else None
        ),
        "video_recording_public_url": (
            artifact_url(public_access_token, "video_recording")
            if has_video_recording
            else None
        ),
        "public_access_token": public_access_token,
        "cost_info": format_public_cost_info(run.cost_info, run.usage_info),
        "usage_info": format_public_usage_info(run.usage_info),
        "created_at": run.created_at,
        "definition_id": run.definition_id,
        "initial_context": initial_context,
        "gathered_context": run.gathered_context,
        "call_type": run.call_type,
        "logs": run.logs,
        "annotations": run.annotations,
        "report_s3_key": run.report_s3_key,
        "report_generation_status": run.report_generation_status,
        "has_report_template": has_report_template,
        "workflow_name": run.workflow.name if run.workflow else None,
        "completeness": (run.annotations or {}).get("completeness"),
    }


@router.get("/{workflow_id}/analytics", response_model=AgentAnalyticsResponse)
async def get_workflow_analytics(
    workflow_id: int,
    days: int = Query(
        default=30, ge=0, le=MAX_RANGE_DAYS, description="0 means all time"
    ),
    tz_offset_minutes: int = Query(default=0, ge=-840, le=840),
    campaign_id: int | None = Query(
        default=None, description="Only this campaign's runs of the agent"
    ),
    user: UserModel = Depends(get_user),
) -> AgentAnalyticsResponse:
    """Token, turn and outcome rollup for one agent over the last N days."""
    await _require_agent_access(workflow_id, user)
    if campaign_id is not None:
        # The campaign must be this org's and run this agent.
        campaign = await db_client.get_campaign(
            campaign_id, user.selected_organization_id
        )
        if not campaign or campaign.workflow_id != workflow_id:
            raise HTTPException(status_code=404, detail="Campaign not found")
    return await get_agent_analytics(
        workflow_id=workflow_id,
        organization_id=user.selected_organization_id,
        days=days,
        tz_offset_minutes=tz_offset_minutes,
        campaign_id=campaign_id,
    )


@router.get("/{workflow_id}/runs/{run_id}/usage")
async def get_workflow_run_usage(
    workflow_id: int,
    run_id: int,
    user: UserModel = Depends(get_user),
) -> dict:
    """Return canonical persisted usage for one organization-scoped run."""
    await _require_agent_access(workflow_id, user)
    run = await db_client.get_workflow_run(
        run_id, organization_id=user.selected_organization_id
    )
    if not run or (workflow_id and run.workflow_id != workflow_id):
        raise HTTPException(status_code=404, detail="Workflow run not found")
    provider_rows = await db_client.list_provider_usage_events(workflow_run_id=run_id)
    provider_usage = to_provider_usage_summary(
        rows=provider_rows,
        context=to_run_usage_context(initial_context=run.initial_context),
    )
    return {
        "run_id": run_id,
        **await db_client.reconcile_run(run_id),
        "provider_usage": provider_usage.model_dump(),
    }


@router.post("/{workflow_id}/runs/{run_id}/completeness/evaluate")
async def evaluate_run_completeness(
    workflow_id: int, run_id: int, user: UserModel = Depends(get_user)
):
    """(Re)evaluate conversation completeness for a run and persist it.

    Synchronous on-demand path used by the detail page Retry button and to
    backfill runs that finished before completeness existed. Org-scoped.
    """
    from api.services.completeness import evaluate_completeness

    await _require_agent_access(workflow_id, user)
    run = await db_client.get_workflow_run(
        run_id, organization_id=user.selected_organization_id
    )
    if not run or run.workflow_id != workflow_id:
        raise HTTPException(status_code=404, detail="Workflow run not found")

    definition = run.definition.workflow_json if run.definition else None
    configs = {}
    if run.definition:
        configs = run.definition.workflow_configurations or {}
    elif run.workflow:
        configs = run.workflow.workflow_configurations or {}

    result = await evaluate_completeness(run, definition, configs)
    await db_client.update_workflow_run(run_id, annotations={"completeness": result})

    # Every (re)evaluation is its own usage event: a fixed attempt=1 made
    # re-evaluations collide with the first event and record nothing.
    operation_id = f"completeness:{run_id}"
    token_usage = result.get("token_usage") if isinstance(result, dict) else None
    model = result.get("model") if isinstance(result, dict) else None
    attempt = await db_client.next_attempt(run_id, operation_id)
    await db_client.record_usage(
        workflow_run_id=run_id,
        case="conversation_completeness",
        service_type="llm",
        operation_id=operation_id,
        attempt=attempt,
        model=model,
        usage=token_usage,
        status="recorded" if result.get("status") == "ready" else "unavailable",
    )

    # Mirror into usage_info so the Token Usage Breakdown lists each
    # evaluation: Completeness, Completeness_Reeval, Completeness_Reeval2, ...
    if token_usage and model and token_usage.get("total_tokens", 0) > 0:
        try:
            fresh_run = await db_client.get_workflow_run_by_id(run_id)
            if fresh_run:
                cur_usage = dict(fresh_run.usage_info or {})
                cur_llm = dict(cur_usage.get("llm", {}))
                previous = sum(
                    1 for k in cur_llm if k.lower().startswith("completeness")
                )
                if previous == 0:
                    suffix = ""
                else:
                    suffix = f"_Reeval{'' if previous == 1 else previous}"
                cur_llm[f"Completeness{suffix}|||{model}"] = token_usage
                cur_usage["llm"] = cur_llm
                await db_client.update_workflow_run(run_id=run_id, usage_info=cur_usage)
        except Exception as err:
            logger.warning(
                f"Failed to mirror completeness usage_info for run {run_id}: {err}"
            )
    return result


@router.post("/{workflow_id}/runs/{run_id}/report/regenerate", status_code=202)
async def regenerate_workflow_run_report(
    workflow_id: int, run_id: int, user: UserModel = Depends(get_user)
):
    """Queue a fresh report generation for a completed workflow run."""
    run = await db_client.get_workflow_run(
        run_id, organization_id=user.selected_organization_id
    )
    if not run or (workflow_id != 0 and run.workflow_id != workflow_id):
        raise HTTPException(status_code=404, detail="Workflow run not found")
    # workflow_id == 0 is the unscoped variant used by shared report links, so
    # resolve the agent from the run itself before checking utilisation.
    await _require_agent_access(run.workflow_id, user)
    if run.report_generation_status in {"pending", "processing"}:
        # 409 only while the attempt is fresh. A run frozen at
        # 'processing' (worker died mid-job) must stay re-queueable —
        # otherwise a stuck run can never be recovered from the UI.
        last_change = getattr(run, "report_status_updated_at", None) or getattr(
            run, "created_at", None
        )
        is_stale = last_change is None or (datetime.now(UTC) - last_change) > timedelta(
            minutes=REPORT_STALE_MINUTES
        )
        if not is_stale:
            raise HTTPException(
                status_code=409,
                detail="Report generation is already in progress",
            )
        logger.warning(
            f"Regenerate requested for run {run_id} stuck at "
            f"'{run.report_generation_status}' since {last_change}; re-queueing"
        )

    configs = run.workflow.workflow_configurations or {}
    template_html = configs.get("report_template")
    if not template_html:
        try:
            draft = await db_client.get_draft_version(run.workflow_id)
            if draft:
                template_html = (draft.workflow_configurations or {}).get(
                    "report_template"
                )
        except Exception:
            pass

    if not template_html:
        raise HTTPException(
            status_code=400,
            detail="No report template configured for this workflow",
        )

    await db_client.update_workflow_run(
        run_id=run_id,
        report_generation_status="pending",
        clear_report_s3_key=True,
        clear_report_variables=True,
    )
    job = await enqueue_job(FunctionNames.GENERATE_RUN_REPORT, run_id)
    if job is None:
        await db_client.update_workflow_run(
            run_id=run_id,
            report_generation_status="failed",
        )
        raise HTTPException(
            status_code=503,
            detail="Unable to queue report generation. Please try again.",
        )

    return {"status": "queued"}


@router.get("/{workflow_id}/runs/{run_id}/report")
async def get_workflow_run_report(
    workflow_id: int, run_id: int, user: UserModel = Depends(get_user)
):
    """Return the rendered HTML report for a workflow run.

    The report is rendered on-the-fly from the workflow's report template
    and the run's extracted variables. The background task must have
    completed (report_generation_status == 'completed') before this
    endpoint is called.
    """
    await _require_agent_access(workflow_id, user)
    run = await db_client.get_workflow_run(
        run_id, organization_id=user.selected_organization_id
    )
    if not run or run.workflow_id != workflow_id:
        raise HTTPException(status_code=404, detail="Workflow run not found")

    if (
        run.state not in ("completed", "failed")
        and run.report_generation_status != "completed"
    ):
        raise HTTPException(
            status_code=404,
            detail="Report not ready yet. Status: "
            + (run.report_generation_status or "not started"),
        )

    workflow = run.workflow
    configs = workflow.workflow_configurations or {}
    template_html = configs.get("report_template")

    if not template_html and run.campaign_id:
        try:
            campaign = await db_client.get_campaign(
                run.campaign_id, user.selected_organization_id
            )
            if campaign and campaign.orchestrator_metadata:
                template_html = campaign.orchestrator_metadata.get("report_template")
        except Exception:
            pass

    if not template_html:
        try:
            draft = await db_client.get_draft_version(workflow.id)
            if draft:
                template_html = (draft.workflow_configurations or {}).get(
                    "report_template"
                )
        except Exception:
            pass

    if not template_html:
        raise HTTPException(status_code=404, detail="No report template configured")

    raw_vars = configs.get("report_variables", [])
    saved_defs: list = []
    if raw_vars and isinstance(raw_vars, list):
        saved_defs = [v for v in raw_vars if isinstance(v, dict) and v.get("name")]

    # Same merge as the background worker so preview never uses stale defs.
    report_variables_defs = resolve_definitions(template_html, saved_defs) or None

    try:
        context = build_report_context(run, report_variables_defs=report_variables_defs)
        rendered = render_template_html(template_html, context)
        report_vars = context.get("report_variables", {})
        if isinstance(report_vars, dict):

            def _is_empty(val) -> bool:
                if isinstance(val, list):
                    return len(val) == 0
                return str(val).strip() == ""

            empty_vars = sorted(k for k, v in report_vars.items() if _is_empty(v))
        else:
            empty_vars = []
        agent_name = (
            (run.initial_context or {}).get("agent_name")
            or (run.initial_context or {}).get("name")
            or (run.gathered_context or {}).get("agent_name")
            or workflow.name
        )
        gen_status = run.report_generation_status
        return JSONResponse(
            content={
                "rendered_html": rendered,
                "report_template": template_html,
                "report_variables": report_vars,
                "report_diagnostics": {
                    "total_vars": len(report_vars)
                    if isinstance(report_vars, dict)
                    else 0,
                    "empty_vars": empty_vars,
                    "empty_count": len(empty_vars),
                    "generation_status": gen_status,
                },
                "report_generation_status": gen_status,
                "is_ready": gen_status == "completed",
                "workflow_name": workflow.name,
                "agent_name": agent_name,
                "workflow_id": workflow.id,
                "run_id": run.id,
            }
        )

    except Exception as e:
        logger.error(f"Failed to render report for run {run_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to render report: {e}")


class WorkflowRunsResponse(BaseModel):
    runs: List[WorkflowRunResponseSchema]
    total_count: int
    page: int
    limit: int
    total_pages: int
    applied_filters: Optional[List[dict]] = None


@router.get("/{workflow_id}/runs")
async def get_workflow_runs(
    workflow_id: int,
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
) -> WorkflowRunsResponse:
    """
    Get workflow runs with optional filtering and sorting.

    Filters should be provided as a JSON-encoded array of filter criteria.
    Example: [{"attribute": "dateRange", "value": {"from": "2024-01-01", "to": "2024-01-31"}}]
    """
    await _require_agent_access(workflow_id, user)

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

    runs, total_count = await db_client.get_workflow_runs_by_workflow_id(
        workflow_id,
        organization_id=user.selected_organization_id,
        limit=limit,
        offset=offset,
        filters=filter_criteria if filter_criteria else None,
        sort_by=sort_by,
        sort_order=sort_order,
    )

    total_pages = (total_count + limit - 1) // limit

    return WorkflowRunsResponse(
        runs=runs,
        total_count=total_count,
        page=page,
        limit=limit,
        total_pages=total_pages,
        applied_filters=filter_criteria if filter_criteria else None,
    )


@router.get("/{workflow_id}/report")
async def download_workflow_report(
    workflow_id: int,
    user: UserModel = Depends(get_user),
    start_date: Optional[datetime] = Query(
        None, description="Filter runs created on or after this datetime (ISO 8601)"
    ),
    end_date: Optional[datetime] = Query(
        None, description="Filter runs created on or before this datetime (ISO 8601)"
    ),
) -> StreamingResponse:
    """Download a CSV report of completed runs for a workflow."""
    await _require_agent_access(workflow_id, user)

    output, filename = await generate_workflow_report_csv(
        workflow_id, start_date=start_date, end_date=end_date
    )

    return StreamingResponse(
        output,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{workflow_id}/report/pdf")
async def download_workflow_report_pdf(
    workflow_id: int,
    user: UserModel = Depends(get_user),
    start_date: Optional[datetime] = Query(
        None, description="Filter runs created on or after this datetime (ISO 8601)"
    ),
    end_date: Optional[datetime] = Query(
        None, description="Filter runs created on or before this datetime (ISO 8601)"
    ),
) -> StreamingResponse:
    """Download a ZIP of PDF reports generated from the workflow's report template."""
    workflow = await _require_agent_access(workflow_id, user)

    configs = workflow.workflow_configurations or {}
    template_html = configs.get("report_template")
    if not template_html and workflow.current_definition:
        draft_configs = workflow.current_definition.workflow_configurations or {}
        template_html = draft_configs.get("report_template")
    if not template_html:
        raise HTTPException(
            status_code=400,
            detail="No report template configured. Add a report template before downloading PDF reports.",
        )

    output, filename = await generate_workflow_report_pdf(
        workflow_id, template_html, start_date=start_date, end_date=end_date
    )

    return StreamingResponse(
        output,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/templates")
async def get_workflow_templates() -> List[WorkflowTemplateResponse]:
    """
    Get all available workflow templates.

    Returns:
        List of workflow templates
    """
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


@router.post("/templates/duplicate")
async def duplicate_workflow_template(
    request: DuplicateTemplateRequest, user: UserModel = Depends(get_user)
) -> WorkflowResponse:
    """
    Duplicate a workflow template to create a new workflow for the user.

    Args:
        request: The duplicate template request
        user: The authenticated user

    Returns:
        The newly created workflow
    """
    template_client = WorkflowTemplateClient()
    template = await template_client.get_workflow_template(request.template_id)

    if not template:
        raise HTTPException(
            status_code=404,
            detail=f"Workflow template with id {request.template_id} not found",
        )

    # Create a new workflow from the template
    # Regenerate trigger UUIDs to avoid conflicts with existing triggers
    workflow_def = regenerate_trigger_uuids(template.template_json)

    trigger_paths = extract_trigger_paths(workflow_def) if workflow_def else []
    if trigger_paths:
        try:
            await db_client.assert_trigger_paths_available(
                trigger_paths=trigger_paths,
            )
        except TriggerPathConflictError as e:
            raise HTTPException(status_code=409, detail=str(e))

    workflow = await db_client.create_workflow(
        request.workflow_name,
        workflow_def,
        user.id,
        user.selected_organization_id,
    )

    if trigger_paths:
        await db_client.sync_triggers_for_workflow(
            workflow_id=workflow.id,
            organization_id=user.selected_organization_id,
            trigger_paths=trigger_paths,
        )

    return {
        "id": workflow.id,
        "name": workflow.name,
        "status": workflow.status,
        "created_at": workflow.created_at,
        "workflow_definition": mask_workflow_definition(workflow_def),
        "current_definition_id": workflow.current_definition_id,
        "template_context_variables": workflow.template_context_variables,
        "call_disposition_codes": workflow.call_disposition_codes,
        "workflow_configurations": mask_workflow_configurations(
            workflow.workflow_configurations
        ),
        "utilization_type": workflow.utilization_type,
    }


# ---------------------------------------------------------------------------
# Ambient Noise Upload
# ---------------------------------------------------------------------------


class AmbientNoiseUploadRequest(BaseModel):
    workflow_id: int
    filename: str
    mime_type: str = "audio/wav"
    file_size: int = Field(..., gt=0, le=10_485_760, description="Max 10MB")


class AmbientNoiseUploadResponse(BaseModel):
    upload_url: str
    storage_key: str
    storage_backend: str


@router.post(
    "/ambient-noise/upload-url",
    response_model=AmbientNoiseUploadResponse,
    summary="Get a presigned URL to upload a custom ambient noise audio file",
)
async def get_ambient_noise_upload_url(
    request: AmbientNoiseUploadRequest,
    user=Depends(get_user),
):
    """Generate a presigned PUT URL for uploading a custom ambient noise file."""
    # Utilisation policy applies to uploads against the agent as well.
    await _require_agent_access(request.workflow_id, user)

    sanitized = re.sub(r"[^a-zA-Z0-9._-]", "_", request.filename)
    storage_key = (
        f"ambient-noise/{user.selected_organization_id}"
        f"/{request.workflow_id}/{uuid.uuid4()}_{sanitized}"
    )

    upload_url = await storage_fs.aget_presigned_put_url(
        file_path=storage_key,
        expiration=1800,
        content_type=request.mime_type,
        max_size=request.file_size,
    )
    if not upload_url:
        raise HTTPException(status_code=500, detail="Failed to generate upload URL")

    return AmbientNoiseUploadResponse(
        upload_url=upload_url,
        storage_key=storage_key,
        storage_backend=StorageBackend.get_current_backend().value,
    )
