from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes.public.agent import (
    _compute_effective_schedule,
    public_organization_router,
    public_workflow_router,
    router,
)


@pytest.fixture(autouse=True)
def _stub_agent_limit_guard(monkeypatch):
    """Agent creation is not the subject of these API-key route tests.

    The free-tier guard reaches the billing database through its own engine; in
    a full-suite run that engine already holds a connection from the async test
    loop, and reusing it from TestClient's thread loop raises "Future attached
    to a different loop". Stubbing the guard keeps these tests focused on the
    public API contract and independent of test ordering.
    """
    from api.services.billing.agent_limits import agent_limit_guard

    async def _allow(*_args, **_kwargs):
        return {"voice": 0, "chat": 0, "whatsapp": 0, "total": 0}

    monkeypatch.setattr(agent_limit_guard, "assert_can_create_agent", _allow)


def _make_test_app() -> FastAPI:
    app = FastAPI()
    app.include_router(router)
    app.include_router(public_workflow_router)
    app.include_router(public_organization_router)
    return app



def _active_workflow(
    *,
    trigger_path: str | None = None,
    trigger_type: str = "trigger",
    trigger_data: dict | None = None,
):
    nodes = []
    if trigger_path is not None:
        nodes.append(
            {
                "type": trigger_type,
                "data": {
                    "trigger_path": trigger_path,
                    "enabled": True,
                    **(trigger_data or {}),
                },
            }
        )

    return SimpleNamespace(
        id=33,
        user_id=99,
        organization_id=11,
        status="active",
        workflow_uuid="workflow-uuid-123",
        released_definition=SimpleNamespace(
            workflow_json={"nodes": nodes, "edges": []}
        ),
    )


def _provider():
    return SimpleNamespace(
        PROVIDER_NAME="twilio",
        WEBHOOK_ENDPOINT="outbound",
        validate_config=Mock(return_value=True),
        initiate_call=AsyncMock(),
    )


def test_trigger_route_executes_as_workflow_owner():
    app = _make_test_app()
    client = TestClient(app)

    workflow = _active_workflow(trigger_path="trigger-uuid-123")
    provider = _provider()
    quota_mock = AsyncMock(
        return_value=SimpleNamespace(has_quota=True, error_message="")
    )

    with (
        patch("api.routes.public.agent.db_client") as mock_db,
        patch(
            "api.routes.public.agent.authorize_workflow_run_start",
            new=quota_mock,
        ),
        patch(
            "api.routes.public.agent.get_default_telephony_provider",
            new=AsyncMock(return_value=provider),
        ),
        patch(
            "api.routes.public.agent.get_backend_endpoints",
            new=AsyncMock(return_value=("https://api.example.com", "wss://ignored")),
        ),
    ):
        mock_db.validate_api_key = AsyncMock(
            return_value=SimpleNamespace(id=7, organization_id=11, created_by=22)
        )
        mock_db.get_agent_trigger_by_path = AsyncMock(
            return_value=SimpleNamespace(
                workflow_id=workflow.id,
                organization_id=11,
                state="active",
            )
        )
        mock_db.get_workflow = AsyncMock(return_value=workflow)
        mock_db.get_default_telephony_configuration = AsyncMock(
            return_value=SimpleNamespace(id=55)
        )
        mock_db.create_workflow_run = AsyncMock(return_value=SimpleNamespace(id=501))

        response = client.post(
            "/public/agent/trigger-uuid-123",
            headers={"X-API-Key": "test-api-key"},
            json={"phone_number": "+15551234567"},
        )

    assert response.status_code == 200
    quota_mock.assert_awaited_once_with(
        workflow_id=workflow.id,
        workflow_run_id=501,
    )
    mock_db.get_workflow.assert_awaited_once_with(workflow.id, organization_id=11)

    create_kwargs = mock_db.create_workflow_run.await_args.kwargs
    assert create_kwargs["workflow_id"] == workflow.id
    assert create_kwargs["user_id"] == workflow.user_id
    assert create_kwargs["organization_id"] == workflow.organization_id
    assert create_kwargs["initial_context"]["agent_uuid"] == "trigger-uuid-123"
    assert create_kwargs["initial_context"]["agent_identifier"] == "trigger-uuid-123"
    assert create_kwargs["initial_context"]["agent_identifier_type"] == "trigger_path"
    assert create_kwargs["initial_context"]["workflow_uuid"] == workflow.workflow_uuid
    assert create_kwargs["initial_context"]["api_key_id"] == 7
    assert create_kwargs["initial_context"]["api_key_created_by"] == 22

    initiate_kwargs = provider.initiate_call.await_args.kwargs
    assert initiate_kwargs["workflow_id"] == workflow.id
    assert initiate_kwargs["user_id"] == workflow.user_id


def test_workflow_uuid_route_uses_scoped_lookup_and_shared_execution():
    app = _make_test_app()
    client = TestClient(app)

    workflow = _active_workflow()
    provider = _provider()
    quota_mock = AsyncMock(
        return_value=SimpleNamespace(has_quota=True, error_message="")
    )

    with (
        patch("api.routes.public.agent.db_client") as mock_db,
        patch(
            "api.routes.public.agent.authorize_workflow_run_start",
            new=quota_mock,
        ),
        patch(
            "api.routes.public.agent.get_default_telephony_provider",
            new=AsyncMock(return_value=provider),
        ),
        patch(
            "api.routes.public.agent.get_backend_endpoints",
            new=AsyncMock(return_value=("https://api.example.com", "wss://ignored")),
        ),
    ):
        mock_db.validate_api_key = AsyncMock(
            return_value=SimpleNamespace(id=8, organization_id=11, created_by=22)
        )
        mock_db.get_workflow_by_uuid = AsyncMock(return_value=workflow)
        mock_db.get_default_telephony_configuration = AsyncMock(
            return_value=SimpleNamespace(id=55)
        )
        mock_db.create_workflow_run = AsyncMock(return_value=SimpleNamespace(id=601))

        response = client.post(
            f"/public/agent/workflow/{workflow.workflow_uuid}",
            headers={"X-API-Key": "test-api-key"},
            json={"phone_number": "+15551234567"},
        )

    assert response.status_code == 200
    mock_db.get_workflow_by_uuid.assert_awaited_once_with(
        workflow.workflow_uuid,
        11,
    )
    assert not mock_db.get_agent_trigger_by_path.called

    create_kwargs = mock_db.create_workflow_run.await_args.kwargs
    assert create_kwargs["user_id"] == workflow.user_id
    assert (
        create_kwargs["initial_context"]["agent_identifier"] == workflow.workflow_uuid
    )
    assert create_kwargs["initial_context"]["agent_identifier_type"] == "workflow_uuid"
    assert "agent_uuid" not in create_kwargs["initial_context"]


