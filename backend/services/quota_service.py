"""Quota checking service.

Historically this enforced Convozent-hosted (MPS) credit balances before a
billable call/text run started. MPS no longer exists, so this now only
confirms the run's basic identity (workflow exists, actor's org matches) and
otherwise always allows the run through — there is no billing backend left
to check against.
"""

from dataclasses import dataclass

from loguru import logger

from api.db import db_client
from api.db.models import UserModel


@dataclass
class QuotaCheckResult:
    """Result of a quota check."""

    has_quota: bool
    error_message: str = ""
    error_code: str = ""


async def authorize_workflow_run_start(
    *,
    workflow_id: int,
    workflow_run_id: int | None = None,
    actor_user: UserModel | None = None,
) -> QuotaCheckResult:
    """Authorize a workflow run before any call/text runtime starts.

    No credit/quota backend exists anymore; this only validates that the
    workflow exists and, if an actor is provided, that it belongs to the
    actor's organization.
    """
    try:
        workflow = await db_client.get_workflow_by_id(workflow_id)
        if not workflow:
            return QuotaCheckResult(
                has_quota=False,
                error_code="workflow_not_found",
                error_message="Workflow not found",
            )

        actor_org_id = getattr(actor_user, "selected_organization_id", None)
        if actor_org_id is not None and actor_org_id != workflow.organization_id:
            logger.warning(
                "Workflow start authorization denied: actor org {} does not match workflow {} org {}",
                actor_org_id,
                workflow_id,
                workflow.organization_id,
            )
            return QuotaCheckResult(
                has_quota=False,
                error_code="workflow_not_found",
                error_message="Workflow not found",
            )

        return QuotaCheckResult(has_quota=True)

    except Exception as e:
        logger.error(f"Error during quota check: {str(e)}")
        # On unexpected error, allow the call to proceed
        return QuotaCheckResult(has_quota=True)
