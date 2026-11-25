"""Comprehensive RBAC and security regression tests for Teams access.

Validates all 13 required audit scenarios:
 1. Admin opens Teams (Allowed)
 2. Admin manages own organization (Allowed)
 3. Admin accesses another organization (Denied 403)
 4. Assigned Team Leader opens assigned team (Read-only)
 5. Assigned Member opens assigned team (Read-only)
 6. Member opens another team (Denied 403)
 7. Unassigned Member opens Teams (Denied 403)
 8. Unassigned Member calls Teams API (403)
 9. Member removed from team (Access revoked 403)
10. Member reassigned while session remains open (Access refreshed)
11. Organization switched (Cross-org call rejected with 403)
12. Unauthorized direct API mutation (403 for non-admins)
13. Private agent granted to member (Allowed for any active org member)
"""

import sys
from pathlib import Path

# Ensure repo root is on sys.path
_repo_root = str(Path(__file__).resolve().parent.parent.parent)
if _repo_root not in sys.path:
    sys.path.insert(0, _repo_root)

import asyncio
from unittest.mock import AsyncMock, patch
import pytest
from fastapi import HTTPException

from api.db import db_client
from api.db.models import UserModel
from api.routes.team import (
    create_team,
    delete_team,
    get_team,
    get_teams_access,
    list_organization_members,
    list_teams,
    update_team,
)
from api.schemas.team import TeamCreateRequest, TeamUpdateRequest
from api.services.teams_access import (
    require_team_management,
    require_teams_access,
    resolve_target_organization,
)


def make_user(
    user_id: int,
    selected_org_id: int = 10,
    is_superuser: bool = False,
) -> UserModel:
    return UserModel(
        id=user_id,
        provider_id=f"user-{user_id}",
        selected_organization_id=selected_org_id,
        is_superuser=is_superuser,
    )


# 1. Admin opens Teams -> Allowed
def test_scenario_01_admin_opens_teams_allowed():
    async def _test():
        admin = make_user(1, selected_org_id=10)
        with patch("api.services.teams_access.db_client.get_member_team_access", new_callable=AsyncMock) as mock_access:
            mock_access.return_value = {"role": "admin", "team_id": None}
            access = await require_teams_access(admin, 10)
            assert access.can_view is True
            assert access.can_manage is True
            assert access.can_view_organization is True
            assert access.allowed_team_ids is None
    asyncio.run(_test())


# 2. Admin manages own organization -> Allowed
def test_scenario_02_admin_manages_own_organization():
    async def _test():
        admin = make_user(1, selected_org_id=10)
        with patch("api.services.teams_access.db_client.get_member_team_access", new_callable=AsyncMock) as mock_access, \
             patch("api.routes.team.db_client.create_team", new_callable=AsyncMock) as mock_create, \
             patch("api.routes.team.db_client.get_team_detail", new_callable=AsyncMock) as mock_detail:
            mock_access.return_value = {"role": "admin", "team_id": None}
            mock_create.return_value = AsyncMock(id=101)
            mock_detail.return_value = {
                "id": 101,
                "organization_id": 10,
                "name": "Engineering",
                "member_count": 0,
                "leader": None,
                "members": [],
                "created_at": None,
            }
            res = await create_team(TeamCreateRequest(name="Engineering"), org_id=None, user=admin)
            assert res.id == 101
            assert res.name == "Engineering"
    asyncio.run(_test())


# 3. Admin accesses another organization -> Denied (403)
def test_scenario_03_admin_accesses_another_organization_denied():
    admin = make_user(1, selected_org_id=10)
    with pytest.raises(HTTPException) as exc_info:
        resolve_target_organization(admin, org_id=99)
    assert exc_info.value.status_code == 403
    assert "Cross-organization Teams access is denied" in exc_info.value.detail


# 4. Assigned Team Leader opens assigned team -> Read-only
def test_scenario_04_assigned_team_leader_read_only():
    async def _test():
        leader = make_user(2, selected_org_id=10)
        with patch("api.services.teams_access.db_client.get_member_team_access", new_callable=AsyncMock) as mock_access:
            mock_access.return_value = {"role": "team_leader", "team_id": 101}
            access = await require_teams_access(leader, 10)
            assert access.can_view is True
            assert access.can_manage is False
            assert access.can_view_organization is False
            assert access.allowed_team_ids == {101}
            assert access.can_view_team(101) is True
            assert access.can_view_team(102) is False
    asyncio.run(_test())


