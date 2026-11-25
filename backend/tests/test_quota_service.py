from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from api.services import quota_service


def _workflow(organization_id: int = 42):
    return SimpleNamespace(id=7, organization_id=organization_id)


@pytest.mark.asyncio
async def test_authorize_workflow_run_start_missing_workflow(monkeypatch):
    monkeypatch.setattr(
        quota_service.db_client, "get_workflow_by_id", AsyncMock(return_value=None)
    )

    result = await quota_service.authorize_workflow_run_start(workflow_id=7)

    assert result.has_quota is False
    assert result.error_code == "workflow_not_found"


@pytest.mark.asyncio
async def test_authorize_workflow_run_start_rejects_actor_from_another_org(
    monkeypatch,
):
    monkeypatch.setattr(
        quota_service.db_client,
        "get_workflow_by_id",
        AsyncMock(return_value=_workflow(organization_id=42)),
    )
    actor = SimpleNamespace(selected_organization_id=99)

    result = await quota_service.authorize_workflow_run_start(
        workflow_id=7, actor_user=actor
    )

    assert result.has_quota is False
    assert result.error_code == "workflow_not_found"


@pytest.mark.asyncio
async def test_authorize_workflow_run_start_allows_matching_org(monkeypatch):
    monkeypatch.setattr(
        quota_service.db_client,
        "get_workflow_by_id",
        AsyncMock(return_value=_workflow(organization_id=42)),
    )
    actor = SimpleNamespace(selected_organization_id=42)

    result = await quota_service.authorize_workflow_run_start(
        workflow_id=7, actor_user=actor
    )

    assert result.has_quota is True


@pytest.mark.asyncio
async def test_authorize_workflow_run_start_allows_when_no_actor(monkeypatch):
    monkeypatch.setattr(
        quota_service.db_client,
        "get_workflow_by_id",
        AsyncMock(return_value=_workflow(organization_id=42)),
    )

    result = await quota_service.authorize_workflow_run_start(workflow_id=7)

    assert result.has_quota is True
