"""Embed token endpoints for workflows."""

from datetime import UTC, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from loguru import logger
from pydantic import BaseModel

from api.constants import BACKEND_API_ENDPOINT, ENVIRONMENT, UI_APP_URL
from api.db import db_client
from api.db.models import EmbedTokenModel, UserModel
from api.enums import PostHogEvent
from api.schemas.embed import PublicPreCallForm
from api.services.auth.depends import get_user
from api.services.embed.pre_call_form import (
    build_pre_call_form,
    has_unpublished_variable_changes,
    normalize_embed_settings,
    parse_pre_call_form_settings,
    public_pre_call_form,
    resolve_published_definition,
    validate_pre_call_form_config,
    validate_pre_call_form_settings,
)
from api.services.posthog_client import capture_event
from api.services.workflow.agent_utilization import AgentUtilisationService

router = APIRouter(prefix="/workflow")


def generate_embed_script(token: EmbedTokenModel) -> str:
    """Generate the embed script for a given token."""
    base_url = str(UI_APP_URL).rstrip("/")

    return f"""<!-- Convozent Voice Widget -->
<script>
  (function(d, s, id) {{
    var js, fjs = d.getElementsByTagName(s)[0];
    if (d.getElementById(id)) return;
    js = d.createElement(s); js.id = id;
    js.src = '{base_url}/embed/convozent-widget.js?token={token.token}&environment={ENVIRONMENT}&apiEndpoint={BACKEND_API_ENDPOINT}';
    js.async = true;
    fjs.parentNode.insertBefore(js, fjs);
  }}(document, 'script', 'convozent-widget'));
</script>"""


class EmbedTokenRequest(BaseModel):
    allowed_domains: Optional[list[str]] = None
    settings: Optional[dict] = None
    usage_limit: Optional[int] = None
    expires_in_days: Optional[int] = 30


class EmbedTokenResponse(BaseModel):
    id: int
    token: str
    allowed_domains: Optional[list[str]]
    settings: Optional[dict]
    is_active: bool
    usage_count: int
    usage_limit: Optional[int]
    expires_at: Optional[datetime]
    created_at: datetime
    embed_script: str
    pre_call_form_preview: Optional[PublicPreCallForm] = None
    has_unpublished_variable_changes: bool = False


def _validate_and_normalize_settings(
    workflow, settings: Optional[dict]
) -> Optional[dict]:
    parsed = parse_pre_call_form_settings(settings)
    normalized = normalize_embed_settings(settings)
    definition = resolve_published_definition(workflow)
    form = build_pre_call_form(workflow, definition, parsed)
    if form is not None and form.enabled:
        validate_pre_call_form_settings(parsed, form)
        validate_pre_call_form_config(form)
    return normalized


async def _build_embed_token_response(
    token: EmbedTokenModel, workflow
) -> EmbedTokenResponse:
    definition = resolve_published_definition(workflow)
    try:
        parsed = parse_pre_call_form_settings(token.settings)
        form = build_pre_call_form(workflow, definition, parsed)
    except ValueError as exc:
        logger.warning(f"Invalid stored pre-call form settings: {exc}")
        form = None
    draft = await db_client.get_draft_version(token.workflow_id)
    return EmbedTokenResponse(
        id=token.id,
        token=token.token,
        allowed_domains=token.allowed_domains,
        settings=token.settings,
        is_active=token.is_active,
        usage_count=token.usage_count,
        usage_limit=token.usage_limit,
        expires_at=token.expires_at,
        created_at=token.created_at,
        embed_script=generate_embed_script(token),
        pre_call_form_preview=public_pre_call_form(form),
        has_unpublished_variable_changes=has_unpublished_variable_changes(
            workflow, draft, definition
        ),
    )


@router.post("/{workflow_id}/embed-token")
async def create_or_update_embed_token(
    workflow_id: int,
    request: Request,
    embed_request: EmbedTokenRequest,
    user: UserModel = Depends(get_user),
) -> EmbedTokenResponse:
    """
    Create or update an embed token for a workflow.
    Each workflow can have only one active embed token.
    """
    # Verify workflow exists and user has access
    workflow = await AgentUtilisationService.require_agent(user, workflow_id)

    # Check if an embed token already exists for this workflow
    existing_tokens = await db_client.get_embed_tokens_by_workflow(
        workflow_id, user.selected_organization_id, active_only=False
    )

    try:
        settings = _validate_and_normalize_settings(workflow, embed_request.settings)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"Invalid embed settings: {exc}")

    expires_at = None
    if embed_request.expires_in_days:
        expires_at = datetime.now(UTC) + timedelta(days=embed_request.expires_in_days)

    if existing_tokens:
        # Update the existing token (reactivate if needed)
        token = await db_client.update_embed_token(
            existing_tokens[0].id,
            user.selected_organization_id,
            allowed_domains=embed_request.allowed_domains,
            settings=settings,
            usage_limit=embed_request.usage_limit,
            expires_at=expires_at,
            is_active=True,
        )
    else:
        # Create new token
        token = await db_client.create_embed_token(
            workflow_id=workflow_id,
            organization_id=user.selected_organization_id,
            created_by=user.id,
            allowed_domains=embed_request.allowed_domains,
            settings=settings,
            usage_limit=embed_request.usage_limit,
            expires_at=expires_at,
        )

    capture_event(
        distinct_id=str(user.provider_id),
        event=PostHogEvent.AGENT_EMBEDDED,
        properties={
            "workflow_id": workflow_id,
            "is_new_token": len(existing_tokens) == 0,
            "has_domain_restriction": bool(embed_request.allowed_domains),
            "organization_id": user.selected_organization_id,
        },
    )

    # Generate embed script
    return await _build_embed_token_response(token, workflow)


@router.get("/{workflow_id}/embed-token")
async def get_embed_token(
    workflow_id: int,
    request: Request,
    user: UserModel = Depends(get_user),
) -> Optional[EmbedTokenResponse]:
    """
    Get the embed token for a workflow if it exists.
    """
    # Verify workflow exists and user has access
    workflow = await AgentUtilisationService.require_agent(user, workflow_id)

    # Get active embed tokens for this workflow
    tokens = await db_client.get_embed_tokens_by_workflow(
        workflow_id, user.selected_organization_id, active_only=True
    )

    if not tokens:
        return None

    token = tokens[0]  # There should be only one active token per workflow

    return await _build_embed_token_response(token, workflow)


@router.delete("/{workflow_id}/embed-token")
async def deactivate_embed_token(
    workflow_id: int,
    user: UserModel = Depends(get_user),
) -> dict:
    """
    Deactivate the embed token for a workflow.
    """
    # Verify workflow exists and user has access
    workflow = await AgentUtilisationService.require_agent(user, workflow_id)

    # Get active embed tokens for this workflow
    tokens = await db_client.get_embed_tokens_by_workflow(
        workflow_id, user.selected_organization_id, active_only=True
    )

    if not tokens:
        raise HTTPException(
            status_code=404, detail="No active embed token found for this workflow"
        )

    # Deactivate the token
    success = await db_client.deactivate_embed_token(
        tokens[0].id, user.selected_organization_id
    )

    if success:
        return {"message": "Embed token deactivated successfully"}
    else:
        raise HTTPException(status_code=500, detail="Failed to deactivate embed token")
