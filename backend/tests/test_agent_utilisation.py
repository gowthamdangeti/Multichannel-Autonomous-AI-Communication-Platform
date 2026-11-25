"""Agent utilisation policy: public / private / closed.

Covers the centralized ``AgentUtilisationService`` and the HTTP surface that
must enforce it (list, detail, mutation, execution). The hierarchy used here
mirrors the product spec::

    Team Leader
    ├── Member A
    │   ├── Member A1
    │   │   ├── Member A1.1
    │   │   └── Member A1.2
    │   └── Member A2
    └── Member B
        ├── Member B1
        └── Member B2

CLOSED grants the creator plus their recursive descendants only: no parent, no
sibling branch, no other organization.
"""

import pytest
from fastapi import HTTPException

from api.db.models import (
    OrganizationMembershipModel,
    OrganizationModel,
    TeamModel,
    UserModel,
)
from api.enums import WorkflowUtilization
from api.services.workflow.agent_utilization import AgentUtilisationService

GRAPH = {
    "nodes": [
        {"id": "1", "type": "startCall", "data": {"name": "Start", "prompt": "Hi"}},
        {"id": "2", "type": "endCall", "data": {"name": "End", "prompt": "Bye"}},
    ],
    "edges": [{"id": "e1", "source": "1", "target": "2", "data": {"label": "End"}}],
}


async def _org(session, suffix: str) -> OrganizationModel:
    org = OrganizationModel(provider_id=f"util-org-{suffix}")
    session.add(org)
    await session.flush()
    return org


async def _user(session, suffix: str, org_id: int) -> UserModel:
    user = UserModel(provider_id=f"util-user-{suffix}", selected_organization_id=org_id)
    session.add(user)
    await session.flush()
    return user


async def _member(
    session,
    *,
    org_id: int,
    user_id: int,
    team_id: int | None = None,
    parent_user_id: int | None = None,
) -> None:
    session.add(
        OrganizationMembershipModel(
            organization_id=org_id,
            user_id=user_id,
            team_id=team_id,
            parent_user_id=parent_user_id,
            role="member",
        )
    )
    await session.flush()


class Hierarchy:
    """The spec hierarchy plus a second organization with its own team leader."""

    def __init__(self, org, users: dict[str, UserModel]):
        self.org = org
        self.users = users

    def __getattr__(self, item: str):
        try:
            return self.users[item]
        except KeyError as exc:  # pragma: no cover - typo guard in tests
            raise AttributeError(item) from exc


@pytest.fixture
async def hierarchy(async_session):
    org = await _org(async_session, "a")
    team_a = TeamModel(organization_id=org.id, name="Team A")
    team_b = TeamModel(organization_id=org.id, name="Team B")
    async_session.add_all([team_a, team_b])
    await async_session.flush()

    users = {
        name: await _user(async_session, name, org.id)
        for name in (
            "leader",
            "member_a",
            "member_a1",
            "member_a1_1",
            "member_a1_2",
            "member_a2",
            "member_b",
            "member_b1",
            "member_b2",
            "org_admin",
        )
    }

    # Reporting edges: leader → A/B; A → A1/A2; A1 → A1.1/A1.2; B → B1/B2.
    edges = {
        "leader": None,
        "org_admin": None,
        "member_a": users["leader"].id,
        "member_b": users["leader"].id,
        "member_a1": users["member_a"].id,
        "member_a2": users["member_a"].id,
        "member_b1": users["member_b"].id,
        "member_b2": users["member_b"].id,
        "member_a1_1": users["member_a1"].id,
        "member_a1_2": users["member_a1"].id,
    }
    for name, parent_user_id in edges.items():
        await _member(
            async_session,
            org_id=org.id,
            user_id=users[name].id,
            team_id=team_a.id if name.startswith("member_a") else team_b.id,
            parent_user_id=parent_user_id,
        )

    return Hierarchy(org, users)


async def _agent(
    session, *, creator: UserModel, utilization: str, org_id: int | None = None
):
    return await session.create_workflow(
        name=f"Agent {utilization} {creator.id}",
        workflow_definition=GRAPH,
        user_id=creator.id,
        organization_id=(
            org_id if org_id is not None else creator.selected_organization_id
        ),
        utilization_type=utilization,
    )


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def test_validate_utilisation_accepts_known_values():
    for value in ("public", "private", "closed", "PUBLIC", " Closed "):
        assert AgentUtilisationService.normalize_utilisation(value) in {
            "public",
            "private",
            "closed",
        }


def test_validate_utilisation_rejects_unknown_value():
    with pytest.raises(HTTPException) as exc:
        AgentUtilisationService.normalize_utilisation("shared")
    assert exc.value.status_code == 422


