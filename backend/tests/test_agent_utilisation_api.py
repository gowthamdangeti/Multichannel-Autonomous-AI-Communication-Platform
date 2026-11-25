"""HTTP-surface tests for the agent utilisation policy.

The service-level matrix lives in ``test_agent_utilisation.py``. This module
proves the policy is actually enforced at the API boundary — a restricted
agent must not be reachable through any request the client can craft:

- detail / list / execution return 404 (indistinguishable from missing),
- the agent list never contains a restricted agent,
- only the creator may change the utilisation policy,
- nothing in the request body can widen access.
"""

import pytest

from api.db.models import (
    OrganizationMembershipModel,
    OrganizationModel,
    UserModel,
)
from api.enums import WorkflowUtilization

GRAPH = {
    "nodes": [
        {"id": "1", "type": "startCall", "data": {"name": "Start", "prompt": "Hi"}},
        {"id": "2", "type": "endCall", "data": {"name": "End", "prompt": "Bye"}},
    ],
    "edges": [{"id": "e1", "source": "1", "target": "2", "data": {"label": "End"}}],
}

API = "/api/v1"


async def _user(session, suffix: str, org_id: int) -> UserModel:
    user = UserModel(
        provider_id=f"util-api-user-{suffix}", selected_organization_id=org_id
    )
    session.add(user)
    await session.flush()
    return user


async def _member(
    session, *, org_id: int, user_id: int, parent_user_id: int | None
) -> None:
    session.add(
        OrganizationMembershipModel(
            organization_id=org_id,
            user_id=user_id,
            parent_user_id=parent_user_id,
            role="member",
        )
    )
    await session.flush()


@pytest.fixture
async def api_hierarchy(async_session):
    """One org: ``creator`` → ``child`` → ``grandchild``, plus a sibling."""
    org = OrganizationModel(provider_id="util-api-org")
    async_session.add(org)
    await async_session.flush()

    creator = await _user(async_session, "creator", org.id)
    child = await _user(async_session, "child", org.id)
    grandchild = await _user(async_session, "grandchild", org.id)
    sibling = await _user(async_session, "sibling", org.id)

    await _member(async_session, org_id=org.id, user_id=creator.id, parent_user_id=None)
    await _member(
        async_session, org_id=org.id, user_id=child.id, parent_user_id=creator.id
    )
    await _member(
        async_session, org_id=org.id, user_id=grandchild.id, parent_user_id=child.id
    )
    await _member(async_session, org_id=org.id, user_id=sibling.id, parent_user_id=None)

    return {
        "org": org,
        "creator": creator,
        "child": child,
        "grandchild": grandchild,
        "sibling": sibling,
    }


async def _agent(db_session, *, creator: UserModel, utilization: str):
    return await db_session.create_workflow(
        name=f"API {utilization} {creator.id}",
        workflow_definition=GRAPH,
        user_id=creator.id,
        organization_id=creator.selected_organization_id,
        utilization_type=utilization,
    )


@pytest.mark.parametrize("viewer_key", ["child", "grandchild", "sibling"])
async def test_private_agent_detail_is_404_for_everyone_else(
    db_session, api_hierarchy, test_client_factory, viewer_key
):
    agent = await _agent(
        db_session,
        creator=api_hierarchy["creator"],
        utilization=WorkflowUtilization.PRIVATE.value,
    )
    async with test_client_factory(api_hierarchy[viewer_key]) as client:
        response = await client.get(f"{API}/workflow/fetch/{agent.id}")
    assert response.status_code == 404


async def test_private_agent_detail_reachable_for_creator(
    db_session, api_hierarchy, test_client_factory
):
    agent = await _agent(
        db_session,
        creator=api_hierarchy["creator"],
        utilization=WorkflowUtilization.PRIVATE.value,
    )
    async with test_client_factory(api_hierarchy["creator"]) as client:
        response = await client.get(f"{API}/workflow/fetch/{agent.id}")
    assert response.status_code == 200
    assert response.json()["utilization_type"] == "private"


async def test_closed_agent_detail_allows_descendant_and_denies_sibling(
    db_session, api_hierarchy, test_client_factory
):
    agent = await _agent(
        db_session,
        creator=api_hierarchy["creator"],
        utilization=WorkflowUtilization.CLOSED.value,
    )
    async with test_client_factory(api_hierarchy["grandchild"]) as client:
        assert (await client.get(f"{API}/workflow/fetch/{agent.id}")).status_code == 200
    async with test_client_factory(api_hierarchy["sibling"]) as client:
        assert (await client.get(f"{API}/workflow/fetch/{agent.id}")).status_code == 404


async def test_agent_list_hides_restricted_agents(
    db_session, api_hierarchy, test_client_factory
):
    creator = api_hierarchy["creator"]
    public_agent = await _agent(
        db_session, creator=creator, utilization=WorkflowUtilization.PUBLIC.value
    )
    private_agent = await _agent(
        db_session, creator=creator, utilization=WorkflowUtilization.PRIVATE.value
    )
    closed_agent = await _agent(
        db_session, creator=creator, utilization=WorkflowUtilization.CLOSED.value
    )

    async with test_client_factory(api_hierarchy["sibling"]) as client:
        payload = (await client.get(f"{API}/workflow/fetch")).json()
    visible = {row["id"] for row in payload}
    assert visible == {public_agent.id}

    async with test_client_factory(creator) as client:
        payload = (await client.get(f"{API}/workflow/fetch")).json()
    assert {row["id"] for row in payload} == {
        public_agent.id,
        private_agent.id,
        closed_agent.id,
    }

    # Search is client-side over this same payload, so the restricted rows must
    # not appear anywhere in the response body either.
    async with test_client_factory(api_hierarchy["sibling"]) as client:
        body = (await client.get(f"{API}/workflow/fetch")).text
    assert private_agent.name not in body
    assert closed_agent.name not in body


