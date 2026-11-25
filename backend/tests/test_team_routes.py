"""Unit and integration tests for Teams, Hierarchy, and Organization Memberships."""

from unittest.mock import AsyncMock, patch
import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from api.schemas.team import (
    HierarchyNode,
    MemberCreateRequest,
    MemberUpdateRequest,
    OrganizationHierarchyResponse,
    TeamCreateRequest,
    TeamResponse,
    TeamUpdateRequest,
)


def test_team_create_validation():
    # Valid
    req = TeamCreateRequest(name="Sales Team", leader_user_id=10)
    assert req.name == "Sales Team"
    assert req.leader_user_id == 10

    # Empty name fails
    with pytest.raises(ValidationError):
        TeamCreateRequest(name="")


def test_member_create_validation():
    # Valid
    req = MemberCreateRequest(
        email="alice@example.com",
        first_name="Alice",
        last_name="Smith",
        role="team_leader",
        team_id=1,
    )
    assert req.email == "alice@example.com"
    assert req.role == "team_leader"

    # Too short email fails
    with pytest.raises(ValidationError):
        MemberCreateRequest(email="a")


def test_hierarchy_tree_structure():
    member_node = HierarchyNode(
        id="member-2",
        type="member",
        name="Bob",
        email="bob@example.com",
        role="member",
        user_id=2,
        parent_user_id=1,
        direct_reports_count=0,
        total_descendants_count=0,
        children=[],
    )
    leader_node = HierarchyNode(
        id="member-1",
        type="team_leader",
        name="Alice",
        email="alice@example.com",
        role="team_leader",
        user_id=1,
        parent_user_id=None,
        direct_reports_count=1,
        total_descendants_count=1,
        children=[member_node],
    )
    team_node = HierarchyNode(
        id="team-1",
        type="team",
        name="Team A",
        team_id=1,
        team_name="Team A",
        direct_reports_count=2,
        total_descendants_count=2,
        children=[leader_node],
    )
    org_node = HierarchyNode(
        id="org-1",
        type="organization",
        name="Org #1",
        children=[team_node],
    )
    tenant_node = HierarchyNode(
        id="tenant",
        type="tenant",
        name="Tenant: Convozent Platform",
        children=[org_node],
    )

    resp = OrganizationHierarchyResponse(
        tenant_name="Convozent Platform",
        organization_id=1,
        organization_name="Org #1",
        tree=tenant_node,
        stats={"total_teams": 1, "total_members": 2, "total_leaders": 1},
    )
    assert resp.organization_id == 1
    assert resp.tree.children[0].children[0].name == "Team A"
    assert resp.tree.children[0].children[0].children[0].children[0].name == "Bob"


@pytest.mark.asyncio
async def test_team_routes_unit_mocked():
    """Test team route handlers with mocked db_client."""
    from api.routes.team import (
        create_team,
        get_member_reporting_chain,
        get_organization_hierarchy,
        list_organization_members,
        list_teams,
        update_member,
    )
    from api.db.models import UserModel

    user = UserModel(
        id=1,
        provider_id="test-user",
        selected_organization_id=99,
        is_superuser=True,
    )

    # 1. Test list_teams
    with patch("api.routes.team.db_client.list_teams", new_callable=AsyncMock) as mock_list:
        mock_list.return_value = [
            {
                "id": 1,
                "organization_id": 99,
                "name": "Alpha Team",
                "member_count": 3,
                "leader_user_id": 10,
                "leader_name": "Leader Jane",
                "created_at": None,
            }
        ]
        res = await list_teams(org_id=None, user=user)
        assert len(res) == 1
        assert res[0].name == "Alpha Team"
        assert res[0].member_count == 3
        mock_list.assert_awaited_once_with(99)

    # 2. Test create_team
    with patch("api.routes.team.db_client.create_team", new_callable=AsyncMock) as mock_create, patch(
        "api.routes.team.db_client.get_team_detail", new_callable=AsyncMock
    ) as mock_detail:
        from api.db.models import TeamModel
        mock_create.return_value = TeamModel(id=5, organization_id=99, name="Beta Team")
        mock_detail.return_value = {
            "id": 5,
            "organization_id": 99,
            "name": "Beta Team",
            "member_count": 0,
            "leader": None,
            "members": [],
            "created_at": None,
        }
        res = await create_team(TeamCreateRequest(name="Beta Team"), org_id=None, user=user)
        assert res.id == 5
        assert res.name == "Beta Team"

    # 3. Test cycle detection error handling in update_member
    with patch("api.routes.team.db_client.upsert_member", new_callable=AsyncMock) as mock_upsert:
        mock_upsert.side_effect = ValueError("Circular reporting detected: cannot assign subordinate.")
        with pytest.raises(HTTPException) as exc_info:
            await update_member(
                target_user_id=2,
                payload=MemberUpdateRequest(parent_user_id=3),
                org_id=None,
                user=user,
            )
        assert exc_info.value.status_code == 400
        assert "Circular reporting" in exc_info.value.detail
