from unittest.mock import AsyncMock, Mock, patch
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes.public.telephony import router as public_telephony_router


def _make_test_app() -> FastAPI:
    app = FastAPI()
    app.include_router(public_telephony_router)
    return app


def test_public_telephony_config_crud():
    app = _make_test_app()
    client = TestClient(app)

    mock_api_key = SimpleNamespace(id=1, organization_id=10)
    mock_config = SimpleNamespace(
        id=100,
        name="Test Twilio",
        provider="twilio",
        is_default_outbound=True,
        credentials={"account_sid": "AC123", "auth_token": "secret"},
        created_at="2026-10-01T00:00:00",
        updated_at="2026-10-01T00:00:00",
    )

    with patch("api.db.db_client.validate_api_key", new_callable=AsyncMock) as mock_val, \
         patch("api.db.db_client.list_telephony_configurations", new_callable=AsyncMock) as mock_list, \
         patch("api.db.db_client.list_phone_numbers_for_config", new_callable=AsyncMock) as mock_list_num, \
         patch("api.db.db_client.create_telephony_configuration", new_callable=AsyncMock) as mock_create, \
         patch("api.db.db_client.get_telephony_configuration_for_org", new_callable=AsyncMock) as mock_get, \
         patch("api.db.db_client.update_telephony_configuration", new_callable=AsyncMock) as mock_update, \
         patch("api.db.db_client.set_default_telephony_configuration", new_callable=AsyncMock) as mock_set_def, \
         patch("api.db.db_client.delete_telephony_configuration", new_callable=AsyncMock) as mock_del:

        mock_val.return_value = mock_api_key
        mock_list.return_value = [mock_config]
        mock_list_num.return_value = []
        mock_create.return_value = mock_config
        mock_get.return_value = mock_config
        mock_update.return_value = mock_config
        mock_set_def.return_value = mock_config
        mock_del.return_value = True

        headers = {"X-API-Key": "test-key"}

        # 1. List
        resp = client.get("/public/telephony-configs", headers=headers)
        assert resp.status_code == 200
        assert len(resp.json()["configurations"]) == 1

        # 2. Get by ID
        resp = client.get("/public/telephony-configs/100", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["id"] == 100

        # 3. Create
        create_payload = {
            "name": "Test Twilio",
            "is_default_outbound": True,
            "config": {
                "provider": "twilio",
                "account_sid": "AC123",
                "auth_token": "secret",
            },
        }
        resp = client.post("/public/telephony-configs", headers=headers, json=create_payload)
        assert resp.status_code == 200
        assert resp.json()["id"] == 100

        # 4. Set Default Outbound
        resp = client.post("/public/telephony-configs/100/set-default-outbound", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["id"] == 100

        # 5. Delete
        resp = client.delete("/public/telephony-configs/100", headers=headers)
        assert resp.status_code == 200
        assert resp.json() == {"message": "Telephony configuration deleted"}
