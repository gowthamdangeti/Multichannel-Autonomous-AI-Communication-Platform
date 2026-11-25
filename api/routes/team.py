"""API routes for Teams, Memberships, and Organization Reporting Hierarchy."""

from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from loguru import logger

from api.db import db_client
from api.db.models import UserModel
from api.schemas.team import (
    HierarchyNode,
    MemberCreateRequest,
    MemberReportingResponse,
    MemberUpdateRequest,
    OrganizationHierarchyResponse,
    TeamCreateRequest,
    TeamDetailResponse,
    TeamMemberInfo,
    TeamResponse,
    TeamUpdateRequest,
)
from api.services.auth.depends import get_user
from api.services.teams_access import (
    TeamsAccess,
    require_team_management,
    require_teams_access,
    resolve_target_organization,
)

router = APIRouter(prefix="/teams", tags=["teams"])


async def _resolve_access(
    user: UserModel, org_id: Optional[int] = None
) -> tuple[int, TeamsAccess]:
    target_org_id = resolve_target_organization(user, org_id)
    access = await require_teams_access(user, target_org_id)
    return target_org_id, access


def _scope_hierarchy_to_team(tree: dict, team_id: int) -> dict:
    """Return the same tenant/org shape, containing only the caller's team."""
    def prune(node: dict) -> dict | None:
        node_type = node.get("type")
        if node_type == "team":
            if node.get("team_id") != team_id:
                return None
            children = [child for raw in node.get("children", []) if (child := prune(raw))]
            return {**node, "children": children}
        if node_type in {"member", "team_leader"}:
            if node.get("team_id") != team_id:
                return None
            children = [child for raw in node.get("children", []) if (child := prune(raw))]
            total = sum(1 + child.get("total_descendants_count", 0) for child in children)
            return {
                **node,
                "children": children,
                "direct_reports_count": len(children),
                "total_descendants_count": total,
            }
        children = [child for raw in node.get("children", []) if (child := prune(raw))]
        return {**node, "children": children}

    return prune(tree) or {
        "id": "tenant-root",
        "type": "tenant",
        "name": "Tenant: Convozent Platform",
        "children": [],
        "direct_reports_count": 0,
        "total_descendants_count": 0,
    }


def _count_people(tree: dict) -> tuple[int, int]:
    people = 0
    leaders = 0
    stack = [tree]
    while stack:
        node = stack.pop()
        if node.get("type") in {"member", "team_leader"} and node.get("user_id"):
            people += 1
            if node.get("type") == "team_leader" or node.get("role") == "team_leader":
                leaders += 1
        stack.extend(node.get("children", []))
    return people, leaders


@router.get("/access")
async def get_teams_access(user: UserModel = Depends(get_user)):
    """Current user's Teams entitlement; the sidebar revalidates this on focus."""
    organization_id, access = await _resolve_access(user)
    return {
        "organization_id": organization_id,
        "role": access.role,
        "team_id": access.team_id,
        "can_view": True,
        "can_manage": access.can_manage,
        "can_view_organization": access.can_view_organization,
    }

# ─────────────────────────────────────────────────────────────────────────────
# Hierarchy & Stats
# ─────────────────────────────────────────────────────────────────────────────


@router.get("/hierarchy", response_model=OrganizationHierarchyResponse)
async def get_organization_hierarchy(
    org_id: Optional[int] = Query(None, description="Optional org ID override for superusers"),
    user: UserModel = Depends(get_user),
):
    """Return the complete organization reporting hierarchy as an interactive tree:
    Tenant -> Organizations -> Teams -> Team Leaders -> Team Members.
    """
    target_org_id, access = await _resolve_access(user, org_id)
    try:
        data = await db_client.get_organization_hierarchy(target_org_id)
        if not access.can_manage:
            scoped_tree = _scope_hierarchy_to_team(data["tree"], access.team_id)
            scoped_members, scoped_leaders = _count_people(scoped_tree)
            organizations = scoped_tree.get("children", [])
            scoped_teams = organizations[0].get("children", []) if organizations else []
            data = {
                **data,
                "tree": scoped_tree,
                "stats": {
                    "total_teams": len(scoped_teams),
                    "total_members": scoped_members,
                    "total_leaders": scoped_leaders,
                },
            }
        return OrganizationHierarchyResponse.model_validate(data)
    except Exception as exc:
        logger.error(f"Failed to fetch organization hierarchy: {exc}")
        raise HTTPException(status_code=500, detail="Failed to load hierarchy data.")