# ---------------------------------------------------------------------------
# PUBLIC
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "viewer",
    ["member_a1_2", "member_a2", "member_b", "member_b2", "leader", "org_admin"],
)
async def test_public_visible_to_every_member_of_the_org(db_session, hierarchy, viewer):
    agent = await _agent(
        db_session,
        creator=hierarchy.member_a,
        utilization=WorkflowUtilization.PUBLIC.value,
    )
    assert await AgentUtilisationService.can_view_agent(hierarchy.users[viewer], agent)
    assert await AgentUtilisationService.can_utilise_agent(
        hierarchy.users[viewer], agent
    )


async def test_public_visible_without_a_membership_row(
    db_session, hierarchy, async_session
):
    """Regression: PUBLIC must not require a reporting-hierarchy row."""
    plain = await _user(async_session, "plain", hierarchy.org.id)
    agent = await _agent(
        db_session,
        creator=hierarchy.member_a,
        utilization=WorkflowUtilization.PUBLIC.value,
    )
    assert await AgentUtilisationService.can_view_agent(plain, agent)


async def test_public_not_visible_in_another_organization(
    db_session, hierarchy, async_session
):
    other_org = await _org(async_session, "b")
    outsider = await _user(async_session, "outsider", other_org.id)
    agent = await _agent(
        db_session,
        creator=hierarchy.member_a,
        utilization=WorkflowUtilization.PUBLIC.value,
    )
    assert not await AgentUtilisationService.can_view_agent(outsider, agent)


# ---------------------------------------------------------------------------
# PRIVATE
# ---------------------------------------------------------------------------


async def test_private_visible_only_to_creator(db_session, hierarchy):
    agent = await _agent(
        db_session,
        creator=hierarchy.member_a,
        utilization=WorkflowUtilization.PRIVATE.value,
    )
    assert await AgentUtilisationService.can_view_agent(hierarchy.member_a, agent)
    for other in (
        "member_a1",
        "member_a1_1",
        "member_a2",
        "member_b",
        "leader",
        "org_admin",
    ):
        assert not await AgentUtilisationService.can_view_agent(
            hierarchy.users[other], agent
        ), other
        assert not await AgentUtilisationService.can_utilise_agent(
            hierarchy.users[other], agent
        ), other


async def test_private_not_visible_across_organizations(
    db_session, hierarchy, async_session
):
    other_org = await _org(async_session, "c")
    outsider = await _user(async_session, "outsider_c", other_org.id)
    agent = await _agent(
        db_session,
        creator=hierarchy.member_a,
        utilization=WorkflowUtilization.PRIVATE.value,
    )
    assert not await AgentUtilisationService.can_view_agent(outsider, agent)


# ---------------------------------------------------------------------------
# CLOSED — the reporting branch only
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "viewer", ["member_a", "member_a1", "member_a1_1", "member_a1_2", "member_a2"]
)
async def test_closed_visible_to_creator_and_descendants(db_session, hierarchy, viewer):
    agent = await _agent(
        db_session,
        creator=hierarchy.member_a,
        utilization=WorkflowUtilization.CLOSED.value,
    )
    user = hierarchy.users[viewer]
    assert await AgentUtilisationService.can_view_agent(user, agent)
    assert await AgentUtilisationService.can_utilise_agent(user, agent)


@pytest.mark.parametrize(
    "viewer", ["leader", "member_b", "member_b1", "member_b2", "org_admin"]
)
async def test_closed_hidden_from_parent_and_other_branches(
    db_session, hierarchy, viewer
):
    agent = await _agent(
        db_session,
        creator=hierarchy.member_a,
        utilization=WorkflowUtilization.CLOSED.value,
    )
    user = hierarchy.users[viewer]
    assert not await AgentUtilisationService.can_view_agent(user, agent), viewer
    assert not await AgentUtilisationService.can_utilise_agent(user, agent), viewer


async def test_closed_not_visible_across_organizations(
    db_session, hierarchy, async_session
):
    other_org = await _org(async_session, "d")
    outsider = await _user(async_session, "outsider_d", other_org.id)
    agent = await _agent(
        db_session,
        creator=hierarchy.member_a,
        utilization=WorkflowUtilization.CLOSED.value,
    )
    assert not await AgentUtilisationService.can_view_agent(outsider, agent)