def test_retrigger_route_schedules_without_initiating_call():
    app = _make_test_app()
    client = TestClient(app)
    workflow = _active_workflow(
        trigger_path="follow-up", trigger_type="retrigger"
    )
    scheduled_at = datetime.now(UTC) + timedelta(hours=1)

    with (
        patch("api.routes.public.agent.db_client") as mock_db,
        patch(
            "api.routes.public.agent.get_default_telephony_provider",
            new=AsyncMock(return_value=_provider()),
        ),
        patch(
            "api.routes.public.agent._enqueue_scheduled_dispatch", new=AsyncMock()
        ) as enqueue_mock,
    ):
        mock_db.validate_api_key = AsyncMock(
            return_value=SimpleNamespace(id=7, organization_id=11, created_by=22)
        )
        mock_db.get_agent_trigger_by_path = AsyncMock(
            return_value=SimpleNamespace(
                workflow_id=workflow.id, organization_id=11, state="active"
            )
        )
        mock_db.get_workflow = AsyncMock(return_value=workflow)
        mock_db.create_scheduled_call = AsyncMock(
            return_value=(
                SimpleNamespace(
                    id=81,
                    scheduled_at=scheduled_at,
                    status="pending",
                    target_workflow_id=workflow.id,
                    trigger_path="follow-up",
                    phone_number="+15551234567",
                    initial_context={"customer_id": 42},
                    telephony_configuration_id=None,
                ),
                True,
            )
        )

        response = client.post(
            "/public/agent/follow-up",
            headers={"X-API-Key": "test-api-key"},
            json={
                "phone_number": "+15551234567",
                "scheduled_at": scheduled_at.isoformat(),
                "idempotency_key": "customer-42-follow-up",
                "initial_context": {"customer_id": 42},
            },
        )

    assert response.status_code == 200
    assert response.json()["status"] == "scheduled"
    assert response.json()["scheduled_call_id"] == 81
    assert not mock_db.create_workflow_run.called
    create_kwargs = mock_db.create_scheduled_call.await_args.kwargs
    assert create_kwargs["organization_id"] == 11
    assert create_kwargs["target_workflow_id"] == workflow.id
    assert create_kwargs["initial_context"] == {"customer_id": 42}
    assert create_kwargs["max_attempts"] == 3
    enqueue_mock.assert_awaited_once()


def test_compute_retrigger_schedule_supports_delay_and_tomorrow_timezone():
    now = datetime(2026, 8, 17, 12, 0, tzinfo=UTC)

    delayed = _compute_effective_schedule(
        {
            "schedule_mode": "delay",
            "schedule_offset_seconds": 7200,
            "max_future_days": 30,
        },
        requested_at=None,
        now=now,
    )
    tomorrow_evening = _compute_effective_schedule(
        {
            "schedule_mode": "tomorrow_at",
            "schedule_time": "18:30",
            "schedule_timezone": "Asia/Kolkata",
            "max_future_days": 30,
        },
        requested_at=None,
        now=now,
    )

    assert delayed == datetime(2026, 8, 17, 14, 0, tzinfo=UTC)
    selected_date = _compute_effective_schedule(
        {
            "schedule_mode": "date_at",
            "schedule_date": "2026-08-19",
            "schedule_time": "18:30",
            "schedule_timezone": "Asia/Kolkata",
            "max_future_days": 30,
        },
        requested_at=None,
        now=now,
    )

    assert tomorrow_evening == datetime(2026, 8, 18, 13, 0, tzinfo=UTC)
    assert selected_date == datetime(2026, 8, 19, 13, 0, tzinfo=UTC)


def test_compute_retrigger_schedule_rejects_conflicting_requested_time():
    now = datetime(2026, 8, 17, 12, 0, tzinfo=UTC)

    try:
        _compute_effective_schedule(
            {"schedule_mode": "delay", "schedule_offset_seconds": 3600},
            requested_at=now + timedelta(hours=2),
            now=now,
        )
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 422
        assert "must not be provided" in str(getattr(exc, "detail", ""))
    else:
        raise AssertionError("Expected a validation error for conflicting scheduled_at")


def test_retrigger_route_uses_node_delay_retry_and_future_limit():
    app = _make_test_app()
    client = TestClient(app)
    workflow = _active_workflow(
        trigger_path="follow-up",
        trigger_type="retrigger",
        trigger_data={
            "schedule_mode": "delay",
            "schedule_offset_seconds": 1800,
            "max_attempts": 6,
            "max_future_days": 2,
        },
    )

    with (
        patch("api.routes.public.agent.db_client") as mock_db,
        patch(
            "api.routes.public.agent.get_default_telephony_provider",
            new=AsyncMock(return_value=_provider()),
        ),
        patch(
            "api.routes.public.agent._enqueue_scheduled_dispatch", new=AsyncMock()
        ),
    ):
        mock_db.validate_api_key = AsyncMock(
            return_value=SimpleNamespace(id=7, organization_id=11, created_by=22)
        )
        mock_db.get_agent_trigger_by_path = AsyncMock(
            return_value=SimpleNamespace(
                workflow_id=workflow.id, organization_id=11, state="active"
            )
        )
        mock_db.get_workflow = AsyncMock(return_value=workflow)
        mock_db.create_scheduled_call = AsyncMock(
            side_effect=lambda **kwargs: (
                SimpleNamespace(id=91, status="pending", **kwargs),
                True,
            )
        )

        response = client.post(
            "/public/agent/follow-up",
            headers={"X-API-Key": "test-api-key"},
            json={
                "phone_number": "+15551234567",
                "idempotency_key": "customer-42-delay",
            },
        )

    assert response.status_code == 200
    create_kwargs = mock_db.create_scheduled_call.await_args.kwargs
    assert create_kwargs["max_attempts"] == 6
    delay = create_kwargs["scheduled_at"] - datetime.now(UTC)
    assert timedelta(minutes=29, seconds=55) < delay < timedelta(minutes=30, seconds=5)


def test_retrigger_route_requires_future_offset_aware_time():
    app = _make_test_app()
    client = TestClient(app)
    workflow = _active_workflow(
        trigger_path="follow-up", trigger_type="retrigger"
    )

    with patch("api.routes.public.agent.db_client") as mock_db:
        mock_db.validate_api_key = AsyncMock(
            return_value=SimpleNamespace(id=7, organization_id=11, created_by=22)
        )
        mock_db.get_agent_trigger_by_path = AsyncMock(
            return_value=SimpleNamespace(
                workflow_id=workflow.id, organization_id=11, state="active"
            )
        )
        mock_db.get_workflow = AsyncMock(return_value=workflow)

        response = client.post(
            "/public/agent/follow-up",
            headers={"X-API-Key": "test-api-key"},
            json={
                "phone_number": "+15551234567",
                "scheduled_at": "2026-08-14T14:30:00",
            },
        )

    assert response.status_code == 422
    assert not mock_db.create_scheduled_call.called


