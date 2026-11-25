from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from api.app import app
from api.services.auth.depends import get_user

client = TestClient(app)


def _mock_user(**overrides) -> MagicMock:
    user = MagicMock()
    user.id = 1
    user.email = "test@example.com"
    user.email_verified = False
    user.password_hash = None
    user.first_name = None
    user.last_name = None
    user.avatar_key = None
    user.country = None
    user.phone_number = None
    user.selected_organization_id = 1
    user.provider_id = "test_provider"
    user.is_superuser = False
    user.is_2fa_enabled = False
    for key, value in overrides.items():
        setattr(user, key, value)
    return user


@pytest.fixture
def sign_in():
    def _sign_in(user: MagicMock) -> MagicMock:
        app.dependency_overrides[get_user] = lambda: user
        return user

    yield _sign_in
    app.dependency_overrides.pop(get_user, None)


def test_get_me_returns_profile_fields_and_avatar_url(sign_in):
    sign_in(_mock_user(first_name="Ada", last_name="Lovelace", avatar_key="avatars/1/abc.jpg"))
    with patch(
        "api.routes.auth.storage_fs.aget_signed_url",
        new_callable=AsyncMock,
        return_value="https://minio.example/avatars/1/abc.jpg",
    ) as mock_signed:
        resp = client.get("/api/v1/auth/me")

    assert resp.status_code == 200
    body = resp.json()
    assert body["first_name"] == "Ada"
    assert body["last_name"] == "Lovelace"
    assert body["avatar_key"] == "avatars/1/abc.jpg"
    assert body["avatar_url"] == "https://minio.example/avatars/1/abc.jpg"
    mock_signed.assert_awaited_once_with("avatars/1/abc.jpg", expiration=3600)


def test_get_me_omits_avatar_url_without_avatar(sign_in):
    sign_in(_mock_user())
    with patch(
        "api.routes.auth.storage_fs.aget_signed_url", new_callable=AsyncMock
    ) as mock_signed:
        resp = client.get("/api/v1/auth/me")

    assert resp.status_code == 200
    assert resp.json()["avatar_url"] is None
    mock_signed.assert_not_awaited()


