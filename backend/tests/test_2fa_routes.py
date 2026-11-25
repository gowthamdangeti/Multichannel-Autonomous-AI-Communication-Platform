from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from api.app import app
from api.services.auth import two_factor
from api.services.auth.depends import get_user

client = TestClient(app)

ACCOUNT_EMAIL = "owner@example.com"


def _user(enabled=False):
    user = MagicMock()
    user.id = 7
    user.email = ACCOUNT_EMAIL
    user.password_hash = "hash"
    user.is_2fa_enabled = enabled
    user.selected_organization_id = 1
    user.provider_id = "provider"
    user.is_superuser = False
    return user


@pytest.fixture
def signed_in():
    def _sign_in(enabled=False):
        user = _user(enabled)
        app.dependency_overrides[get_user] = lambda: user
        return user

    yield _sign_in
    app.dependency_overrides.pop(get_user, None)


@pytest.mark.parametrize(
    ("path", "body"),
    [
        ("/api/v1/auth/2fa/send-email-otp", {"email": "victim@example.com"}),
        ("/api/v1/auth/2fa/verify-email-otp", {"otp": "123456"}),
        ("/api/v1/auth/2fa/disable", {"otp": "123456"}),
        ("/api/v1/auth/2fa/recovery-codes", {"otp": "123456"}),
    ],
)
def test_2fa_settings_routes_need_a_signed_in_user(path, body):
    assert client.post(path, json=body).status_code in (401, 403, 422)


def test_a_code_goes_to_the_account_email_not_one_in_the_request(signed_in):
    signed_in()
    with patch("api.routes.auth.send_2fa_email_otp", new_callable=AsyncMock) as send:
        response = client.post("/api/v1/auth/2fa/send-email-otp", json={"email": "victim@example.com"})

    assert response.status_code == 200
    send.assert_called_once_with(ACCOUNT_EMAIL)


def test_a_mail_failure_does_not_leak_its_details(signed_in):
    signed_in()
    with patch("api.routes.auth.send_2fa_email_otp", AsyncMock(side_effect=RuntimeError("smtp password wrong"))):
        response = client.post("/api/v1/auth/2fa/send-email-otp")

    assert response.status_code == 502
    assert "smtp" not in response.text


def test_verifying_enables_only_the_signed_in_user_and_returns_codes(signed_in):
    user = signed_in()
    with (
        patch("api.routes.auth.verify_2fa_email_otp", AsyncMock(return_value=True)) as verify,
        patch("api.routes.auth.db_client.update_user_2fa_status", new_callable=AsyncMock) as update,
        patch("api.routes.auth.issue_recovery_codes", AsyncMock(return_value=["AAAAA-BBBBB"])),
    ):
        response = client.post("/api/v1/auth/2fa/verify-email-otp", json={"otp": "123456", "email": "victim@example.com"})

    assert response.json() == {"recovery_codes": ["AAAAA-BBBBB"]}
    verify.assert_called_once_with(ACCOUNT_EMAIL, "123456")
    update.assert_called_once_with(user.id, True)


def test_a_wrong_code_changes_nothing(signed_in):
    signed_in(enabled=True)
    with (
        patch("api.routes.auth.verify_2fa_email_otp", AsyncMock(return_value=False)),
        patch("api.routes.auth.db_client.update_user_2fa_status", new_callable=AsyncMock) as update,
        patch("api.routes.auth.clear_recovery_codes", new_callable=AsyncMock) as clear,
        patch("api.routes.auth.issue_recovery_codes", new_callable=AsyncMock) as issue,
    ):
        disabled = client.post("/api/v1/auth/2fa/disable", json={"otp": "000000"})
        regenerated = client.post("/api/v1/auth/2fa/recovery-codes", json={"otp": "000000"})

    assert disabled.status_code == 400
    assert regenerated.status_code == 400
    update.assert_not_called()
    clear.assert_not_called()
    issue.assert_not_called()


def test_disabling_with_a_valid_code_clears_recovery_codes(signed_in):
    user = signed_in(enabled=True)
    with (
        patch("api.routes.auth.verify_2fa_email_otp", AsyncMock(return_value=True)),
        patch("api.routes.auth.db_client.update_user_2fa_status", new_callable=AsyncMock) as update,
        patch("api.routes.auth.clear_recovery_codes", new_callable=AsyncMock) as clear,
    ):
        response = client.post("/api/v1/auth/2fa/disable", json={"otp": "123456"})

    assert response.status_code == 200
    update.assert_called_once_with(user.id, False)
    clear.assert_called_once_with(user.id)


def test_the_unguarded_toggle_route_is_gone(signed_in):
    signed_in(enabled=True)

    assert client.post("/api/v1/auth/2fa/toggle", json={"enabled": False}).status_code in (404, 405)


def test_recovery_codes_cannot_be_regenerated_without_2fa(signed_in):
    signed_in(enabled=False)

    assert client.post("/api/v1/auth/2fa/recovery-codes", json={"otp": "123456"}).status_code == 400


def _recovery_login(password_ok=True, redeemed=True, allowed=True, enabled=True):
    with (
        patch("api.routes.auth.allow_recovery_attempt", AsyncMock(return_value=allowed)),
        patch("api.routes.auth.db_client.get_user_by_email", AsyncMock(return_value=_user(enabled))),
        patch("api.routes.auth.verify_password", return_value=password_ok),
        patch("api.routes.auth.redeem_recovery_code", AsyncMock(return_value=redeemed)) as redeem,
    ):
        body = {"email": ACCOUNT_EMAIL, "password": "pw", "code": "AAAAA-BBBBB"}
        return client.post("/api/v1/auth/login/recovery", json=body), redeem


def test_recovery_login_signs_in_with_password_and_code():
    response, _ = _recovery_login()

    assert response.status_code == 200
    assert response.json()["token"]


def test_recovery_login_never_spends_a_code_on_a_wrong_password():
    response, redeem = _recovery_login(password_ok=False)

    assert response.status_code == 401
    redeem.assert_not_called()


def test_recovery_login_rejects_a_bad_code():
    assert _recovery_login(redeemed=False)[0].status_code == 401


def test_recovery_login_is_rate_limited():
    assert _recovery_login(allowed=False)[0].status_code == 429


def test_recovery_login_refuses_accounts_without_2fa():
    assert _recovery_login(enabled=False)[0].status_code == 401


def test_generated_codes_are_readable_and_never_stored_in_plain_text():
    code = two_factor._generate_recovery_code()

    assert len(code) == 11
    assert code[5] == "-"
    assert not set(code) & set("01OI")
    assert code not in two_factor._hash_recovery_code(1, code)


def test_a_code_hash_ignores_formatting_but_is_tied_to_the_user():
    hashed = two_factor._hash_recovery_code(1, "ABCDE-FGHJK")

    assert two_factor._hash_recovery_code(1, " abcde fghjk ") == hashed
    assert two_factor._hash_recovery_code(2, "ABCDE-FGHJK") != hashed


@pytest.mark.asyncio
async def test_issued_codes_are_saved_only_as_hashes():
    with patch.object(two_factor.db_client, "upsert_user_configuration_value", new_callable=AsyncMock) as save:
        codes = await two_factor.issue_recovery_codes(7)

    assert len(set(codes)) == two_factor.RECOVERY_CODE_COUNT
    stored = save.call_args.args[2]
    assert not set(codes) & set(stored["hashes"])
    assert stored["hashes"] == [two_factor._hash_recovery_code(7, code) for code in codes]