def test_retrigger_route_auto_mints_idempotency_key_when_omitted():
    app = _make_test_app()
    client = TestClient(app)
    workflow = _active_workflow(
        trigger_path="follow-up", trigger_type="retrigger"
    )
    scheduled_at = datetime.now(UTC) + timedelta(hours=1)

    with (
        patch("api.routes.public.agent.db_client") as mock_db,
        patch(
            "api.routes.public.agent.get_default_telephony_provider",
            new=AsyncMock(return_value=_provider()),
        ),
        patch(
            "api.routes.public.agent._enqueue_scheduled_dispatch", new=AsyncMock()
        ) as enqueue_mock,
    ):
        mock_db.validate_api_key = AsyncMock(
            return_value=SimpleNamespace(id=7, organization_id=11, created_by=22)
        )
        mock_db.get_agent_trigger_by_path = AsyncMock(
            return_value=SimpleNamespace(
                workflow_id=workflow.id, organization_id=11, state="active"
            )
        )
        mock_db.get_workflow = AsyncMock(return_value=workflow)
        mock_db.create_scheduled_call = AsyncMock(
            return_value=(
                SimpleNamespace(
                    id=91,
                    scheduled_at=scheduled_at,
                    status="pending",
                    target_workflow_id=workflow.id,
                    trigger_path="follow-up",
                    phone_number="+15551234567",
                    initial_context=None,
                    telephony_configuration_id=None,
                ),
                True,
            )
        )

        response = client.post(
            "/public/agent/follow-up",
            headers={"X-API-Key": "test-api-key"},
            json={
                "phone_number": "+15551234567",
                "scheduled_at": scheduled_at.isoformat(),
            },
        )

    assert response.status_code == 200
    assert response.json()["status"] == "scheduled"
    create_kwargs = mock_db.create_scheduled_call.await_args.kwargs
    assert create_kwargs["idempotency_key"]
    enqueue_mock.assert_awaited_once()


def test_workflow_uuid_route_rejects_archived_workflows():
    app = _make_test_app()
    client = TestClient(app)

    workflow = _active_workflow()
    workflow.status = "archived"

    with patch("api.routes.public.agent.db_client") as mock_db:
        mock_db.validate_api_key = AsyncMock(
            return_value=SimpleNamespace(id=9, organization_id=11, created_by=22)
        )
        mock_db.get_workflow_by_uuid = AsyncMock(return_value=workflow)

        response = client.post(
            f"/public/agent/workflow/{workflow.workflow_uuid}",
            headers={"X-API-Key": "test-api-key"},
            json={"phone_number": "+15551234567"},
        )

    assert response.status_code == 404
    assert response.json()["detail"] == "Workflow is not active"
    assert not mock_db.create_workflow_run.called


def test_retrigger_route_rejects_when_no_telephony_provider():
    app = _make_test_app()
    client = TestClient(app)
    workflow = _active_workflow(
        trigger_path="follow-up", trigger_type="retrigger"
    )

    with (
        patch("api.routes.public.agent.db_client") as mock_db,
        patch(
            "api.routes.public.agent.get_default_telephony_provider",
            new=AsyncMock(side_effect=ValueError("no default provider")),
        ),
    ):
        mock_db.validate_api_key = AsyncMock(
            return_value=SimpleNamespace(id=7, organization_id=11, created_by=22)
        )
        mock_db.get_agent_trigger_by_path = AsyncMock(
            return_value=SimpleNamespace(
                workflow_id=workflow.id, organization_id=11, state="active"
            )
        )
        mock_db.get_workflow = AsyncMock(return_value=workflow)

        response = client.post(
            "/public/agent/follow-up",
            headers={"X-API-Key": "test-api-key"},
            json={
                "phone_number": "+15551234567",
                "scheduled_at": (datetime.now(UTC) + timedelta(hours=1)).isoformat(),
            },
        )

    assert response.status_code == 400
    assert response.json()["detail"] == "Telephony provider not configured for this organization"
    assert not mock_db.create_scheduled_call.called


def test_create_public_agent_success():
    app = _make_test_app()
    client = TestClient(app)
    mock_now = datetime.now(UTC)

    created_workflow = SimpleNamespace(
        id=101,
        workflow_uuid="w-uuid-101",
        name="Support Agent",
        status="active",
        created_at=mock_now,
    )

    with patch("api.routes.public.agent.db_client") as mock_db:
        mock_db.validate_api_key = AsyncMock(
            return_value=SimpleNamespace(id=7, organization_id=11, created_by=22)
        )
        mock_db.assert_trigger_paths_available = AsyncMock()
        mock_db.create_workflow = AsyncMock(return_value=created_workflow)
        mock_db.sync_triggers_for_workflow = AsyncMock()

        response = client.post(
            "/public/agent/create",
            headers={"X-API-Key": "test-api-key"},
            json={
                "name": "Support Agent",
                "system_prompt": "You are a customer service bot.",
            },
        )

    assert response.status_code == 200
    data = response.json()
    assert data["workflow_id"] == 101
    assert data["workflow_uuid"] == "w-uuid-101"
    assert data["name"] == "Support Agent"
    assert data["status"] == "active"
    assert data["trigger_path"] is not None
    assert mock_db.create_workflow.called
    assert mock_db.sync_triggers_for_workflow.called


def test_create_public_agent_invalid_api_key():
    app = _make_test_app()
    client = TestClient(app)

    with patch("api.routes.public.agent.db_client") as mock_db:
        mock_db.validate_api_key = AsyncMock(return_value=None)

        response = client.post(
            "/public/agent/create",
            headers={"X-API-Key": "invalid-key"},
            json={"name": "Support Agent"},
        )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid API key"