def test_put_me_updates_profile_fields(sign_in):
    sign_in(_mock_user())
    updated = _mock_user(
        first_name="Ada", last_name="Lovelace", avatar_key="avatars/1/x.png"
    )
    with patch(
        "api.routes.auth.db_client.update_user_profile", new_callable=AsyncMock
    ) as mock_update, patch(
        "api.routes.auth.storage_fs.aget_signed_url",
        new_callable=AsyncMock,
        return_value="https://minio.example/avatars/1/x.png",
    ):
        mock_update.return_value = updated
        resp = client.put(
            "/api/v1/auth/me",
            json={
                "first_name": "Ada",
                "last_name": "Lovelace",
                "avatar_key": "avatars/1/x.png",
            },
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["first_name"] == "Ada"
    assert body["last_name"] == "Lovelace"
    mock_update.assert_awaited_once_with(
        1,
        {"first_name": "Ada", "last_name": "Lovelace", "avatar_key": "avatars/1/x.png"},
    )


def test_put_me_can_clear_avatar(sign_in):
    sign_in(_mock_user())
    with patch(
        "api.routes.auth.db_client.update_user_profile", new_callable=AsyncMock
    ) as mock_update, patch(
        "api.routes.auth.storage_fs.aget_signed_url", new_callable=AsyncMock
    ):
        mock_update.return_value = _mock_user()
        resp = client.put("/api/v1/auth/me", json={"avatar_key": None})

    assert resp.status_code == 200
    mock_update.assert_awaited_once_with(1, {"avatar_key": None})


def test_put_me_rejects_foreign_avatar_key(sign_in):
    sign_in(_mock_user())
    with patch(
        "api.routes.auth.db_client.update_user_profile", new_callable=AsyncMock
    ) as mock_update:
        resp = client.put(
            "/api/v1/auth/me", json={"avatar_key": "campaigns/5/file.csv"}
        )

    assert resp.status_code == 400
    mock_update.assert_not_awaited()


def test_put_me_rejects_blank_name(sign_in):
    sign_in(_mock_user())
    with patch(
        "api.routes.auth.db_client.update_user_profile", new_callable=AsyncMock
    ) as mock_update:
        resp = client.put("/api/v1/auth/me", json={"first_name": "   "})

    assert resp.status_code == 422
    mock_update.assert_not_awaited()


def test_avatar_upload_url_generates_presigned_put(sign_in):
    sign_in(_mock_user())
    with patch(
        "api.routes.auth.storage_fs.aget_presigned_put_url",
        new_callable=AsyncMock,
        return_value="https://minio.example/put/url",
    ) as mock_put:
        resp = client.post(
            "/api/v1/auth/me/avatar-upload-url", json={"content_type": "image/png"}
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["upload_url"] == "https://minio.example/put/url"
    assert body["avatar_key"].startswith("avatars/1/")
    assert body["expires_in"] == 900
    mock_put.assert_awaited_once()
    assert mock_put.await_args.kwargs["content_type"] == "image/png"
    assert mock_put.await_args.kwargs["file_path"] == body["avatar_key"]


def test_avatar_upload_url_rejects_non_image_content_type(sign_in):
    sign_in(_mock_user())
    resp = client.post(
        "/api/v1/auth/me/avatar-upload-url", json={"content_type": "text/plain"}
    )

    assert resp.status_code == 422


def test_put_me_updates_phone_number(sign_in):
    sign_in(_mock_user())
    updated = _mock_user(phone_number="+91 98765 43210")
    with patch(
        "api.routes.auth.db_client.update_user_profile", new_callable=AsyncMock
    ) as mock_update, patch(
        "api.routes.auth.storage_fs.aget_signed_url", new_callable=AsyncMock
    ):
        mock_update.return_value = updated
        resp = client.put("/api/v1/auth/me", json={"phone_number": "+91 98765 43210"})

    assert resp.status_code == 200
    assert resp.json()["phone_number"] == "+91 98765 43210"
    mock_update.assert_awaited_once_with(1, {"phone_number": "+91 98765 43210"})


def test_put_me_blank_phone_clears_it(sign_in):
    sign_in(_mock_user(phone_number="+91 98765 43210"))
    with patch(
        "api.routes.auth.db_client.update_user_profile", new_callable=AsyncMock
    ) as mock_update, patch(
        "api.routes.auth.storage_fs.aget_signed_url", new_callable=AsyncMock
    ):
        mock_update.return_value = _mock_user()
        resp = client.put("/api/v1/auth/me", json={"phone_number": "   "})

    assert resp.status_code == 200
    assert resp.json()["phone_number"] is None
    mock_update.assert_awaited_once_with(1, {"phone_number": None})


def test_put_me_rejects_long_phone_number(sign_in):
    sign_in(_mock_user())
    with patch(
        "api.routes.auth.db_client.update_user_profile", new_callable=AsyncMock
    ) as mock_update:
        resp = client.put(
            "/api/v1/auth/me", json={"phone_number": "+" * 31}
        )

    assert resp.status_code == 422
    mock_update.assert_not_awaited()


def test_change_password_success(sign_in):
    user = _mock_user()
    user.password_hash = "existing-hash"
    sign_in(user)
    with patch("api.routes.auth.verify_password", return_value=True) as mock_verify, \
         patch("api.routes.auth.hash_password", return_value="new-hash") as mock_hash, \
         patch(
            "api.routes.auth.db_client.update_user_password", new_callable=AsyncMock
         ) as mock_update:
        resp = client.post(
            "/api/v1/auth/change-password",
            json={"current_password": "old-pass", "new_password": "new-pass-123"},
        )

    assert resp.status_code == 200
    assert resp.json()["message"] == "Password updated successfully"
    mock_verify.assert_called_once_with("old-pass", "existing-hash")
    mock_hash.assert_called_once_with("new-pass-123")
    mock_update.assert_awaited_once_with(1, "new-hash")


def test_change_password_rejects_wrong_current(sign_in):
    user = _mock_user()
    user.password_hash = "existing-hash"
    sign_in(user)
    with patch("api.routes.auth.verify_password", return_value=False), \
         patch(
            "api.routes.auth.db_client.update_user_password", new_callable=AsyncMock
         ) as mock_update:
        resp = client.post(
            "/api/v1/auth/change-password",
            json={"current_password": "wrong", "new_password": "new-pass-123"},
        )

    assert resp.status_code == 400
    assert "Current password is incorrect" in resp.json()["detail"]
    mock_update.assert_not_awaited()


def test_change_password_rejects_short_new_password(sign_in):
    sign_in(_mock_user())
    resp = client.post(
        "/api/v1/auth/change-password",
        json={"current_password": "old-pass", "new_password": "short"},
    )

    assert resp.status_code == 422


def test_change_password_unavailable_when_no_password_set(sign_in):
    sign_in(_mock_user())  # password_hash None
    resp = client.post(
        "/api/v1/auth/change-password",
        json={"current_password": "old-pass", "new_password": "new-pass-123"},
    )

    assert resp.status_code == 400
    assert "no password set" in resp.json()["detail"]


def test_send_email_otp_sends_code(sign_in):
    sign_in(_mock_user(email="verify@example.com"))
    with patch(
        "api.routes.auth.send_email_verification_otp", new_callable=AsyncMock
    ) as mock_send:
        resp = client.post("/api/v1/auth/me/send-email-otp")

    assert resp.status_code == 200
    assert "verify@example.com" in resp.json()["message"]
    mock_send.assert_awaited_once_with("verify@example.com")


def test_send_email_otp_requires_email(sign_in):
    sign_in(_mock_user(email=None))
    with patch(
        "api.routes.auth.send_email_verification_otp", new_callable=AsyncMock
    ) as mock_send:
        resp = client.post("/api/v1/auth/me/send-email-otp")

    assert resp.status_code == 400
    assert "no email" in resp.json()["detail"]
    mock_send.assert_not_awaited()


def test_verify_email_success_marks_verified(sign_in):
    sign_in(_mock_user(email="verify@example.com"))
    verified = _mock_user(email="verify@example.com", email_verified=True)
    with patch(
        "api.routes.auth.verify_email_verification_otp",
        new_callable=AsyncMock,
        return_value=True,
    ) as mock_verify, patch(
        "api.routes.auth.db_client.update_user_profile", new_callable=AsyncMock
    ) as mock_update, patch(
        "api.routes.auth.storage_fs.aget_signed_url", new_callable=AsyncMock
    ):
        mock_update.return_value = verified
        resp = client.post("/api/v1/auth/me/verify-email", json={"otp": "123456"})

    assert resp.status_code == 200
    assert resp.json()["email_verified"] is True
    mock_verify.assert_awaited_once_with("verify@example.com", "123456")
    mock_update.assert_awaited_once_with(1, {"email_verified": True})


def test_verify_email_rejects_wrong_code(sign_in):
    sign_in(_mock_user(email="verify@example.com"))
    with patch(
        "api.routes.auth.verify_email_verification_otp",
        new_callable=AsyncMock,
        return_value=False,
    ) as mock_verify, patch(
        "api.routes.auth.db_client.update_user_profile", new_callable=AsyncMock
    ) as mock_update:
        resp = client.post("/api/v1/auth/me/verify-email", json={"otp": "000000"})

    assert resp.status_code == 400
    assert "Invalid or expired" in resp.json()["detail"]
    mock_update.assert_not_awaited()


def test_verify_email_rejects_malformed_otp(sign_in):
    sign_in(_mock_user(email="verify@example.com"))
    resp = client.post("/api/v1/auth/me/verify-email", json={"otp": "12ab"})

    assert resp.status_code == 422


def test_get_me_returns_email_verified(sign_in):
    sign_in(_mock_user(email="verify@example.com", email_verified=True))
    with patch(
        "api.routes.auth.storage_fs.aget_signed_url", new_callable=AsyncMock
    ):
        resp = client.get("/api/v1/auth/me")

    assert resp.status_code == 200
    assert resp.json()["email_verified"] is True