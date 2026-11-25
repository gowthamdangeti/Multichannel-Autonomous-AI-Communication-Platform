from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes.campaign import router
from api.services.auth.depends import get_user


def _make_test_app() -> FastAPI:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_user] = lambda: SimpleNamespace(
        id=7,
        selected_organization_id=11,
    )
    return app


def test_campaign_analytics_returns_aggregate_metrics_for_selected_organization():
    app = _make_test_app()
    client = TestClient(app)
    analytics = {
        "total_calls": 8,
        "completed_calls": 6,
        "average_duration_seconds": 42.5,
        "state_breakdown": [
            {"state": "completed", "count": 6},
            {"state": "running", "count": 2},
        ],
        "daily": [{"date": "2026-09-11", "calls": 8, "duration": 255.0}],
    }

    with patch("api.routes.campaign.db_client") as mock_db:
        mock_db.get_campaign_run_analytics = AsyncMock(return_value=analytics)

        response = client.get("/campaign/42/analytics")

    assert response.status_code == 200
    assert response.json() == analytics
    mock_db.get_campaign_run_analytics.assert_awaited_once_with(42, 11)


def test_campaign_analytics_returns_not_found_for_other_organization():
    app = _make_test_app()
    client = TestClient(app)

    with patch("api.routes.campaign.db_client") as mock_db:
        mock_db.get_campaign_run_analytics = AsyncMock(
            side_effect=ValueError("Campaign 42 not found")
        )

        response = client.get("/campaign/42/analytics")

    assert response.status_code == 404
    assert response.json() == {"detail": "Campaign 42 not found"}