def test_create_public_agent_custom_definition():
    app = _make_test_app()
    client = TestClient(app)
    mock_now = datetime.now(UTC)

    created_workflow = SimpleNamespace(
        id=102,
        workflow_uuid="w-uuid-102",
        name="Custom Agent",
        status="active",
        created_at=mock_now,
    )

    custom_def = {
        "nodes": [
            {
                "id": "t-1",
                "type": "trigger",
                "data": {"trigger_path": "my-custom-trigger", "enabled": True},
            },
            {
                "id": "start-1",
                "type": "startCall",
                "data": {"name": "Start Call", "prompt": "Hello", "is_start": True},
            },
            {
                "id": "end-1",
                "type": "endCall",
                "data": {"name": "End Call", "prompt": "Bye", "is_end": True},
            },
        ],
        "edges": [
            {
                "id": "e-1",
                "source": "start-1",
                "target": "end-1",
                "data": {"label": "Hangup", "condition": "User ends call"},
            }
        ],
    }

    with patch("api.routes.public.agent.db_client") as mock_db, patch(
        "api.routes.public.agent._validate_workflow_definition",
        return_value=[],
    ):
        mock_db.validate_api_key = AsyncMock(
            return_value=SimpleNamespace(id=7, organization_id=11, created_by=22)
        )
        mock_db.assert_trigger_paths_available = AsyncMock()
        mock_db.create_workflow = AsyncMock(return_value=created_workflow)
        mock_db.sync_triggers_for_workflow = AsyncMock()

        response = client.post(
            "/public/agent/create",
            headers={"X-API-Key": "test-api-key"},
            json={
                "name": "Custom Agent",
                "workflow_definition": custom_def,
            },
        )

    assert response.status_code == 200
    data = response.json()
    assert data["workflow_id"] == 102
    assert data["trigger_path"] == "my-custom-trigger"


def test_build_default_workflow_definition_is_valid():
    from api.routes.public.agent import (
        _build_default_workflow_definition,
        _validate_workflow_definition,
    )

    wf_def = _build_default_workflow_definition("Custom system prompt")
    errors = _validate_workflow_definition(wf_def)
    assert errors == []


