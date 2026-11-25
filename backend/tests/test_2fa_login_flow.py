import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi.testclient import TestClient

from api.app import app

client = TestClient(app)


@pytest.mark.asyncio
async def test_2fa_login_challenge_and_verification_flow():
    mock_user_no_2fa = MagicMock()
    mock_user_no_2fa.id = 1
    mock_user_no_2fa.email = "test@example.com"
    mock_user_no_2fa.password_hash = "$2b$12$eImiTXuWVxfM37uY4JANjO5E/0eE.3x2vF7V6vG6uH7J7K7L7M7N7"
    mock_user_no_2fa.is_2fa_enabled = False
    mock_user_no_2fa.selected_organization_id = 1
    mock_user_no_2fa.provider_id = "test_provider"
    mock_user_no_2fa.is_superuser = False

    mock_user_2fa = MagicMock()
    mock_user_2fa.id = 1
    mock_user_2fa.email = "test2fa@example.com"
    mock_user_2fa.password_hash = "$2b$12$eImiTXuWVxfM37uY4JANjO5E/0eE.3x2vF7V6vG6uH7J7K7L7M7N7"
    mock_user_2fa.is_2fa_enabled = True
    mock_user_2fa.selected_organization_id = 1
    mock_user_2fa.provider_id = "test_provider_2fa"
    mock_user_2fa.is_superuser = False

    with patch("api.routes.auth.db_client.get_user_by_email") as mock_get_user, \
         patch("api.routes.auth.verify_password", return_value=True), \
         patch("api.routes.auth.send_2fa_email_otp", new_callable=AsyncMock) as mock_send_otp, \
         patch("api.routes.auth.verify_2fa_email_otp", new_callable=AsyncMock) as mock_verify_otp:

        # 1. Login with 2FA disabled -> returns token immediately
        mock_get_user.return_value = mock_user_no_2fa
        resp1 = client.post("/api/v1/auth/login", json={"email": "test@example.com", "password": "password123"})
        assert resp1.status_code == 200
        assert resp1.json()["token"] is not None
        assert resp1.json()["requires_2fa"] is False

        # 2. Login with 2FA enabled -> triggers OTP & requires_2fa: true
        mock_get_user.return_value = mock_user_2fa
        mock_send_otp.return_value = None
        resp2 = client.post("/api/v1/auth/login", json={"email": "test2fa@example.com", "password": "password123"})
        assert resp2.status_code == 200
        assert resp2.json()["requires_2fa"] is True
        assert "2FA verification code sent" in resp2.json()["message"]
        mock_send_otp.assert_called_once_with("test2fa@example.com")

        # 3. Verify 2FA OTP at login/verify-2fa -> completes login & returns token
        mock_verify_otp.return_value = True
        resp3 = client.post("/api/v1/auth/login/verify-2fa", json={"email": "test2fa@example.com", "otp": "654321"})
        assert resp3.status_code == 200
        assert resp3.json()["token"] is not None
        assert resp3.json()["user"]["email"] == "test2fa@example.com"
        mock_verify_otp.assert_called_once_with("test2fa@example.com", "654321")
