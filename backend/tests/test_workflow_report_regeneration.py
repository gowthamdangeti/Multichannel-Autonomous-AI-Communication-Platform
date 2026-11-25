from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes.workflow import router
from api.services.auth.depends import get_user


@pytest.fixture(autouse=True)
def _agent_access_allowed(monkeypatch):
    """Report regeneration is the subject here; the utilisation policy that
    gates access is covered in ``test_agent_utilisation_api.py``."""
    import api.routes.workflow as workflow_routes

    async def _allowed(*_args, **_kwargs):
        return None

    monkeypatch.setattr(workflow_routes, "_require_agent_access", _allowed)


def _make_test_app() -> FastAPI:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_user] = lambda: SimpleNamespace(
        id=1,
        provider_id="provider-1",
        selected_organization_id=11,
    )
    return app


def test_regenerate_report_queues_an_organization_scoped_run():
    app = _make_test_app()
    client = TestClient(app)
    run = SimpleNamespace(
        workflow_id=7,
        is_completed=True,
        report_generation_status="failed",
        workflow=SimpleNamespace(workflow_configurations={"report_template": "<p>Report</p>"}),
    )

    with (
        patch("api.routes.workflow.db_client.get_workflow_run", new=AsyncMock(return_value=run)) as get_run,
        patch("api.routes.workflow.db_client.update_workflow_run", new=AsyncMock()) as update_run,
        patch("api.routes.workflow.enqueue_job", new=AsyncMock()) as enqueue_job,
    ):
        response = client.post("/workflow/7/runs/42/report/regenerate")

    assert response.status_code == 202
    assert response.json() == {"status": "queued"}
    get_run.assert_awaited_once_with(42, organization_id=11)
    update_run.assert_awaited_once_with(
        run_id=42,
        report_generation_status="pending",
        clear_report_s3_key=True,
        clear_report_variables=True,
    )
    enqueue_job.assert_awaited_once_with("generate_run_report", 42)


def test_regenerate_report_rejects_a_run_from_another_workflow():
    app = _make_test_app()
    client = TestClient(app)
    run = SimpleNamespace(
        workflow_id=8,
        is_completed=True,
        report_generation_status="failed",
        workflow=SimpleNamespace(workflow_configurations={"report_template": "<p>Report</p>"}),
    )

    with patch("api.routes.workflow.db_client.get_workflow_run", new=AsyncMock(return_value=run)):
        response = client.post("/workflow/7/runs/42/report/regenerate")

    assert response.status_code == 404
    assert response.json()["detail"] == "Workflow run not found"


def test_regenerate_report_requires_a_report_template():
    app = _make_test_app()
    client = TestClient(app)
    run = SimpleNamespace(
        workflow_id=7,
        is_completed=True,
        report_generation_status="failed",
        workflow=SimpleNamespace(workflow_configurations={}),
    )

    with patch("api.routes.workflow.db_client.get_workflow_run", new=AsyncMock(return_value=run)):
        response = client.post("/workflow/7/runs/42/report/regenerate")

    assert response.status_code == 400
    assert response.json()["detail"] == "No report template configured for this workflow"


def test_regenerate_report_rejects_a_fresh_in_progress_report():
    app = _make_test_app()
    client = TestClient(app)
    run = SimpleNamespace(
        workflow_id=7,
        is_completed=True,
        report_generation_status="processing",
        report_status_updated_at=datetime.now(UTC),
        created_at=datetime.now(UTC),
        workflow=SimpleNamespace(workflow_configurations={"report_template": "<p>Report</p>"}),
    )

    with (
        patch("api.routes.workflow.db_client.get_workflow_run", new=AsyncMock(return_value=run)),
        patch("api.routes.workflow.db_client.update_workflow_run", new=AsyncMock()) as update_run,
    ):
        response = client.post("/workflow/7/runs/42/report/regenerate")

    assert response.status_code == 409
    assert response.json()["detail"] == "Report generation is already in progress"
    update_run.assert_not_awaited()


def test_regenerate_report_requeues_a_stale_in_progress_report():
    app = _make_test_app()
    client = TestClient(app)
    stale_time = datetime.now(UTC) - timedelta(hours=2)
    run = SimpleNamespace(
        workflow_id=7,
        is_completed=True,
        report_generation_status="processing",
        report_status_updated_at=stale_time,
        created_at=stale_time,
        workflow=SimpleNamespace(workflow_configurations={"report_template": "<p>Report</p>"}),
    )

    with (
        patch("api.routes.workflow.db_client.get_workflow_run", new=AsyncMock(return_value=run)),
        patch("api.routes.workflow.db_client.update_workflow_run", new=AsyncMock()) as update_run,
        patch("api.routes.workflow.enqueue_job", new=AsyncMock()) as enqueue_job,
    ):
        response = client.post("/workflow/7/runs/42/report/regenerate")

    assert response.status_code == 202
    assert response.json() == {"status": "queued"}
    update_run.assert_awaited_once_with(
        run_id=42,
        report_generation_status="pending",
        clear_report_s3_key=True,
        clear_report_variables=True,
    )
    enqueue_job.assert_awaited_once_with("generate_run_report", 42)


def test_regenerate_report_requeues_when_status_timestamps_are_missing():
    app = _make_test_app()
    client = TestClient(app)
    run = SimpleNamespace(
        workflow_id=7,
        is_completed=True,
        report_generation_status="processing",
        workflow=SimpleNamespace(workflow_configurations={"report_template": "<p>Report</p>"}),
    )

    with (
        patch("api.routes.workflow.db_client.get_workflow_run", new=AsyncMock(return_value=run)),
        patch("api.routes.workflow.db_client.update_workflow_run", new=AsyncMock()),
        patch("api.routes.workflow.enqueue_job", new=AsyncMock()) as enqueue_job,
    ):
        response = client.post("/workflow/7/runs/42/report/regenerate")

    assert response.status_code == 202
    enqueue_job.assert_awaited_once_with("generate_run_report", 42)