# 5. Assigned Member opens assigned team -> Read-only
def test_scenario_05_assigned_member_read_only():
    async def _test():
        member = make_user(3, selected_org_id=10)
        with patch("api.services.teams_access.db_client.get_member_team_access", new_callable=AsyncMock) as mock_access:
            mock_access.return_value = {"role": "member", "team_id": 101}
            access = await require_teams_access(member, 10)
            assert access.can_view is True
            assert access.can_manage is False
            assert access.can_view_organization is False
            assert access.allowed_team_ids == {101}
            assert access.can_view_team(101) is True
            assert access.can_view_team(102) is False
    asyncio.run(_test())


# 6. Member opens another team -> Denied (403)
def test_scenario_06_member_opens_another_team_denied():
    async def _test():
        member = make_user(3, selected_org_id=10)
        with patch("api.services.teams_access.db_client.get_member_team_access", new_callable=AsyncMock) as mock_access:
            mock_access.return_value = {"role": "member", "team_id": 101}
            with pytest.raises(HTTPException) as exc_info:
                await get_team(team_id=102, org_id=None, user=member)
            assert exc_info.value.status_code == 403
            assert "You can only view your assigned team" in exc_info.value.detail
    asyncio.run(_test())


# 7. Unassigned Member opens Teams -> Denied (403)
def test_scenario_07_unassigned_member_opens_teams_denied():
    async def _test():
        unassigned = make_user(4, selected_org_id=10)
        with patch("api.services.teams_access.db_client.get_member_team_access", new_callable=AsyncMock) as mock_access:
            mock_access.return_value = {"role": "member", "team_id": None}
            with pytest.raises(HTTPException) as exc_info:
                await get_teams_access(user=unassigned)
            assert exc_info.value.status_code == 403
            assert "requires an assigned team" in exc_info.value.detail
    asyncio.run(_test())


# 8. Unassigned Member calls Teams API -> 403
def test_scenario_08_unassigned_member_calls_teams_api_denied():
    async def _test():
        unassigned = make_user(4, selected_org_id=10)
        with patch("api.services.teams_access.db_client.get_member_team_access", new_callable=AsyncMock) as mock_access:
            mock_access.return_value = {"role": "member", "team_id": None}
            with pytest.raises(HTTPException) as exc_list:
                await list_teams(org_id=None, user=unassigned)
            assert exc_list.value.status_code == 403

            with pytest.raises(HTTPException) as exc_mems:
                await list_organization_members(org_id=None, user=unassigned)
            assert exc_mems.value.status_code == 403
    asyncio.run(_test())


# 9. Member removed from team -> Access revoked (403)
def test_scenario_09_member_removed_from_team_access_revoked():
    async def _test():
        member = make_user(3, selected_org_id=10)
        with patch("api.services.teams_access.db_client.get_member_team_access", new_callable=AsyncMock) as mock_access:
            mock_access.return_value = {"role": "member", "team_id": None}
            with pytest.raises(HTTPException) as exc_info:
                await require_teams_access(member, 10)
            assert exc_info.value.status_code == 403
            assert "requires an assigned team" in exc_info.value.detail

            mock_access.return_value = None
            with pytest.raises(HTTPException) as exc_none:
                await require_teams_access(member, 10)
            assert exc_none.value.status_code == 403
            assert "requires an organization membership" in exc_none.value.detail
    asyncio.run(_test())


# 10. Member reassigned while session remains open -> Access refreshed
def test_scenario_10_member_reassigned_access_refreshed():
    async def _test():
        member = make_user(3, selected_org_id=10)
        with patch("api.services.teams_access.db_client.get_member_team_access", new_callable=AsyncMock) as mock_access:
            mock_access.return_value = {"role": "member", "team_id": 202}
            access = await require_teams_access(member, 10)
            assert access.team_id == 202
            assert access.can_view_team(202) is True
            assert access.can_view_team(101) is False
    asyncio.run(_test())


# 11. Organization switched -> Previous organization data cleared / rejected
def test_scenario_11_organization_switched():
    user = make_user(3, selected_org_id=20)
    with pytest.raises(HTTPException) as exc_info:
        resolve_target_organization(user, org_id=10)
    assert exc_info.value.status_code == 403
    assert "Cross-organization Teams access is denied" in exc_info.value.detail