# ─────────────────────────────────────────────────────────────────────────────
# Teams CRUD
# ─────────────────────────────────────────────────────────────────────────────


@router.get("", response_model=List[TeamResponse])
async def list_teams(
    org_id: Optional[int] = Query(None, description="Optional org ID override for superusers"),
    user: UserModel = Depends(get_user),
):
    """List all teams for the active organization with member counts and leader info."""
    target_org_id, access = await _resolve_access(user, org_id)
    try:
        teams = await db_client.list_teams(target_org_id)
        if not access.can_manage:
            teams = [team for team in teams if team["id"] == access.team_id]
        return [TeamResponse.model_validate(team) for team in teams]
    except Exception as exc:
        logger.error(f"Failed to list teams: {exc}")
        raise HTTPException(status_code=500, detail="Failed to list teams.")


@router.post("", response_model=TeamDetailResponse, status_code=201)
async def create_team(
    payload: TeamCreateRequest,
    org_id: Optional[int] = Query(None, description="Optional org ID override for superusers"),
    user: UserModel = Depends(get_user),
):
    """Create a new team in the organization and optionally assign a team leader."""
    target_org_id, access = await _resolve_access(user, org_id)
    require_team_management(access)
    try:
        team = await db_client.create_team(
            organization_id=target_org_id,
            name=payload.name,
            leader_user_id=payload.leader_user_id,
        )
        detail = await db_client.get_team_detail(team.id, target_org_id)
        if not detail:
            raise HTTPException(status_code=500, detail="Failed to retrieve created team.")
        return TeamDetailResponse.model_validate(detail)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.error(f"Failed to create team: {exc}")
        raise HTTPException(status_code=500, detail="Failed to create team.")


@router.get("/members", response_model=List[TeamMemberInfo])
async def list_organization_members(
    org_id: Optional[int] = Query(None, description="Optional org ID override for superusers"),
    user: UserModel = Depends(get_user),
):
    """List all members belonging to the organization."""
    target_org_id, access = await _resolve_access(user, org_id)
    try:
        members = await db_client.list_organization_members(target_org_id)
        if not access.can_manage:
            members = [member for member in members if member["team_id"] == access.team_id]
        return [TeamMemberInfo.model_validate(member) for member in members]
    except Exception as exc:
        logger.exception(f"Failed to list organization members: {exc}")
        raise HTTPException(status_code=500, detail=f"Failed to list organization members: {str(exc)}")


@router.post("/members", response_model=TeamMemberInfo, status_code=201)
async def add_organization_member(
    payload: MemberCreateRequest,
    org_id: Optional[int] = Query(None, description="Optional org ID override for superusers"),
    user: UserModel = Depends(get_user),
):
    target_org_id, access = await _resolve_access(user, org_id)
    require_team_management(access)
    try:
        member = await db_client.create_and_add_member(
            organization_id=target_org_id,
            email=payload.email,
            first_name=payload.first_name,
            last_name=payload.last_name,
            role=payload.role,
            team_id=payload.team_id,
            parent_user_id=payload.parent_user_id,
        )
        return TeamMemberInfo.model_validate(member)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.exception(f"Failed to add organization member: {exc}")
        raise HTTPException(status_code=500, detail=f"Failed to add organization member: {str(exc)}")


@router.get("/members/{target_user_id}/reporting", response_model=MemberReportingResponse)
async def get_member_reporting_chain(
    target_user_id: int,
    org_id: Optional[int] = Query(None, description="Optional org ID override for superusers"),
    user: UserModel = Depends(get_user),
):
    """View a member's reporting line (managers upward, direct reports downward, and total recursive count)."""
    target_org_id, access = await _resolve_access(user, org_id)
    if not access.can_manage:
        target = await db_client.get_member_team_access(target_org_id, target_user_id)
        if target is None or target["team_id"] != access.team_id:
            raise HTTPException(status_code=403, detail="You can only view reporting relationships in your assigned team.")
    try:
        data = await db_client.get_member_reporting_chain(target_org_id, target_user_id)
        if not access.can_manage:
            data["manager_chain"] = [
                member for member in data["manager_chain"] if member["team_id"] == access.team_id
            ]
            data["direct_reports"] = [
                member for member in data["direct_reports"] if member["team_id"] == access.team_id
            ]
        return MemberReportingResponse.model_validate(data)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.error(f"Failed to fetch reporting line: {exc}")
        raise HTTPException(status_code=500, detail="Failed to fetch reporting line.")