def test_fetch_public_agent_by_id_success():
    app = _make_test_app()
    client = TestClient(app)
    mock_now = datetime.now(UTC)

    mock_workflow = SimpleNamespace(
        id=101,
        workflow_uuid="w-uuid-101",
        name="Support Agent",
        status="active",
        created_at=mock_now,
        released_definition=SimpleNamespace(
            workflow_json={
                "nodes": [
                    {
                        "id": "t-1",
                        "type": "trigger",
                        "data": {"trigger_path": "trig-101", "enabled": True},
                    }
                ]
            },
            workflow_configurations={"model": "gpt-4o"},
            template_context_variables={"var1": "val1"},
        ),
    )

    with patch("api.routes.public.agent.db_client") as mock_db:
        mock_db.validate_api_key = AsyncMock(
            return_value=SimpleNamespace(id=7, organization_id=11, created_by=22)
        )
        mock_db.get_workflow = AsyncMock(return_value=mock_workflow)
        mock_db.get_draft_version = AsyncMock(return_value=None)

        response = client.get(
            "/public/agent/fetch/101",
            headers={"X-API-Key": "test-api-key"},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["workflow_id"] == 101
    assert data["workflow_uuid"] == "w-uuid-101"
    assert data["name"] == "Support Agent"
    assert data["trigger_path"] == "trig-101"


def test_fetch_public_agent_by_uuid_success():
    app = _make_test_app()
    client = TestClient(app)
    mock_now = datetime.now(UTC)

    mock_workflow = SimpleNamespace(
        id=102,
        workflow_uuid="w-uuid-102",
        name="Sales Agent",
        status="active",
        created_at=mock_now,
        released_definition=SimpleNamespace(
            workflow_json={"nodes": []},
            workflow_configurations=None,
            template_context_variables=None,
        ),
    )

    with patch("api.routes.public.agent.db_client") as mock_db:
        mock_db.validate_api_key = AsyncMock(
            return_value=SimpleNamespace(id=7, organization_id=11, created_by=22)
        )
        mock_db.get_workflow = AsyncMock(return_value=None)
        mock_db.get_workflow_by_uuid = AsyncMock(return_value=mock_workflow)
        mock_db.get_draft_version = AsyncMock(return_value=None)

        response = client.get(
            "/public/agent/fetch/w-uuid-102",
            headers={"X-API-Key": "test-api-key"},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["workflow_id"] == 102
    assert data["workflow_uuid"] == "w-uuid-102"
    assert data["name"] == "Sales Agent"


def test_fetch_public_agent_not_found():
    app = _make_test_app()
    client = TestClient(app)

    with patch("api.routes.public.agent.db_client") as mock_db:
        mock_db.validate_api_key = AsyncMock(
            return_value=SimpleNamespace(id=7, organization_id=11, created_by=22)
        )
        mock_db.get_workflow = AsyncMock(return_value=None)
        mock_db.get_workflow_by_uuid = AsyncMock(return_value=None)

        response = client.get(
            "/public/agent/fetch/999",
            headers={"X-API-Key": "test-api-key"},
        )

    assert response.status_code == 404
    assert response.json()["detail"] == "Agent workflow not found"


def test_list_public_agents_success():
    app = _make_test_app()
    client = TestClient(app)
    mock_now = datetime.now(UTC)

    wf_item = SimpleNamespace(id=101)
    full_wf = SimpleNamespace(
        id=101,
        workflow_uuid="w-uuid-101",
        name="Support Agent",
        status="active",
        created_at=mock_now,
        released_definition=SimpleNamespace(
            workflow_json={"nodes": []},
            workflow_configurations=None,
            template_context_variables=None,
        ),
    )

    with patch("api.routes.public.agent.db_client") as mock_db:
        mock_db.validate_api_key = AsyncMock(
            return_value=SimpleNamespace(id=7, organization_id=11, created_by=22)
        )
        mock_db.get_all_workflows_for_listing = AsyncMock(return_value=[wf_item])
        mock_db.get_workflow = AsyncMock(return_value=full_wf)
        mock_db.get_draft_version = AsyncMock(return_value=None)

        response = client.get(
            "/public/agent/fetch",
            headers={"X-API-Key": "test-api-key"},
        )

    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) == 1
    assert data[0]["workflow_id"] == 101


def test_duplicate_public_agent_success():
    app = _make_test_app()
    client = TestClient(app)
    mock_now = datetime.now(UTC)

    source_wf = SimpleNamespace(
        id=101,
        workflow_uuid="w-uuid-101",
        name="Source Agent",
        status="active",
        created_at=mock_now,
    )
    duplicated_wf = SimpleNamespace(
        id=202,
        workflow_uuid="w-uuid-202",
        name="Source Agent - Duplicate",
        status="active",
        created_at=mock_now,
        released_definition=SimpleNamespace(
            workflow_json={
                "nodes": [
                    {
                        "id": "t-1",
                        "type": "trigger",
                        "data": {"trigger_path": "new-trig-202", "enabled": True},
                    }
                ]
            },
            workflow_configurations=None,
            template_context_variables=None,
        ),
    )

    with patch("api.routes.public.agent.db_client") as mock_db, patch(
        "api.routes.public.agent.duplicate_workflow", new=AsyncMock(return_value=duplicated_wf)
    ):
        mock_db.validate_api_key = AsyncMock(
            return_value=SimpleNamespace(id=7, organization_id=11, created_by=22)
        )
        mock_db.get_workflow = AsyncMock(return_value=source_wf)
        mock_db.get_draft_version = AsyncMock(return_value=None)

        response = client.post(
            "/public/agent/duplicate/101",
            headers={"X-API-Key": "test-api-key"},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["workflow_id"] == 202
    assert data["workflow_uuid"] == "w-uuid-202"
    assert data["name"] == "Source Agent - Duplicate"
    assert data["trigger_path"] == "new-trig-202"


def test_duplicate_public_agent_custom_name():
    app = _make_test_app()
    client = TestClient(app)
    mock_now = datetime.now(UTC)

    source_wf = SimpleNamespace(
        id=101,
        workflow_uuid="w-uuid-101",
        name="Source Agent",
        status="active",
        created_at=mock_now,
    )
    duplicated_wf = SimpleNamespace(
        id=203,
        workflow_uuid="w-uuid-203",
        name="Cloned Agent",
        status="active",
        created_at=mock_now,
        released_definition=SimpleNamespace(
            workflow_json={"nodes": []},
            workflow_configurations=None,
            template_context_variables=None,
        ),
    )

    with patch("api.routes.public.agent.db_client") as mock_db, patch(
        "api.routes.public.agent.duplicate_workflow", new=AsyncMock(return_value=duplicated_wf)
    ):
        mock_db.validate_api_key = AsyncMock(
            return_value=SimpleNamespace(id=7, organization_id=11, created_by=22)
        )
        mock_db.get_workflow = AsyncMock(return_value=source_wf)
        mock_db.update_workflow = AsyncMock(return_value=duplicated_wf)
        mock_db.get_draft_version = AsyncMock(return_value=None)

        response = client.post(
            "/public/agent/duplicate",
            headers={"X-API-Key": "test-api-key"},
            json={"workflow_id": 101, "name": "Cloned Agent"},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["workflow_id"] == 203
    assert data["name"] == "Cloned Agent"


def test_duplicate_public_agent_not_found():
    app = _make_test_app()
    client = TestClient(app)

    with patch("api.routes.public.agent.db_client") as mock_db:
        mock_db.validate_api_key = AsyncMock(
            return_value=SimpleNamespace(id=7, organization_id=11, created_by=22)
        )
        mock_db.get_workflow = AsyncMock(return_value=None)
        mock_db.get_workflow_by_uuid = AsyncMock(return_value=None)

        response = client.post(
            "/public/agent/duplicate/999",
            headers={"X-API-Key": "test-api-key"},
        )

    assert response.status_code == 404
    assert response.json()["detail"] == "Source agent workflow not found"


def test_get_public_agent_count_success():
    app = _make_test_app()
    client = TestClient(app)

    with patch("api.routes.public.agent.db_client") as mock_db:
        mock_db.validate_api_key = AsyncMock(
            return_value=SimpleNamespace(id=7, organization_id=11, created_by=22)
        )
        mock_db.get_workflow_counts = AsyncMock(
            return_value={"total": 5, "active": 4, "archived": 1}
        )

        response = client.get(
            "/public/agent/count",
            headers={"X-API-Key": "test-api-key"},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 5
    assert data["active"] == 4
    assert data["archived"] == 1


def test_update_public_agent_success():
    app = _make_test_app()
    client = TestClient(app)
    mock_now = datetime.now(UTC)

    existing_wf = SimpleNamespace(
        id=101,
        workflow_uuid="w-uuid-101",
        name="Original Name",
        status="active",
        created_at=mock_now,
        released_definition=SimpleNamespace(workflow_json={"nodes": []}),
    )
    updated_wf = SimpleNamespace(
        id=101,
        workflow_uuid="w-uuid-101",
        name="Updated Name",
        status="active",
        created_at=mock_now,
        released_definition=SimpleNamespace(
            workflow_json={"nodes": []},
            workflow_configurations=None,
            template_context_variables=None,
        ),
    )

    with patch("api.routes.public.agent.db_client") as mock_db:
        mock_db.validate_api_key = AsyncMock(
            return_value=SimpleNamespace(id=7, organization_id=11, created_by=22)
        )
        mock_db.get_workflow = AsyncMock(return_value=existing_wf)
        mock_db.assert_trigger_paths_available = AsyncMock()
        mock_db.update_workflow = AsyncMock(return_value=updated_wf)
        mock_db.get_draft_version = AsyncMock(return_value=None)

        response = client.put(
            "/public/agent/101",
            headers={"X-API-Key": "test-api-key"},
            json={"name": "Updated Name"},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Updated Name"


def test_delete_public_agent_success():
    app = _make_test_app()
    client = TestClient(app)
    mock_now = datetime.now(UTC)

    existing_wf = SimpleNamespace(
        id=101,
        workflow_uuid="w-uuid-101",
        name="Agent to Delete",
        status="active",
        created_at=mock_now,
    )
    archived_wf = SimpleNamespace(
        id=101,
        workflow_uuid="w-uuid-101",
        name="Agent to Delete",
        status="archived",
        created_at=mock_now,
        released_definition=SimpleNamespace(
            workflow_json={"nodes": []},
            workflow_configurations=None,
            template_context_variables=None,
        ),
        template_context_variables=None,
        workflow_configurations=None,
    )

    with patch("api.routes.public.agent.db_client") as mock_db:
        mock_db.validate_api_key = AsyncMock(
            return_value=SimpleNamespace(id=7, organization_id=11, created_by=22)
        )
        mock_db.get_workflow = AsyncMock(return_value=existing_wf)
        mock_db.update_workflow_status = AsyncMock(return_value=archived_wf)
        mock_db.get_draft_version = AsyncMock(return_value=None)

        response = client.delete(
            "/public/agent/101",
            headers={"X-API-Key": "test-api-key"},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "archived"


def test_publish_public_agent_success():
    app = _make_test_app()
    client = TestClient(app)
    mock_now = datetime.now(UTC)

    existing_wf = SimpleNamespace(
        id=101,
        workflow_uuid="w-uuid-101",
        name="Agent to Publish",
        status="active",
        created_at=mock_now,
    )
    draft_version = SimpleNamespace(
        workflow_json={
            "nodes": [
                {"id": "t-1", "type": "trigger", "data": {"trigger_path": "trig-101"}},
                {"id": "s-1", "type": "startCall", "data": {"name": "Start", "prompt": "Hi", "is_start": True}},
                {"id": "e-1", "type": "endCall", "data": {"name": "End", "prompt": "Bye", "is_end": True}},
            ],
            "edges": [
                {"id": "e1", "source": "s-1", "target": "e-1", "data": {"label": "Hangup", "condition": "End"}}
            ]
        }
    )
    published_wf = SimpleNamespace(
        id=101,
        workflow_uuid="w-uuid-101",
        name="Agent to Publish",
        status="active",
        created_at=mock_now,
        released_definition=SimpleNamespace(
            workflow_json=draft_version.workflow_json,
            workflow_configurations=None,
            template_context_variables=None,
        ),
    )

    with patch("api.routes.public.agent.db_client") as mock_db, patch(
        "api.routes.public.agent._validate_workflow_definition", return_value=[]
    ):
        mock_db.validate_api_key = AsyncMock(
            return_value=SimpleNamespace(id=7, organization_id=11, created_by=22)
        )
        mock_db.get_workflow = AsyncMock(side_effect=[existing_wf, published_wf])
        mock_db.get_draft_version = AsyncMock(return_value=draft_version)
        mock_db.publish_workflow_draft = AsyncMock()

        response = client.post(
            "/public/agent/101/publish",
            headers={"X-API-Key": "test-api-key"},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["workflow_id"] == 101


def test_validate_public_agent_success():
    app = _make_test_app()
    client = TestClient(app)

    valid_def = {
        "nodes": [
            {"id": "t-1", "type": "trigger", "data": {"trigger_path": "t1"}},
            {"id": "s-1", "type": "startCall", "data": {"name": "Start", "prompt": "Hello", "is_start": True}},
            {"id": "e-1", "type": "endCall", "data": {"name": "End", "prompt": "Goodbye", "is_end": True}},
        ],
        "edges": [
            {"id": "e1", "source": "s-1", "target": "e-1", "data": {"label": "Hangup", "condition": "End"}}
        ]
    }

    with patch("api.routes.public.agent.db_client") as mock_db, patch(
        "api.routes.public.agent._validate_workflow_definition", return_value=[]
    ):
        mock_db.validate_api_key = AsyncMock(
            return_value=SimpleNamespace(id=7, organization_id=11, created_by=22)
        )

        response = client.post(
            "/public/agent/validate",
            headers={"X-API-Key": "test-api-key"},
            json=valid_def,
        )

    assert response.status_code == 200
    data = response.json()
    assert data["is_valid"] is True
    assert data["errors"] == []


def test_get_public_agents_summary_success():
    app = _make_test_app()
    client = TestClient(app)

    summary_item = SimpleNamespace(id=101, workflow_uuid="w-101", name="Bot", status="active")

    with patch("api.routes.public.agent.db_client") as mock_db:
        mock_db.validate_api_key = AsyncMock(
            return_value=SimpleNamespace(id=7, organization_id=11, created_by=22)
        )
        mock_db.get_all_workflows = AsyncMock(return_value=[summary_item])

        response = client.get(
            "/public/agent/summary",
            headers={"X-API-Key": "test-api-key"},
        )

    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["id"] == 101
    assert data[0]["name"] == "Bot"


def test_get_public_agent_versions_success():
    app = _make_test_app()
    client = TestClient(app)
    mock_now = datetime.now(UTC)

    wf = SimpleNamespace(id=101)
    version_item = SimpleNamespace(
        id=1,
        version_number=1,
        status="published",
        created_at=mock_now,
        published_at=mock_now,
        workflow_json={"nodes": []},
        workflow_configurations=None,
        template_context_variables=None,
    )

    with patch("api.routes.public.agent.db_client") as mock_db:
        mock_db.validate_api_key = AsyncMock(
            return_value=SimpleNamespace(id=7, organization_id=11, created_by=22)
        )
        mock_db.get_workflow = AsyncMock(return_value=wf)
        mock_db.get_workflow_versions = AsyncMock(return_value=[version_item])

        response = client.get(
            "/public/agent/101/versions",
            headers={"X-API-Key": "test-api-key"},
        )

    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["version_number"] == 1


def test_create_public_agent_draft_success():
    app = _make_test_app()
    client = TestClient(app)
    mock_now = datetime.now(UTC)

    wf = SimpleNamespace(id=101)
    draft_item = SimpleNamespace(
        id=2,
        version_number=2,
        status="draft",
        created_at=mock_now,
        published_at=None,
        workflow_json={"nodes": []},
        workflow_configurations=None,
        template_context_variables=None,
    )

    with patch("api.routes.public.agent.db_client") as mock_db:
        mock_db.validate_api_key = AsyncMock(
            return_value=SimpleNamespace(id=7, organization_id=11, created_by=22)
        )
        mock_db.get_workflow = AsyncMock(return_value=wf)
        mock_db.save_workflow_draft = AsyncMock(return_value=draft_item)

        response = client.post(
            "/public/agent/101/create-draft",
            headers={"X-API-Key": "test-api-key"},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["version_number"] == 2
    assert data["status"] == "draft"


def test_get_public_agent_runs_success():
    app = _make_test_app()
    client = TestClient(app)
    mock_now = datetime.now(UTC)

    wf = SimpleNamespace(id=101)
    run_item = SimpleNamespace(
        id=501,
        workflow_id=101,
        name="WR-API-1234",
        mode="twilio",
        created_at=mock_now,
        initial_context={"phone_number": "+15551234567"},
    )

    with patch("api.routes.public.agent.db_client") as mock_db:
        mock_db.validate_api_key = AsyncMock(
            return_value=SimpleNamespace(id=7, organization_id=11, created_by=22)
        )
        mock_db.get_workflow = AsyncMock(return_value=wf)
        mock_db.get_workflow_runs_by_workflow_id = AsyncMock(return_value=[run_item])

        response = client.get(
            "/public/agent/101/runs",
            headers={"X-API-Key": "test-api-key"},
        )

    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["id"] == 501
    assert data[0]["name"] == "WR-API-1234"


def test_get_public_agent_run_details_success():
    app = _make_test_app()
    client = TestClient(app)
    mock_now = datetime.now(UTC)

    run_item = SimpleNamespace(
        id=501,
        workflow_id=101,
        name="WR-API-1234",
        mode="twilio",
        organization_id=11,
        created_at=mock_now,
        initial_context={"phone_number": "+15551234567"},
    )

    with patch("api.routes.public.agent.db_client") as mock_db:
        mock_db.validate_api_key = AsyncMock(
            return_value=SimpleNamespace(id=7, organization_id=11, created_by=22)
        )
        mock_db.get_workflow_run_by_id = AsyncMock(return_value=run_item)

        response = client.get(
            "/public/agent/runs/501",
            headers={"X-API-Key": "test-api-key"},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["id"] == 501
    assert data["workflow_id"] == 101


def test_list_public_agents_alias_success():
    app = _make_test_app()
    client = TestClient(app)
    mock_now = datetime.now(UTC)

    wf_item = SimpleNamespace(
        id=101,
        workflow_uuid="w-uuid-101",
        name="Test Agent",
        status="active",
        created_at=mock_now,
        released_definition=None,
    )

    with patch("api.routes.public.agent.db_client") as mock_db:
        mock_db.validate_api_key = AsyncMock(
            return_value=SimpleNamespace(id=7, organization_id=11, created_by=22)
        )
        mock_db.get_all_workflows_for_listing = AsyncMock(return_value=[wf_item])
        mock_db.get_workflow = AsyncMock(return_value=wf_item)
        mock_db.get_draft_version = AsyncMock(return_value=None)

        response = client.get(
            "/public/agent/list",
            headers={"X-API-Key": "test-api-key"},
        )

    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["workflow_id"] == 101


def test_fetch_public_agent_direct_get_success():
    app = _make_test_app()
    client = TestClient(app)
    mock_now = datetime.now(UTC)

    wf_item = SimpleNamespace(
        id=101,
        workflow_uuid="w-uuid-101",
        name="Direct Get Agent",
        status="active",
        created_at=mock_now,
        released_definition=None,
    )

    with patch("api.routes.public.agent.db_client") as mock_db:
        mock_db.validate_api_key = AsyncMock(
            return_value=SimpleNamespace(id=7, organization_id=11, created_by=22)
        )
        mock_db.get_workflow = AsyncMock(return_value=wf_item)
        mock_db.get_draft_version = AsyncMock(return_value=None)

        response = client.get(
            "/public/agent/101",
            headers={"X-API-Key": "test-api-key"},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["workflow_id"] == 101
    assert data["name"] == "Direct Get Agent"


def test_update_public_agent_folder_success():
    app = _make_test_app()
    client = TestClient(app)

    wf_item = SimpleNamespace(
        id=101,
        workflow_uuid="w-uuid-101",
        folder_id=5,
        name="Test Agent",
        status="active",
    )

    with patch("api.routes.public.agent.db_client") as mock_db:
        mock_db.validate_api_key = AsyncMock(
            return_value=SimpleNamespace(id=7, organization_id=11, created_by=22)
        )
        mock_db.get_workflow = AsyncMock(return_value=wf_item)
        mock_db.update_workflow = AsyncMock(return_value=wf_item)

        response = client.put(
            "/public/agent/101/folder",
            json={"folder_id": 5},
            headers={"X-API-Key": "test-api-key"},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["workflow_id"] == 101
    assert data["folder_id"] == 5


def test_get_public_agent_templates_success():
    app = _make_test_app()
    client = TestClient(app)
    mock_now = datetime.now(UTC)

    tmpl = SimpleNamespace(
        id=1,
        template_name="Support Agent",
        template_description="Customer support template",
        template_json={"nodes": []},
        created_at=mock_now,
    )

    with (
        patch("api.routes.public.agent.db_client") as mock_db,
        patch("api.db.workflow_template_client.WorkflowTemplateClient") as mock_tmpl_cls,
    ):
        mock_db.validate_api_key = AsyncMock(
            return_value=SimpleNamespace(id=7, organization_id=11, created_by=22)
        )
        mock_tmpl_inst = Mock()
        mock_tmpl_inst.get_all_workflow_templates = AsyncMock(return_value=[tmpl])
        mock_tmpl_cls.return_value = mock_tmpl_inst

        response = client.get(
            "/public/agent/templates",
            headers={"X-API-Key": "test-api-key"},
        )

    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["template_name"] == "Support Agent"


def test_duplicate_public_agent_template_success():
    app = _make_test_app()
    client = TestClient(app)
    mock_now = datetime.now(UTC)

    tmpl = SimpleNamespace(
        id=1,
        template_name="Sales Assistant",
        template_json={"nodes": []},
    )
    new_wf = SimpleNamespace(
        id=202,
        workflow_uuid="w-uuid-202",
        name="Sales Assistant",
        status="active",
        created_at=mock_now,
        released_definition=None,
    )

    with (
        patch("api.routes.public.agent.db_client") as mock_db,
        patch("api.db.workflow_template_client.WorkflowTemplateClient") as mock_tmpl_cls,
    ):
        mock_db.validate_api_key = AsyncMock(
            return_value=SimpleNamespace(id=7, organization_id=11, created_by=22)
        )
        mock_tmpl_inst = Mock()
        mock_tmpl_inst.get_workflow_template = AsyncMock(return_value=tmpl)
        mock_tmpl_cls.return_value = mock_tmpl_inst

        mock_db.assert_trigger_paths_available = AsyncMock()
        mock_db.create_workflow = AsyncMock(return_value=new_wf)

        response = client.post(
            "/public/agent/templates/1/duplicate",
            headers={"X-API-Key": "test-api-key"},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["workflow_id"] == 202
    assert data["name"] == "Sales Assistant"


def test_create_public_agent_text_chat_session_success():
    app = _make_test_app()
    client = TestClient(app)
    mock_now = datetime.now(UTC)

    workflow = _active_workflow()
    workflow_run = SimpleNamespace(
        id=701,
        workflow_id=workflow.id,
        name="TextChat-1234",
        mode="textchat",
        state="initialized",
        is_completed=False,
        initial_context={"provider": "text-chat"},
        gathered_context=None,
        annotations=None,
    )
    text_session = SimpleNamespace(
        revision=1,
        workflow_run=workflow_run,
        session_data={"turns": [], "status": "pending_assistant_turn"},
        checkpoint={"anchor_turn_id": None},
        created_at=mock_now,
        updated_at=mock_now,
    )

    quota_mock = AsyncMock(
        return_value=SimpleNamespace(has_quota=True, error_message="")
    )

    with (
        patch("api.routes.public.agent.db_client") as mock_db,
        patch(
            "api.routes.public.agent.authorize_workflow_run_start",
            new=quota_mock,
        ),
        patch(
            "api.routes.public.agent.initialize_text_chat_session",
            new=AsyncMock(return_value=text_session),
        ) as mock_init,
        patch(
            "api.routes.public.agent.execute_pending_text_chat_turn",
            new=AsyncMock(return_value=text_session),
        ) as mock_exec,
    ):
        mock_db.validate_api_key = AsyncMock(
            return_value=SimpleNamespace(id=7, organization_id=11, created_by=22)
        )
        mock_db.get_workflow = AsyncMock(return_value=workflow)
        mock_db.create_workflow_run = AsyncMock(return_value=workflow_run)
        mock_db.ensure_workflow_run_text_session = AsyncMock(return_value=text_session)

        response = client.post(
            f"/public/agent/{workflow.id}/text-chat/sessions",
            headers={"X-API-Key": "test-api-key"},
            json={"name": "TextChat-1234"},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["workflow_run_id"] == 701
    assert data["workflow_id"] == workflow.id
    assert data["mode"] == "textchat"
    assert mock_init.called
    assert mock_exec.called
    mock_db.create_workflow_run.assert_awaited_once()
    create_kwargs = mock_db.create_workflow_run.await_args.kwargs
    assert create_kwargs["mode"] == "textchat"


def test_get_public_agent_text_chat_session_success():
    app = _make_test_app()
    client = TestClient(app)
    mock_now = datetime.now(UTC)

    workflow = _active_workflow()
    workflow_run = SimpleNamespace(
        id=701,
        workflow_id=workflow.id,
        name="TextChat-1234",
        mode="textchat",
        state="initialized",
        is_completed=False,
        initial_context={"provider": "text-chat"},
        gathered_context=None,
        annotations=None,
        organization_id=11,
    )
    text_session = SimpleNamespace(
        revision=1,
        workflow_run=workflow_run,
        session_data={"turns": [], "status": "idle"},
        checkpoint={"anchor_turn_id": None},
        created_at=mock_now,
        updated_at=mock_now,
    )

    with patch("api.routes.public.agent.db_client") as mock_db:
        mock_db.validate_api_key = AsyncMock(
            return_value=SimpleNamespace(id=7, organization_id=11, created_by=22)
        )
        mock_db.get_workflow = AsyncMock(return_value=workflow)
        mock_db.get_workflow_run_text_session = AsyncMock(return_value=text_session)

        response = client.get(
            f"/public/agent/{workflow.id}/text-chat/sessions/701",
            headers={"X-API-Key": "test-api-key"},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["workflow_run_id"] == 701
    assert data["workflow_id"] == workflow.id
    assert data["revision"] == 1


def test_append_public_agent_text_chat_message_success():
    app = _make_test_app()
    client = TestClient(app)
    mock_now = datetime.now(UTC)

    workflow = _active_workflow()
    workflow_run = SimpleNamespace(
        id=701,
        workflow_id=workflow.id,
        name="TextChat-1234",
        mode="textchat",
        state="initialized",
        is_completed=False,
        initial_context={"provider": "text-chat"},
        gathered_context=None,
        annotations=None,
        organization_id=11,
    )
    text_session = SimpleNamespace(
        revision=2,
        workflow_run=workflow_run,
        session_data={"turns": [], "status": "pending_assistant_turn"},
        checkpoint={"anchor_turn_id": None},
        created_at=mock_now,
        updated_at=mock_now,
    )

    quota_mock = AsyncMock(
        return_value=SimpleNamespace(has_quota=True, error_message="")
    )

    with (
        patch("api.routes.public.agent.db_client") as mock_db,
        patch(
            "api.routes.public.agent.authorize_workflow_run_start",
            new=quota_mock,
        ),
        patch(
            "api.routes.public.agent.append_text_chat_user_message",
            new=AsyncMock(return_value=text_session),
        ) as mock_append,
        patch(
            "api.routes.public.agent.execute_pending_text_chat_turn",
            new=AsyncMock(return_value=text_session),
        ) as mock_exec,
    ):
        mock_db.validate_api_key = AsyncMock(
            return_value=SimpleNamespace(id=7, organization_id=11, created_by=22)
        )
        mock_db.get_workflow = AsyncMock(return_value=workflow)
        mock_db.get_workflow_run_text_session = AsyncMock(return_value=text_session)

        response = client.post(
            f"/public/agent/{workflow.id}/text-chat/sessions/701/messages",
            headers={"X-API-Key": "test-api-key"},
            json={"text": "Hello assistant"},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["workflow_run_id"] == 701
    assert mock_append.called
    assert mock_exec.called


def test_get_public_workflow_run_detail_zero():
    app = _make_test_app()
    client = TestClient(app)
    mock_now = datetime.now(UTC)

    workflow_run = SimpleNamespace(
        id=115,
        workflow_id=42,
        name="Outbound Call",
        mode="outbound",
        is_completed=True,
        transcript_url="transcript.json",
        recording_url="audio.wav",
        extra=None,
        public_access_token="tok_123",
        cost_info=None,
        usage_info=None,
        created_at=mock_now,
        definition_id=1,
        initial_context={"caller": "+12345"},
        gathered_context=None,
        call_type="outbound",
        logs=None,
        annotations=None,
        report_s3_key=None,
        report_generation_status=None,
        organization_id=11,
    )

    with patch("api.routes.public.agent.db_client") as mock_db:
        mock_db.validate_api_key = AsyncMock(
            return_value=SimpleNamespace(id=7, organization_id=11, created_by=22)
        )
        mock_db.get_workflow_run = AsyncMock(return_value=workflow_run)

        response = client.get(
            "/public/workflow/0/runs/115",
            headers={"X-API-Key": "test-api-key"},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["id"] == 115
    assert data["workflow_id"] == 42
    assert data["name"] == "Outbound Call"
    assert data["public_access_token"] == "tok_123"


def test_get_public_organizations_usage_history():
    app = _make_test_app()
    client = TestClient(app)

    fake_run = {
        "id": 115,
        "workflow_id": 42,
        "workflow_name": "Sales Agent",
        "name": "Call 115",
        "created_at": "2026-09-17T00:00:00Z",
        "convozent_token_usage": 150.0,
        "call_duration_seconds": 60,
        "public_access_token": "token_abc",
        "extra": None,
    }

    with patch("api.routes.public.agent.db_client") as mock_db:
        mock_db.validate_api_key = AsyncMock(
            return_value=SimpleNamespace(id=7, organization_id=11, created_by=22)
        )
        mock_db.get_usage_history = AsyncMock(
            return_value=([fake_run], 1, 150.0, 60)
        )

        response = client.get(
            "/public/organizations/usage/runs?page=1&limit=8",
            headers={"X-API-Key": "test-api-key"},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["total_count"] == 1
    assert data["page"] == 1
    assert data["limit"] == 8
    assert len(data["runs"]) == 1
    assert data["runs"][0]["id"] == 115


def test_get_public_organizations_current_period_usage():
    app = _make_test_app()
    client = TestClient(app)

    usage_data = {
        "period_start": "2026-09-01T00:00:00Z",
        "period_end": "2026-09-30T23:59:59Z",
        "used_convozent_tokens": 500.0,
        "total_duration_seconds": 300,
        "used_amount_usd": 12.5,
        "currency": "USD",
        "price_per_second_usd": 0.0416,
    }

    with patch("api.routes.public.agent.db_client") as mock_db:
        mock_db.validate_api_key = AsyncMock(
            return_value=SimpleNamespace(id=7, organization_id=11, created_by=22)
        )
        mock_db.get_current_usage = AsyncMock(return_value=usage_data)

        response = client.get(
            "/public/organizations/usage/current-period",
            headers={"X-API-Key": "test-api-key"},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["used_convozent_tokens"] == 500.0
    assert data["total_duration_seconds"] == 300









