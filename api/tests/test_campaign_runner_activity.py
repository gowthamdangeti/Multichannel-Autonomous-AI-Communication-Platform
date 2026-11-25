"""Pause and resume are written to the campaign's activity log (the UI timeline)."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from api.services.campaign import runner


@pytest.fixture
def mock_db():
    with patch.object(runner, "db_client") as db:
        db.update_campaign = AsyncMock()
        db.append_campaign_log = AsyncMock()
        yield db


async def test_pause_logs_activity(mock_db):
    mock_db.get_campaign_by_id = AsyncMock(
        return_value=SimpleNamespace(state="running")
    )

    await runner.campaign_runner_service.pause_campaign(5)

    mock_db.update_campaign.assert_awaited_once_with(campaign_id=5, state="paused")
    log = mock_db.append_campaign_log.await_args.kwargs
    assert log == {
        "campaign_id": 5,
        "level": "info",
        "event": "campaign_paused",
        "message": "Campaign paused",
    }


async def test_resume_logs_activity(mock_db):
    mock_db.get_campaign_by_id = AsyncMock(return_value=SimpleNamespace(state="paused"))

    with patch.object(runner, "circuit_breaker") as breaker:
        breaker.reset = AsyncMock()
        await runner.campaign_runner_service.resume_campaign(5)

    mock_db.update_campaign.assert_awaited_once_with(campaign_id=5, state="running")
    assert mock_db.append_campaign_log.await_args.kwargs["event"] == "campaign_resumed"


async def test_rejected_pause_writes_nothing(mock_db):
    mock_db.get_campaign_by_id = AsyncMock(
        return_value=SimpleNamespace(state="completed")
    )

    with pytest.raises(ValueError):
        await runner.campaign_runner_service.pause_campaign(5)

    mock_db.append_campaign_log.assert_not_awaited()
