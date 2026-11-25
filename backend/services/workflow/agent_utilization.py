"""Central authorization for the agent (workflow) utilisation policy.

Policy, evaluated per organization boundary (``organization_id``):

- ``PUBLIC``  — every member of the organization that owns the agent.
- ``PRIVATE`` — the agent creator plus the members explicitly granted access
  (``workflows.private_allowed_user_ids``).
- ``CLOSED``  — the creator plus every user *below* the creator in the
  organization's reporting hierarchy (recursive ``parent_user_id`` descendants,
  any depth). Ancestors, siblings, parallel branches and other organizations
  are excluded.

Every agent-facing API path must go through this module so the policy is
implemented exactly once. The bulk/recursive SQL lives in
``WorkflowClient.list_accessible_workflow_ids`` / ``is_workflow_accessible`` so
access checks never degrade into N+1 queries.
"""

from __future__ import annotations

from typing import Iterable

from fastapi import HTTPException

from api.db import db_client
from api.db.models import UserModel, WorkflowModel
from api.enums import WorkflowUtilization

PUBLIC = WorkflowUtilization.PUBLIC.value
PRIVATE = WorkflowUtilization.PRIVATE.value
CLOSED = WorkflowUtilization.CLOSED.value
UTILIZATION_TYPES = frozenset({PUBLIC, PRIVATE, CLOSED})

# Inaccessible agents are reported exactly like missing ones so a caller cannot
# probe for the existence of other people's agents (IDOR).
_NOT_FOUND_DETAIL = "Workflow with id {workflow_id} not found"


class AgentUtilisationService:
    """View/utilisation checks for agents, shared by every API surface."""

    # ------------------------------------------------------------------
    # Validation
    # ------------------------------------------------------------------
    @classmethod
    def normalize_utilisation(cls, utilisation: str | None) -> str:
        """Validate an incoming utilisation value for create/update payloads.

        Raises 422 for anything outside public/private/closed. ``None`` (an
        update that leaves the policy alone) normalizes to ``public``; callers
        that must distinguish "absent" from "public" check the request field
        first.
        """
        if utilisation is None:
            return PUBLIC
        value = str(utilisation).strip().lower()
        if value not in UTILIZATION_TYPES:
            allowed = ", ".join(sorted(UTILIZATION_TYPES))
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Invalid agent utilisation '{utilisation}'. "
                    f"Allowed values: {allowed}."
                ),
            )
        return value

    @classmethod
    async def validate_agent_utilisation(cls, agent: WorkflowModel, user: UserModel) -> bool:
        """Assert ``user`` may reach ``agent`` under its utilisation policy.

        Returns ``True`` when access is granted and raises ``404`` otherwise
        (the same response a missing agent gets, so ids cannot be probed).
        """
        await cls.require_view(user, agent)
        return True

    # ------------------------------------------------------------------
    # Hierarchy
    # ------------------------------------------------------------------
    @staticmethod
    async def get_descendant_members(user_id: int, organization_id: int) -> set[int]:
        """All recursive reporting descendants of ``user_id`` in the org."""
        return await db_client.list_descendant_user_ids(
            organization_id=organization_id, root_user_id=user_id
        )

    # ------------------------------------------------------------------
    # Permissions
    # ------------------------------------------------------------------
    @classmethod
    async def can_view_agent(cls, user: UserModel, agent: WorkflowModel) -> bool:
        return await cls._can_access(user, agent)

    @classmethod
    async def can_utilise_agent(cls, user: UserModel, agent: WorkflowModel) -> bool:
        """Utilisation (run/execute) is granted wherever viewing is."""
        return await cls._can_access(user, agent)

    @classmethod
    async def _can_access(cls, user: UserModel, agent: WorkflowModel) -> bool:
        organization_id = user.selected_organization_id
        if not organization_id or agent.organization_id != organization_id:
            return False
        # Creator short-circuit: no query needed, and it also covers legacy
        # rows whose utilisation_type was written before this column existed.
        if agent.user_id is not None and agent.user_id == user.id:
            return True
        return await db_client.is_workflow_accessible(
            workflow_id=agent.id,
            organization_id=organization_id,
            user_id=user.id,
        )

    @classmethod
    async def get_accessible_agents(cls, user: UserModel) -> set[int]:
        """Ids of every agent in the caller's organization they may access."""
        if not user.selected_organization_id:
            return set()
        return await db_client.list_accessible_workflow_ids(
            organization_id=user.selected_organization_id, user_id=user.id
        )

    # ------------------------------------------------------------------
    # Enforcement helpers
    # ------------------------------------------------------------------
    @classmethod
    async def require_view(cls, user: UserModel, agent: WorkflowModel) -> None:
        if not await cls.can_view_agent(user, agent):
            raise HTTPException(
                status_code=404,
                detail=_NOT_FOUND_DETAIL.format(workflow_id=agent.id),
            )

    @classmethod
    async def require_utilise(cls, user: UserModel, agent: WorkflowModel) -> None:
        if not await cls.can_utilise_agent(user, agent):
            raise HTTPException(
                status_code=404,
                detail=_NOT_FOUND_DETAIL.format(workflow_id=agent.id),
            )

    @classmethod
    async def require_agent(
        cls,
        user: UserModel,
        workflow_id: int,
        *,
        utilise: bool = False,
    ) -> WorkflowModel:
        """Fetch an agent for the caller and enforce the utilisation policy.

        Returns the tenant-scoped agent, or raises 404 — identical for
        "missing" and "not permitted", so ids can't be probed across the
        organization or tenant boundary.
        """
        agent = await db_client.get_workflow(
            workflow_id, organization_id=user.selected_organization_id
        )
        if agent is None:
            raise HTTPException(
                status_code=404,
                detail=_NOT_FOUND_DETAIL.format(workflow_id=workflow_id),
            )
        if utilise:
            await cls.require_utilise(user, agent)
        else:
            await cls.require_view(user, agent)
        return agent

    @classmethod
    def is_creator(cls, agent: WorkflowModel, user: UserModel) -> bool:
        """True when ``user`` created ``agent``."""
        return agent.user_id is not None and agent.user_id == user.id

    @classmethod
    async def normalize_grantee_ids(
        cls,
        organization_id: int | None,
        user_ids: Iterable[int] | None,
        creator_user_id: int | None = None,
    ) -> list[int]:
        """Keep only current org members other than the implicit creator."""
        if not organization_id or not user_ids:
            return []
        member_ids = {
            member["user_id"]
            for member in await db_client.list_organization_members(organization_id)
        }
        return sorted(
            {
                int(uid)
                for uid in user_ids
                if int(uid) in member_ids and int(uid) != creator_user_id
            }
        )
