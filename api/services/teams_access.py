"""Role- and membership-scoped authorization for the Teams API.

The existing model has no separate organization-role table: organization
membership is stored in ``organization_memberships.role`` (currently
``member`` / ``team_leader``; legacy ``admin`` / ``owner`` values are also
recognized), while platform administrators use ``users.is_superuser``.

A non-admin must have an active membership in the selected organization and a
valid team assignment. Admins can manage the selected organization; team
leaders and members are read-only and scoped to their assigned team. No role is
inferred from frontend state.
"""

from dataclasses import dataclass

from fastapi import HTTPException

from api.db import db_client
from api.db.models import UserModel

ADMIN_ROLES = frozenset({"admin", "owner"})
TEAM_LEADER_ROLE = "team_leader"
MEMBER_ROLE = "member"


@dataclass(frozen=True)
class TeamsAccess:
    organization_id: int
    user_id: int
    role: str
    team_id: int | None
    can_manage: bool

    @property
    def can_view(self) -> bool:
        """A resolved access context is always allowed to view its scope."""
        return True
    @property
    def can_view_organization(self) -> bool:
        return self.can_manage

    @property
    def allowed_team_ids(self) -> set[int] | None:
        """None means all org teams; a set restricts the caller to those teams."""
        if self.can_manage:
            return None
        return {self.team_id} if self.team_id is not None else set()

    def can_view_team(self, team_id: int | None) -> bool:
        if self.can_manage:
            return True
        return team_id is not None and team_id == self.team_id


def resolve_target_organization(user: UserModel, org_id: int | None = None) -> int:
    """Keep all requests inside the caller's selected organization.

    Only a global superuser may override the organization. A non-superuser who
    supplies a different ``org_id`` gets an explicit 403 instead of silently
    being redirected to their current organization.
    """
    if user.is_superuser and org_id is not None:
        return org_id
    selected = user.selected_organization_id
    if selected is None:
        raise HTTPException(status_code=400, detail="No organization selected")
    if org_id is None or org_id == selected:
        return selected
    raise HTTPException(status_code=403, detail="Cross-organization Teams access is denied")


async def require_teams_access(
    user: UserModel, organization_id: int
) -> TeamsAccess:
    """Resolve the user's existing role and team assignment or deny access."""
    if user.is_superuser:
        return TeamsAccess(
            organization_id=organization_id,
            user_id=user.id,
            role="admin",
            team_id=None,
            can_manage=True,
        )

    membership = await db_client.get_member_team_access(organization_id, user.id)
    if membership is None:
        raise HTTPException(status_code=403, detail="Teams access requires an organization membership")

    role = str(membership["role"] or MEMBER_ROLE).lower()
    team_id = membership["team_id"]

    # Organization admins are represented by the existing membership role. The
    # global superuser flag remains the platform-admin override above.
    if role in ADMIN_ROLES:
        return TeamsAccess(
            organization_id=organization_id,
            user_id=user.id,
            role=role,
            team_id=team_id,
            can_manage=True,
        )

    if role not in {TEAM_LEADER_ROLE, MEMBER_ROLE}:
        raise HTTPException(status_code=403, detail="This organization role has no Teams access")
    if team_id is None:
        raise HTTPException(status_code=403, detail="Teams access requires an assigned team")

    return TeamsAccess(
        organization_id=organization_id,
        user_id=user.id,
        role=role,
        team_id=team_id,
        can_manage=False,
    )


def require_team_management(access: TeamsAccess) -> None:
    """Only organization admins may mutate teams, assignments or membership."""
    if not access.can_manage:
        raise HTTPException(
            status_code=403,
            detail="Organization administrator access is required to manage Teams.",
        )
