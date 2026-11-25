"""Teams authorization derives from the existing user + membership records.

There is no separate Teams-role table: platform admins use ``users.is_superuser``
and organization admins use the existing ``organization_memberships.role``
(``admin`` / ``owner``). Other roles are team-scoped and read-only.
"""

import pytest
from fastapi import HTTPException

from api.db.models import (
    OrganizationMembershipModel,
    OrganizationModel,
    TeamModel,
    UserModel,
)
from api.services.teams_access import (
    require_teams_access,
    resolve_target_organization,
)


async def _org(session, label: str) -> OrganizationModel:
    org = OrganizationModel(provider_id=f"teams-auth-org-{label}")
    session.add(org)
    await session.flush()
    return org


async def _user(
    session,
    *,
    provider_id: str,
    org_id: int | None,
    is_superuser: bool = False,
) -> UserModel:
    user = UserModel(
        provider_id=provider_id,
        selected_organization_id=org_id,
        is_superuser=is_superuser,
    )
    session.add(user)
    await session.flush()
    return user


async def _team(session, org_id: int, name: str) -> TeamModel:
    team = TeamModel(organization_id=org_id, name=name)
    session.add(team)
    await session.flush()
    return team


async def _membership(
    session,
    *,
    org_id: int,
    user_id: int,
    role: str,
    team_id: int | None,
) -> None:
    session.add(
        OrganizationMembershipModel(
            organization_id=org_id,
            user_id=user_id,
            role=role,
            team_id=team_id,
        )
    )
    await session.flush()


async def test_global_and_organization_admins_can_manage(async_session, db_session):
    org = await _org(async_session, "admins")
    team = await _team(async_session, org.id, "Admin Team")
    admin = await _user(
        async_session, provider_id="teams-auth-org-admin", org_id=org.id
    )
    await _membership(
        async_session, org_id=org.id, user_id=admin.id, role="admin", team_id=None
    )

    resolved = await require_teams_access(admin, org.id)
    assert resolved.can_view
    assert resolved.can_manage
    assert resolved.can_view_organization
    assert resolved.allowed_team_ids is None

    platform_admin = await _user(
        async_session,
        provider_id="teams-auth-platform-admin",
        org_id=None,
        is_superuser=True,
    )
    assert resolve_target_organization(platform_admin, org.id) == org.id
    platform_access = await require_teams_access(platform_admin, org.id)
    assert platform_access.can_manage
    assert platform_access.can_view_organization
    assert team.id > 0


async def test_assigned_leader_and_member_are_read_only_team_scoped(
    async_session, db_session
):
    org = await _org(async_session, "assigned")
    team_a = await _team(async_session, org.id, "Alpha")
    team_b = await _team(async_session, org.id, "Beta")
    leader = await _user(
        async_session, provider_id="teams-auth-leader", org_id=org.id
    )
    member = await _user(
        async_session, provider_id="teams-auth-member", org_id=org.id
    )
    await _membership(
        async_session,
        org_id=org.id,
        user_id=leader.id,
        role="team_leader",
        team_id=team_a.id,
    )
    await _membership(
        async_session,
        org_id=org.id,
        user_id=member.id,
        role="member",
        team_id=team_a.id,
    )

    leader_access = await require_teams_access(leader, org.id)
    assert leader_access.can_view
    assert not leader_access.can_manage
    assert not leader_access.can_view_organization
    assert leader_access.allowed_team_ids == {team_a.id}
    assert leader_access.can_view_team(team_a.id)
    assert not leader_access.can_view_team(team_b.id)

    member_access = await require_teams_access(member, org.id)
    assert member_access.can_view
    assert not member_access.can_manage
    assert member_access.allowed_team_ids == {team_a.id}
    assert not member_access.can_view_team(team_b.id)


async def test_unassigned_or_removed_members_are_denied(async_session, db_session):
    org = await _org(async_session, "unassigned")
    user = await _user(
        async_session, provider_id="teams-auth-unassigned", org_id=org.id
    )
    await _membership(
        async_session,
        org_id=org.id,
        user_id=user.id,
        role="member",
        team_id=None,
    )

    with pytest.raises(HTTPException) as exc:
        await require_teams_access(user, org.id)
    assert exc.value.status_code == 403
    assert "assigned team" in exc.value.detail


async def test_missing_membership_and_cross_org_override_are_denied(
    async_session, db_session
):
    org_a = await _org(async_session, "cross-a")
    org_b = await _org(async_session, "cross-b")
    user = await _user(
        async_session, provider_id="teams-auth-cross-user", org_id=org_a.id
    )

    with pytest.raises(HTTPException) as missing:
        await require_teams_access(user, org_a.id)
    assert missing.value.status_code == 403

    with pytest.raises(HTTPException) as cross_org:
        resolve_target_organization(user, org_b.id)
    assert cross_org.value.status_code == 403


async def test_unknown_role_is_denied(async_session, db_session):
    org = await _org(async_session, "unknown-role")
    team = await _team(async_session, org.id, "Team")
    user = await _user(
        async_session, provider_id="teams-auth-unknown-role", org_id=org.id
    )
    await _membership(
        async_session,
        org_id=org.id,
        user_id=user.id,
        role="custom_role",
        team_id=team.id,
    )

    with pytest.raises(HTTPException) as exc:
        await require_teams_access(user, org.id)
    assert exc.value.status_code == 403
