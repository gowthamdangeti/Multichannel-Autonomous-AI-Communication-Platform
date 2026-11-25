from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes.campaign import router
from api.services.auth.depends import get_user
from api.tasks.campaign_tasks import process_campaign_batch, sync_campaign_source


def _make_test_app() -> FastAPI:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_user] = lambda: SimpleNamespace(
        id=7,
        selected_organization_id=11,
    )
    return app


def test_delete_campaign_is_organization_scoped_and_returns_no_content():
    app = _make_test_app()
    client = TestClient(app)

    with patch("api.routes.campaign.db_client") as mock_db:
        mock_db.delete_campaign = AsyncMock(return_value=True)

        response = client.delete("/campaign/42")

    assert response.status_code == 204
    assert response.content == b""
    mock_db.delete_campaign.assert_awaited_once_with(42, 11)


def test_delete_campaign_returns_not_found_for_other_organization():
    app = _make_test_app()
    client = TestClient(app)

    with patch("api.routes.campaign.db_client") as mock_db:
        mock_db.delete_campaign = AsyncMock(return_value=False)

        response = client.delete("/campaign/42")

    assert response.status_code == 404
    assert response.json() == {"detail": "Campaign not found"}


@pytest.mark.asyncio
async def test_deleted_campaign_sync_job_does_not_queue_calls():
    with patch("api.tasks.campaign_tasks.db_client") as mock_db:
        mock_db.get_campaign_by_id = AsyncMock(return_value=None)

        await sync_campaign_source({}, campaign_id=42)

    mock_db.sync_call_targets_to_queue.assert_not_called()
    mock_db.update_campaign.assert_not_called()


@pytest.mark.asyncio
async def test_deleted_campaign_batch_job_does_not_dispatch_calls():
    with (
        patch("api.tasks.campaign_tasks.db_client") as mock_db,
        patch("api.tasks.campaign_tasks.campaign_call_dispatcher") as mock_dispatcher,
    ):
        mock_db.get_campaign_by_id = AsyncMock(return_value=None)

        await process_campaign_batch({}, campaign_id=42)

    mock_dispatcher.process_batch.assert_not_called()
    mock_db.update_campaign.assert_not_called()