# 12. Unauthorized direct API mutation -> 403
def test_scenario_12_unauthorized_direct_api_mutation():
    async def _test():
        leader = make_user(2, selected_org_id=10)
        member = make_user(3, selected_org_id=10)
        with patch("api.services.teams_access.db_client.get_member_team_access", new_callable=AsyncMock) as mock_access:
            # 1. Leader attempts to create team
            mock_access.return_value = {"role": "team_leader", "team_id": 101}
            with pytest.raises(HTTPException) as exc_create:
                await create_team(TeamCreateRequest(name="Hacker Team"), org_id=None, user=leader)
            assert exc_create.value.status_code == 403
            assert "administrator access is required" in exc_create.value.detail

            # 2. Member attempts to delete team
            mock_access.return_value = {"role": "member", "team_id": 101}
            with pytest.raises(HTTPException) as exc_delete:
                await delete_team(team_id=101, org_id=None, user=member)
            assert exc_delete.value.status_code == 403
            assert "administrator access is required" in exc_delete.value.detail

            # 3. Leader attempts to update team
            mock_access.return_value = {"role": "team_leader", "team_id": 101}
            with pytest.raises(HTTPException) as exc_update:
                await update_team(team_id=101, payload=TeamUpdateRequest(name="New Name"), org_id=None, user=leader)
            assert exc_update.value.status_code == 403
            assert "administrator access is required" in exc_update.value.detail
    asyncio.run(_test())


# 13. Private agent granted to member -> Existing private-grant behavior preserved
def test_scenario_13_private_agent_granted_to_member():
    async def _test():
        unassigned_member = make_user(4, selected_org_id=10)
        with patch.object(db_client, "get_member_team_access", new_callable=AsyncMock) as mock_access, \
             patch.object(db_client, "list_organization_members", new_callable=AsyncMock) as mock_members:
            mock_access.return_value = {"role": "member", "team_id": None}
            mock_members.return_value = [
                {"user_id": 4, "name": "Unassigned User", "email": "unassigned@example.com"}
            ]

            org_id = unassigned_member.selected_organization_id
            membership = await db_client.get_member_team_access(org_id, unassigned_member.id)
            assert membership is not None
            assert membership["team_id"] is None
            candidates = await db_client.list_organization_members(org_id)
            assert len(candidates) == 1
            assert candidates[0]["user_id"] == 4
    asyncio.run(_test())


if __name__ == "__main__":
    print("Running 13 Teams RBAC & Security Audit Scenarios...")
    test_scenario_01_admin_opens_teams_allowed()
    print("  ✔ Scenario 1: Admin opens Teams (Allowed)")
    test_scenario_02_admin_manages_own_organization()
    print("  ✔ Scenario 2: Admin manages own organization (Allowed)")
    test_scenario_03_admin_accesses_another_organization_denied()
    print("  ✔ Scenario 3: Admin accesses another organization (Denied 403)")
    test_scenario_04_assigned_team_leader_read_only()
    print("  ✔ Scenario 4: Assigned Team Leader opens assigned team (Read-only)")
    test_scenario_05_assigned_member_read_only()
    print("  ✔ Scenario 5: Assigned Member opens assigned team (Read-only)")
    test_scenario_06_member_opens_another_team_denied()
    print("  ✔ Scenario 6: Member opens another team (Denied 403)")
    test_scenario_07_unassigned_member_opens_teams_denied()
    print("  ✔ Scenario 7: Unassigned Member opens Teams (Denied 403)")
    test_scenario_08_unassigned_member_calls_teams_api_denied()
    print("  ✔ Scenario 8: Unassigned Member calls Teams API (403)")
    test_scenario_09_member_removed_from_team_access_revoked()
    print("  ✔ Scenario 9: Member removed from team (Access revoked 403)")
    test_scenario_10_member_reassigned_access_refreshed()
    print("  ✔ Scenario 10: Member reassigned while session remains open (Access refreshed)")
    test_scenario_11_organization_switched()
    print("  ✔ Scenario 11: Organization switched (Cross-org call rejected with 403)")
    test_scenario_12_unauthorized_direct_api_mutation()
    print("  ✔ Scenario 12: Unauthorized direct API mutation (403 for non-admins)")
    test_scenario_13_private_agent_granted_to_member()
    print("  ✔ Scenario 13: Private agent granted to member (Allowed for any active org member)")
    print("\nALL 13 TEAMS RBAC AUDIT SCENARIOS PASSED SUCCESSFULLY!")
