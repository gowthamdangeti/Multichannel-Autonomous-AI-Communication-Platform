import httpx
import pytest

from api.routes import turn_credentials


@pytest.mark.asyncio
async def test_cloudflare_credentials_use_custom_host_only_for_non_tls_urls(
    monkeypatch,
):
    seen = {}
    response_payload = {
        "iceServers": [
            {"urls": ["stun:stun.cloudflare.com:3478"]},
            {
                "urls": [
                    "turn:turn.cloudflare.com:3478?transport=udp",
                    "turns:turn.cloudflare.com:5349?transport=tcp",
                ],
                "username": "ephemeral-user",
                "credential": "ephemeral-password",
            },
        ]
    }
    original_async_client = httpx.AsyncClient

    def handle_request(request):
        seen["url"] = str(request.url)
        seen["authorization"] = request.headers["Authorization"]
        seen["json"] = request.read().decode()
        return httpx.Response(201, json=response_payload)

    def build_client(**kwargs):
        return original_async_client(
            transport=httpx.MockTransport(handle_request), **kwargs
        )

    monkeypatch.setattr(turn_credentials.httpx, "AsyncClient", build_client)
    monkeypatch.setattr(turn_credentials, "TURN_PROVIDER", "cloudflare")
    monkeypatch.setattr(turn_credentials, "TURN_ENABLED", True)
    monkeypatch.setattr(turn_credentials, "CLOUDFLARE_TURN_KEY_ID", "turn-key-id")
    monkeypatch.setattr(
        turn_credentials, "CLOUDFLARE_TURN_KEY_SECRET", "turn-key-secret"
    )
    monkeypatch.setattr(
        turn_credentials, "CLOUDFLARE_TURN_HOST", "turn.convozent.oibre.dev"
    )

    credentials = await turn_credentials.generate_user_turn_credentials(
        "user-42", ttl=3600
    )

    assert seen == {
        "url": (
            "https://rtc.live.cloudflare.com/v1/turn/keys/turn-key-id/"
            "credentials/generate-ice-servers"
        ),
        "authorization": "Bearer turn-key-secret",
        "json": '{"ttl":3600}',
    }
    assert credentials == {
        "username": "ephemeral-user",
        "password": "ephemeral-password",
        "ttl": 3600,
        "uris": [
            "turn:turn.convozent.oibre.dev:3478?transport=udp",
            "turns:turn.cloudflare.com:5349?transport=tcp",
        ],
    }