async def test_count_and_summary_respect_the_policy(
    db_session, api_hierarchy, test_client_factory
):
    creator = api_hierarchy["creator"]
    await _agent(
        db_session, creator=creator, utilization=WorkflowUtilization.PUBLIC.value
    )
    await _agent(
        db_session, creator=creator, utilization=WorkflowUtilization.PRIVATE.value
    )

    async with test_client_factory(api_hierarchy["sibling"]) as client:
        count = (await client.get(f"{API}/workflow/count")).json()
        summary = (await client.get(f"{API}/workflow/summary")).json()
    assert count["total"] == 1
    assert len(summary) == 1


async def test_execution_requires_utilisation_permission(
    db_session, api_hierarchy, test_client_factory
):
    """A private agent cannot be started by anyone but its creator."""
    agent = await _agent(
        db_session,
        creator=api_hierarchy["creator"],
        utilization=WorkflowUtilization.PRIVATE.value,
    )
    async with test_client_factory(api_hierarchy["sibling"]) as client:
        response = await client.post(
            f"{API}/workflow/{agent.id}/runs", json={"mode": "webrtc", "name": "probe"}
        )
    assert response.status_code == 404


async def test_execution_allowed_for_closed_branch_member(
    db_session, api_hierarchy, test_client_factory
):
    """The utilisation check must pass for a descendant (any later failure is
    unrelated to permissions), proving execution is not creator-only."""
    agent = await _agent(
        db_session,
        creator=api_hierarchy["creator"],
        utilization=WorkflowUtilization.CLOSED.value,
    )
    async with test_client_factory(api_hierarchy["grandchild"]) as client:
        response = await client.post(
            f"{API}/workflow/{agent.id}/runs", json={"mode": "webrtc", "name": "run"}
        )
    assert response.status_code != 404


async def test_request_body_cannot_widen_access(
    db_session, api_hierarchy, test_client_factory
):
    """Extra body fields (e.g. another user's id) must not affect authorisation."""
    agent = await _agent(
        db_session,
        creator=api_hierarchy["creator"],
        utilization=WorkflowUtilization.PRIVATE.value,
    )
    async with test_client_factory(api_hierarchy["sibling"]) as client:
        response = await client.post(
            f"{API}/workflow/{agent.id}/runs",
            json={
                "mode": "webrtc",
                "name": "probe",
                "user_id": api_hierarchy["creator"].id,
                "organization_id": api_hierarchy["org"].id,
            },
        )
    assert response.status_code == 404


async def test_only_creator_may_change_utilisation(
    db_session, api_hierarchy, test_client_factory
):
    agent = await _agent(
        db_session,
        creator=api_hierarchy["creator"],
        utilization=WorkflowUtilization.CLOSED.value,
    )

    async with test_client_factory(api_hierarchy["child"]) as client:
        denied = await client.put(
            f"{API}/workflow/{agent.id}",
            json={
                "name": agent.name,
                "workflow_definition": None,
                "utilization_type": "public",
            },
        )
    assert denied.status_code == 403

    async with test_client_factory(api_hierarchy["creator"]) as client:
        allowed = await client.put(
            f"{API}/workflow/{agent.id}",
            json={
                "name": agent.name,
                "workflow_definition": None,
                "utilization_type": "public",
            },
        )
        assert allowed.status_code == 200
        assert (await client.get(f"{API}/workflow/fetch/{agent.id}")).json()[
            "utilization_type"
        ] == "public"


async def test_invalid_utilisation_is_rejected(
    db_session, api_hierarchy, test_client_factory
):
    agent = await _agent(
        db_session,
        creator=api_hierarchy["creator"],
        utilization=WorkflowUtilization.PUBLIC.value,
    )
    async with test_client_factory(api_hierarchy["creator"]) as client:
        response = await client.put(
            f"{API}/workflow/{agent.id}",
            json={
                "name": agent.name,
                "workflow_definition": None,
                "utilization_type": "shared",
            },
        )
    assert response.status_code == 422


async def test_mutations_on_restricted_agent_are_404(
    db_session, api_hierarchy, test_client_factory
):
    agent = await _agent(
        db_session,
        creator=api_hierarchy["creator"],
        utilization=WorkflowUtilization.PRIVATE.value,
    )
    async with test_client_factory(api_hierarchy["sibling"]) as client:
        for response in (
            await client.put(
                f"{API}/workflow/{agent.id}",
                json={"name": "hijack", "workflow_definition": None},
            ),
            await client.put(
                f"{API}/workflow/{agent.id}/status", json={"status": "archived"}
            ),
            await client.post(f"{API}/workflow/{agent.id}/duplicate"),
            await client.get(f"{API}/workflow/{agent.id}/versions"),
            await client.get(f"{API}/workflow/{agent.id}/analytics"),
        ):
            assert response.status_code == 404
