from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.db import db_client
from api.routes.public.whatsapp import router as public_whatsapp_router


def _make_test_app() -> FastAPI:
    app = FastAPI()
    app.include_router(public_whatsapp_router)
    return app


def test_public_whatsapp_routes_authentication():
    app = _make_test_app()
    client = TestClient(app)

    with patch.object(db_client, "validate_api_key", new_callable=AsyncMock) as mock_val:
        mock_val.return_value = None

        resp = client.get("/public/whatsapp/numbers", headers={"X-API-Key": "invalid"})
        assert resp.status_code == 401
        assert resp.json()["detail"] == "Invalid API key"


def test_public_whatsapp_numbers_crud():
    app = _make_test_app()
    client = TestClient(app)

    mock_api_key = SimpleNamespace(id=1, organization_id=10)
    mock_number = SimpleNamespace(
        id=5,
        name="Sales WhatsApp",
        phone_number="+15550199",
        status="connected",
        openwa_session_name="wa_org_10_5",
        assigned_agent_id=None,
        created_at="2026-10-05T00:00:00",
        updated_at="2026-10-05T00:00:00",
        organization_id=10,
    )

    with patch.object(db_client, "validate_api_key", new_callable=AsyncMock) as mock_val, \
         patch.object(db_client, "list_whatsapp_numbers", new_callable=AsyncMock) as mock_list, \
         patch.object(db_client, "get_whatsapp_number", new_callable=AsyncMock) as mock_get, \
         patch("api.routes.public.whatsapp.create_connection", new_callable=AsyncMock) as mock_create, \
         patch("api.routes.public.whatsapp.refresh_status", new_callable=AsyncMock) as mock_refresh, \
         patch("api.routes.public.whatsapp.delete_connection", new_callable=AsyncMock) as mock_del, \
         patch.object(db_client, "update_whatsapp_number", new_callable=AsyncMock) as mock_update:

        mock_val.return_value = mock_api_key
        mock_list.return_value = [mock_number]
        mock_get.return_value = mock_number
        mock_create.return_value = mock_number
        mock_refresh.return_value = mock_number
        mock_del.return_value = None
        mock_update.return_value = mock_number

        headers = {"X-API-Key": "test-key"}

        # 1. List numbers
        resp = client.get("/public/whatsapp/numbers", headers=headers)
        assert resp.status_code == 200
        assert len(resp.json()["numbers"]) == 1
        assert resp.json()["numbers"][0]["name"] == "Sales WhatsApp"

        # 2. Get number detail
        resp = client.get("/public/whatsapp/numbers/5", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["id"] == 5

        # 3. Create number
        resp = client.post("/public/whatsapp/numbers", headers=headers, json={"name": "Sales WhatsApp"})
        assert resp.status_code == 200
        assert resp.json()["id"] == 5

        # 4. Attach agent
        resp = client.patch("/public/whatsapp/numbers/5/agent", headers=headers, json={"agent_id": None})
        assert resp.status_code == 200

        # 5. Delete number
        resp = client.delete("/public/whatsapp/numbers/5", headers=headers)
        assert resp.status_code == 200
        assert resp.json() == {"message": "WhatsApp number deleted"}


def test_public_whatsapp_agents_crud():
    app = _make_test_app()
    client = TestClient(app)

    mock_api_key = SimpleNamespace(id=1, organization_id=10)
    mock_agent = SimpleNamespace(
        id=12,
        name="Support Bot",
        description="Handles customer support",
        character="support",
        system_prompt="You are a helpful assistant.",
        greeting="Hello!",
        model_config_ref={},
        active_contacts=[],
        deactive_contacts=[],
        is_active=True,
        created_at="2026-10-05T00:00:00",
        updated_at="2026-10-05T00:00:00",
        organization_id=10,
    )

    with patch.object(db_client, "validate_api_key", new_callable=AsyncMock) as mock_val, \
         patch.object(db_client, "list_whatsapp_agents", new_callable=AsyncMock) as mock_list, \
         patch.object(db_client, "get_whatsapp_agent", new_callable=AsyncMock) as mock_get, \
         patch.object(db_client, "create_whatsapp_agent", new_callable=AsyncMock) as mock_create, \
         patch.object(db_client, "update_whatsapp_agent", new_callable=AsyncMock) as mock_update, \
         patch.object(db_client, "delete_whatsapp_agent", new_callable=AsyncMock) as mock_del, \
         patch.object(db_client, "get_whatsapp_agent_run_counts", new_callable=AsyncMock) as mock_runs:

        mock_val.return_value = mock_api_key
        mock_list.return_value = [mock_agent]
        mock_get.return_value = mock_agent
        mock_create.return_value = mock_agent
        mock_update.return_value = mock_agent
        mock_del.return_value = True
        mock_runs.return_value = {12: 5}

        headers = {"X-API-Key": "test-key"}

        # 1. List characters
        resp = client.get("/public/whatsapp/characters", headers=headers)
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

        # 2. List agents
        resp = client.get("/public/whatsapp/agents", headers=headers)
        assert resp.status_code == 200
        assert len(resp.json()["agents"]) == 1
        assert resp.json()["agents"][0]["name"] == "Support Bot"
        assert resp.json()["agents"][0]["total_runs"] == 5

        # 3. Create agent
        resp = client.post(
            "/public/whatsapp/agents",
            headers=headers,
            json={"name": "Support Bot", "system_prompt": "You are a helpful assistant."},
        )
        assert resp.status_code == 200
        assert resp.json()["id"] == 12
        assert resp.json()["total_runs"] == 0

        # 4. Get agent
        resp = client.get("/public/whatsapp/agents/12", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["id"] == 12
        assert resp.json()["total_runs"] == 5

        # 5. Delete agent
        resp = client.delete("/public/whatsapp/agents/12", headers=headers)
        assert resp.status_code == 200
        assert resp.json() == {"message": "WhatsApp agent deleted"}


def test_public_whatsapp_conversations():
    app = _make_test_app()
    client = TestClient(app)

    mock_api_key = SimpleNamespace(id=1, organization_id=10)
    mock_convo = SimpleNamespace(
        id=99,
        number_id=5,
        contact="15550199@c.us",
        messages=[{"role": "user", "content": "Hi"}, {"role": "assistant", "content": "Hello!"}],
        updated_at="2026-10-05T00:00:00",
    )

    with patch.object(db_client, "validate_api_key", new_callable=AsyncMock) as mock_val, \
         patch.object(db_client, "list_whatsapp_conversations", new_callable=AsyncMock) as mock_list_convo, \
         patch.object(db_client, "get_whatsapp_conversation", new_callable=AsyncMock) as mock_get_convo, \
         patch.object(db_client, "list_whatsapp_numbers", new_callable=AsyncMock) as mock_list_num, \
         patch.object(db_client, "list_whatsapp_agents", new_callable=AsyncMock) as mock_list_agent:

        mock_val.return_value = mock_api_key
        mock_list_convo.return_value = [mock_convo]
        mock_get_convo.return_value = mock_convo
        mock_list_num.return_value = []
        mock_list_agent.return_value = []

        headers = {"X-API-Key": "test-key"}

        # 1. List conversations
        resp = client.get("/public/whatsapp/conversations", headers=headers)
        assert resp.status_code == 200
        assert len(resp.json()["conversations"]) == 1
        assert resp.json()["conversations"][0]["id"] == 99

        # 2. Get conversation detail
        resp = client.get("/public/whatsapp/conversations/99", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["id"] == 99
        assert len(resp.json()["messages"]) == 2