async def test_closed_from_deep_branch_only_covers_own_subtree(db_session, hierarchy):
    """A1's closed agent reaches A1.1/A1.2 but not A2 or anyone above."""
    agent = await _agent(
        db_session,
        creator=hierarchy.member_a1,
        utilization=WorkflowUtilization.CLOSED.value,
    )
    for allowed in ("member_a1", "member_a1_1", "member_a1_2"):
        assert await AgentUtilisationService.can_view_agent(
            hierarchy.users[allowed], agent
        ), allowed
    for denied in ("member_a", "member_a2", "leader", "member_b"):
        assert not await AgentUtilisationService.can_view_agent(
            hierarchy.users[denied], agent
        ), denied


async def test_get_descendant_members_is_recursive(db_session, hierarchy):
    ids = await AgentUtilisationService.get_descendant_members(
        hierarchy.member_a.id, hierarchy.org.id
    )
    assert ids == {
        hierarchy.member_a1.id,
        hierarchy.member_a1_1.id,
        hierarchy.member_a1_2.id,
        hierarchy.member_a2.id,
    }


# ---------------------------------------------------------------------------
# Bulk listing (backs the list/count/dashboard endpoints)
# ---------------------------------------------------------------------------


async def test_get_accessible_agents_matches_policy(
    db_session, hierarchy, async_session
):
    public_agent = await _agent(
        db_session,
        creator=hierarchy.member_a,
        utilization=WorkflowUtilization.PUBLIC.value,
    )
    private_agent = await _agent(
        db_session,
        creator=hierarchy.member_a,
        utilization=WorkflowUtilization.PRIVATE.value,
    )
    closed_agent = await _agent(
        db_session,
        creator=hierarchy.member_a,
        utilization=WorkflowUtilization.CLOSED.value,
    )
    other_org = await _org(async_session, "e")
    outsider = await _user(async_session, "outsider_e", other_org.id)

    visible_to_a1 = await AgentUtilisationService.get_accessible_agents(
        hierarchy.member_a1
    )
    assert visible_to_a1 == {public_agent.id, closed_agent.id}

    visible_to_b = await AgentUtilisationService.get_accessible_agents(
        hierarchy.member_b
    )
    assert visible_to_b == {public_agent.id}

    visible_to_creator = await AgentUtilisationService.get_accessible_agents(
        hierarchy.member_a
    )
    assert visible_to_creator == {public_agent.id, private_agent.id, closed_agent.id}

    assert await AgentUtilisationService.get_accessible_agents(outsider) == set()


async def test_is_workflow_accessible_respects_tenant_boundary(
    db_session, hierarchy, async_session
):
    other_org = await _org(async_session, "f")
    outsider = await _user(async_session, "outsider_f", other_org.id)
    agent = await _agent(
        db_session,
        creator=hierarchy.member_a,
        utilization=WorkflowUtilization.PUBLIC.value,
    )
    assert await db_session.is_workflow_accessible(
        workflow_id=agent.id,
        organization_id=hierarchy.org.id,
        user_id=hierarchy.member_b.id,
    )
    assert not await db_session.is_workflow_accessible(
        workflow_id=agent.id,
        organization_id=other_org.id,
        user_id=outsider.id,
    )


# ---------------------------------------------------------------------------
# Defaults / backward compatibility
# ---------------------------------------------------------------------------


async def test_workflows_default_to_public(db_session, hierarchy):
    """Legacy rows carry no explicit policy: they stay org-visible."""
    db_session_workflow = await db_session.create_workflow(
        name="legacy-explicit",
        workflow_definition=GRAPH,
        user_id=hierarchy.member_a.id,
        organization_id=hierarchy.org.id,
    )
    assert db_session_workflow.utilization_type == WorkflowUtilization.PUBLIC.value


# ---------------------------------------------------------------------------
# API Security tests (HTTP endpoint enforcement)
# ---------------------------------------------------------------------------


async def test_api_direct_access_enforces_closed_policy(
    db_session, hierarchy, test_client_factory
):
    """Direct API access to a restricted agent is denied (404 / IDOR prevention)."""
    closed_agent = await _agent(
        db_session, creator=hierarchy.member_a, utilization=WorkflowUtilization.CLOSED.value
    )

    # 1. Creator can fetch
    async with test_client_factory(hierarchy.member_a) as client:
        resp = await client.get(f"/api/v1/workflow/fetch/{closed_agent.id}")
        assert resp.status_code == 200
        assert resp.json()["id"] == closed_agent.id
        assert resp.json()["utilization_type"] == "closed"

    # 2. Descendant (member_a1) can fetch
    async with test_client_factory(hierarchy.member_a1) as client:
        resp = await client.get(f"/api/v1/workflow/fetch/{closed_agent.id}")
        assert resp.status_code == 200
        assert resp.json()["id"] == closed_agent.id

    # 3. Non-descendant in another branch (member_b) is denied (404)
    async with test_client_factory(hierarchy.member_b) as client:
        resp = await client.get(f"/api/v1/workflow/fetch/{closed_agent.id}")
        assert resp.status_code == 404

    # 4. Ancestor (leader) is denied (404)
    async with test_client_factory(hierarchy.leader) as client:
        resp = await client.get(f"/api/v1/workflow/fetch/{closed_agent.id}")
        assert resp.status_code == 404


