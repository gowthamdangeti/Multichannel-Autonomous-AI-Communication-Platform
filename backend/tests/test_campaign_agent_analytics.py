"""Campaign view reuses the agent analytics, narrowed to the campaign's runs."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes.workflow import router
from api.services.auth.depends import get_user
from api.services.reports import agent_analytics

ORG_ID = 11


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_user] = lambda: SimpleNamespace(
        id=7, selected_organization_id=ORG_ID
    )
    return TestClient(app)


def _empty_analytics():
    return agent_analytics.aggregate_agent_analytics(
        [], 30, agent_analytics.datetime.now(agent_analytics.UTC)
    )


def test_campaign_filter_reaches_the_rollup():
    with (
        patch("api.routes.workflow.db_client") as mock_db,
        patch(
            "api.routes.workflow.get_agent_analytics",
            new=AsyncMock(return_value=_empty_analytics()),
        ) as rollup,
    ):
        mock_db.get_workflow = AsyncMock(return_value=SimpleNamespace(id=5))
        mock_db.get_campaign = AsyncMock(
            return_value=SimpleNamespace(id=42, workflow_id=5)
        )

        response = _client().get("/workflow/5/analytics?days=30&campaign_id=42")

    assert response.status_code == 200
    mock_db.get_campaign.assert_awaited_once_with(42, ORG_ID)
    assert rollup.await_args.kwargs["campaign_id"] == 42
    assert rollup.await_args.kwargs["organization_id"] == ORG_ID


@pytest.mark.parametrize(
    "campaign",
    [None, SimpleNamespace(id=42, workflow_id=99)],
    ids=["other organization", "other agent"],
)
def test_campaign_of_another_org_or_agent_is_not_found(campaign):
    with (
        patch("api.routes.workflow.db_client") as mock_db,
        patch("api.routes.workflow.get_agent_analytics", new=AsyncMock()) as rollup,
    ):
        mock_db.get_workflow = AsyncMock(return_value=SimpleNamespace(id=5))
        mock_db.get_campaign = AsyncMock(return_value=campaign)

        response = _client().get("/workflow/5/analytics?campaign_id=42")

    assert response.status_code == 404
    rollup.assert_not_awaited()


def test_without_campaign_the_agent_rollup_is_unchanged():
    with (
        patch("api.routes.workflow.db_client") as mock_db,
        patch(
            "api.routes.workflow.get_agent_analytics",
            new=AsyncMock(return_value=_empty_analytics()),
        ) as rollup,
    ):
        mock_db.get_workflow = AsyncMock(return_value=SimpleNamespace(id=5))
        mock_db.get_campaign = AsyncMock()

        response = _client().get("/workflow/5/analytics")

    assert response.status_code == 200
    mock_db.get_campaign.assert_not_awaited()
    assert rollup.await_args.kwargs["campaign_id"] is None


async def test_service_passes_campaign_to_the_run_query():
    with patch.object(agent_analytics, "db_client") as mock_db:
        mock_db.get_workflow_runs_for_analytics = AsyncMock(return_value=[])
        await agent_analytics.get_agent_analytics(
            workflow_id=5, organization_id=ORG_ID, days=30, campaign_id=42
        )

    assert (
        mock_db.get_workflow_runs_for_analytics.await_args.kwargs["campaign_id"] == 42
    )