@router.patch("/members/{target_user_id}", response_model=TeamMemberInfo)
async def update_member(
    target_user_id: int,
    payload: MemberUpdateRequest,
    org_id: Optional[int] = Query(None, description="Optional org ID override for superusers"),
    user: UserModel = Depends(get_user),
):
    """Update a member's team, reporting manager, or role."""
    target_org_id, access = await _resolve_access(user, org_id)
    require_team_management(access)
    try:
        updated = await db_client.upsert_member(
            organization_id=target_org_id,
            user_id=target_user_id,
            role=payload.role,
            team_id=payload.team_id,
            parent_user_id=payload.parent_user_id,
            clear_team=payload.clear_team,
            clear_parent=payload.clear_parent,
        )
        return TeamMemberInfo.model_validate(updated)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.error(f"Failed to update member: {exc}")
        raise HTTPException(status_code=500, detail="Failed to update member.")


@router.delete("/members/{target_user_id}")
async def remove_member(
    target_user_id: int,
    from_team_only: bool = Query(False, description="Whether to only detach from team without removing from organization"),
    org_id: Optional[int] = Query(None, description="Optional org ID override for superusers"),
    user: UserModel = Depends(get_user),
):
    """Remove a member from a team or from the organization."""
    target_org_id, access = await _resolve_access(user, org_id)
    require_team_management(access)
    try:
        removed = await db_client.remove_member(
            organization_id=target_org_id,
            user_id=target_user_id,
            from_team_only=from_team_only,
        )
        if not removed:
            raise HTTPException(status_code=404, detail="Member not found in this organization.")
        return {"success": True, "message": "Member updated successfully."}
    except Exception as exc:
        logger.error(f"Failed to remove member: {exc}")
        raise HTTPException(status_code=500, detail="Failed to remove member.")


@router.get("/{team_id}", response_model=TeamDetailResponse)
async def get_team(
    team_id: int,
    org_id: Optional[int] = Query(None, description="Optional org ID override for superusers"),
    user: UserModel = Depends(get_user),
):
    """Get single team details with leader and members."""
    target_org_id, access = await _resolve_access(user, org_id)
    if not access.can_view_team(team_id):
        raise HTTPException(status_code=403, detail="You can only view your assigned team.")
    detail = await db_client.get_team_detail(team_id, target_org_id)
    if not detail:
        raise HTTPException(status_code=404, detail=f"Team #{team_id} not found in this organization.")
    return TeamDetailResponse.model_validate(detail)


@router.patch("/{team_id}", response_model=TeamDetailResponse)
async def update_team(
    team_id: int,
    payload: TeamUpdateRequest,
    org_id: Optional[int] = Query(None, description="Optional org ID override for superusers"),
    user: UserModel = Depends(get_user),
):
    """Update team name and/or assign a team leader."""
    target_org_id, access = await _resolve_access(user, org_id)
    require_team_management(access)
    try:
        team = await db_client.update_team(
            team_id=team_id,
            organization_id=target_org_id,
            name=payload.name,
            leader_user_id=payload.leader_user_id,
        )
        if not team:
            raise HTTPException(status_code=404, detail=f"Team #{team_id} not found in this organization.")
        detail = await db_client.get_team_detail(team_id, target_org_id)
        return TeamDetailResponse.model_validate(detail)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.error(f"Failed to update team: {exc}")
        raise HTTPException(status_code=500, detail="Failed to update team.")


@router.delete("/{team_id}")
async def delete_team(
    team_id: int,
    org_id: Optional[int] = Query(None, description="Optional org ID override for superusers"),
    user: UserModel = Depends(get_user),
):
    """Delete a team."""
    target_org_id, access = await _resolve_access(user, org_id)
    require_team_management(access)
    deleted = await db_client.delete_team(team_id, target_org_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Team #{team_id} not found in this organization.")
    return {"success": True, "message": f"Team #{team_id} deleted."}