async def test_api_workflow_listing_filters_restricted_agents(
    db_session, hierarchy, test_client_factory
):
    """Listing endpoints never expose restricted agents to unauthorized users."""
    public_agent = await _agent(
        db_session, creator=hierarchy.member_a, utilization=WorkflowUtilization.PUBLIC.value
    )
    private_agent = await _agent(
        db_session, creator=hierarchy.member_a, utilization=WorkflowUtilization.PRIVATE.value
    )
    closed_agent = await _agent(
        db_session, creator=hierarchy.member_a, utilization=WorkflowUtilization.CLOSED.value
    )

    # Creator sees all 3
    async with test_client_factory(hierarchy.member_a) as client:
        resp = await client.get("/api/v1/workflow/fetch")
        assert resp.status_code == 200
        ids = {w["id"] for w in resp.json()}
        assert {public_agent.id, private_agent.id, closed_agent.id}.issubset(ids)

    # Descendant (member_a1) sees public and closed, but not private
    async with test_client_factory(hierarchy.member_a1) as client:
        resp = await client.get("/api/v1/workflow/fetch")
        assert resp.status_code == 200
        ids = {w["id"] for w in resp.json()}
        assert public_agent.id in ids
        assert closed_agent.id in ids
        assert private_agent.id not in ids

    # Parallel branch (member_b) sees only public
    async with test_client_factory(hierarchy.member_b) as client:
        resp = await client.get("/api/v1/workflow/fetch")
        assert resp.status_code == 200
        ids = {w["id"] for w in resp.json()}
        assert public_agent.id in ids
        assert closed_agent.id not in ids
        assert private_agent.id not in ids


async def test_api_non_creator_cannot_change_agent_utilisation(
    db_session, hierarchy, test_client_factory
):
    """Only the agent creator can change its utilisation policy."""
    closed_agent = await _agent(
        db_session, creator=hierarchy.member_a, utilization=WorkflowUtilization.CLOSED.value
    )

    # Descendant can view/utilise, but CANNOT widen utilisation to public
    async with test_client_factory(hierarchy.member_a1) as client:
        resp = await client.put(
            f"/api/v1/workflow/{closed_agent.id}",
            json={
                "name": "Hacked Agent",
                "utilization_type": "public",
            },
        )
        assert resp.status_code == 403
        assert "Only the agent creator can change its utilisation" in resp.json()["detail"]

    # Creator CAN change utilisation
    async with test_client_factory(hierarchy.member_a) as client:
        resp = await client.put(
            f"/api/v1/workflow/{closed_agent.id}",
            json={
                "name": closed_agent.name,
                "utilization_type": "private",
            },
        )
        assert resp.status_code == 200
        assert resp.json()["utilization_type"] == "private"


async def test_api_execution_checks_utilisation_permission(
    db_session, hierarchy, test_client_factory
):
    """Execution endpoint rejects runs against restricted agents."""
    closed_agent = await _agent(
        db_session, creator=hierarchy.member_a, utilization=WorkflowUtilization.CLOSED.value
    )

    # Non-permitted user cannot create run
    async with test_client_factory(hierarchy.member_b) as client:
        resp = await client.post(
            f"/api/v1/workflow/{closed_agent.id}/runs",
            json={"name": "Illegal Run", "mode": "webrtc"},
        )
        assert resp.status_code == 404


async def test_api_duplication_checks_permission_and_sets_creator(
    db_session, hierarchy, test_client_factory
):
    """Duplication checks access and assigns new creator."""
    closed_agent = await _agent(
        db_session, creator=hierarchy.member_a, utilization=WorkflowUtilization.CLOSED.value
    )

    # Non-permitted user cannot duplicate
    async with test_client_factory(hierarchy.member_b) as client:
        resp = await client.post(f"/api/v1/workflow/{closed_agent.id}/duplicate")
        assert resp.status_code == 404

    # Permitted descendant can duplicate
    async with test_client_factory(hierarchy.member_a1) as client:
        resp = await client.post(f"/api/v1/workflow/{closed_agent.id}/duplicate")
        assert resp.status_code == 200
        dup_data = resp.json()
        assert dup_data["id"] != closed_agent.id
        assert dup_data["utilization_type"] == "closed"
