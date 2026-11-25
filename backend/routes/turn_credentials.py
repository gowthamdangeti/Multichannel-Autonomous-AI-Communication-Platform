"""TURN credentials endpoint and provider adapters for WebRTC.

Coturn credentials use its HMAC-SHA1 REST API. Cloudflare Realtime credentials
are issued by its API and passed to clients as short-lived ICE server config.
"""

import base64
import hashlib
import hmac
import time
from typing import List, Optional

import httpx

from fastapi import APIRouter, Depends, HTTPException
from loguru import logger
from pydantic import BaseModel

from api.constants import (
    CLOUDFLARE_TURN_HOST,
    CLOUDFLARE_TURN_KEY_ID,
    CLOUDFLARE_TURN_KEY_SECRET,
    ENVIRONMENT,
    TURN_CREDENTIAL_TTL,
    TURN_ENABLED,
    TURN_HOST,
    TURN_PORT,
    TURN_PROVIDER,
    TURN_SECRET,
    TURN_TLS_PORT,
)
from api.db.models import UserModel
from api.enums import Environment
from api.services.auth.depends import get_user

router = APIRouter(prefix="/turn", tags=["turn"])


class TurnCredentialsResponse(BaseModel):
    """Response model for TURN credentials."""

    username: str
    password: str
    ttl: int
    uris: List[str]


class TurnConfigResponse(BaseModel):
    """Response model for TURN configuration status."""

    enabled: bool
    host: Optional[str] = None


def generate_turn_credentials(user_id: str, ttl: int = TURN_CREDENTIAL_TTL) -> dict:
    """Generate coturn REST API credentials using HMAC-SHA1.

    Args:
        user_id: Unique identifier for the user (for auditing)
        ttl: Time-to-live in seconds for the credentials

    Returns:
        Dictionary with username, password, ttl, and TURN URIs

    Raises:
        ValueError: If TURN_SECRET is not configured
    """
    if not TURN_SECRET:
        raise ValueError("TURN_SECRET is not configured")

    expiration = int(time.time()) + ttl
    username = f"{expiration}:{user_id}"
    password = base64.b64encode(
        hmac.new(
            TURN_SECRET.encode("utf-8"),
            username.encode("utf-8"),
            hashlib.sha1,
        ).digest()
    ).decode("utf-8")

    # aiortc uses the first valid TURN URI, so preserve environment ordering.
    if ENVIRONMENT == Environment.LOCAL.value:
        uris = [
            f"turn:{TURN_HOST}:{TURN_PORT}?transport=tcp",
            f"turn:{TURN_HOST}:{TURN_PORT}",
        ]
    else:
        uris = [
            f"turn:{TURN_HOST}:{TURN_PORT}",
            f"turn:{TURN_HOST}:{TURN_PORT}?transport=tcp",
        ]

    if TURN_TLS_PORT:
        uris.extend(
            [
                f"turns:{TURN_HOST}:{TURN_TLS_PORT}",
                f"turns:{TURN_HOST}:{TURN_TLS_PORT}?transport=tcp",
            ]
        )

    return {
        "username": username,
        "password": password,
        "ttl": ttl,
        "uris": uris,
    }


def _format_cloudflare_turn_credentials(payload: dict, ttl: int) -> dict:
    """Convert Cloudflare's ICE-server response to the app's TURN contract."""
    ice_servers = payload.get("iceServers")
    if not isinstance(ice_servers, list):
        raise ValueError("Cloudflare response is missing iceServers")

    turn_server = next(
        (
            server
            for server in ice_servers
            if isinstance(server, dict)
            and isinstance(server.get("username"), str)
            and isinstance(server.get("credential"), str)
            and server.get("urls")
        ),
        None,
    )
    if turn_server is None:
        raise ValueError("Cloudflare response is missing TURN credentials")

    urls = turn_server["urls"]
    if isinstance(urls, str):
        urls = [urls]
    if not isinstance(urls, list) or not all(isinstance(url, str) for url in urls):
        raise ValueError("Cloudflare response has invalid TURN URLs")

    cloudflare_url = "turn:turn.cloudflare.com"
    uris = []
    for url in urls:
        if url.startswith(cloudflare_url) and (
            len(url) == len(cloudflare_url)
            or url[len(cloudflare_url)] in ":?"
        ):
            url = f"turn:{CLOUDFLARE_TURN_HOST}{url[len(cloudflare_url):]}"
        uris.append(url)

    return {
        "username": turn_server["username"],
        "password": turn_server["credential"],
        "ttl": ttl,
        "uris": uris,
    }


async def _generate_cloudflare_turn_credentials(ttl: int) -> dict:
    """Ask Cloudflare Realtime TURN to issue short-lived ICE credentials."""
    url = (
        "https://rtc.live.cloudflare.com/v1/turn/keys/"
        f"{CLOUDFLARE_TURN_KEY_ID}/credentials/generate-ice-servers"
    )
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.post(
            url,
            headers={
                "Authorization": f"Bearer {CLOUDFLARE_TURN_KEY_SECRET}",
                "Content-Type": "application/json",
            },
            json={"ttl": ttl},
        )
    response.raise_for_status()
    return _format_cloudflare_turn_credentials(response.json(), ttl)


async def generate_user_turn_credentials(
    user_id: str, ttl: int = TURN_CREDENTIAL_TTL
) -> dict:
    """Generate expiring TURN credentials using the configured provider."""
    if not TURN_ENABLED:
        raise ValueError("TURN is not configured")
    if TURN_PROVIDER == "cloudflare":
        return await _generate_cloudflare_turn_credentials(ttl)
    return generate_turn_credentials(user_id, ttl)


@router.get("/credentials", response_model=TurnCredentialsResponse)
async def get_turn_credentials(
    user: UserModel = Depends(get_user),
) -> TurnCredentialsResponse:
    """Get time-limited TURN credentials for WebRTC connections.

    Credentials are issued by the configured TURN provider and expire after the
    configured TTL.
    """
    if not TURN_ENABLED:
        logger.warning("TURN credentials requested but TURN is not configured")
        raise HTTPException(
            status_code=503,
            detail="TURN server not configured",
        )

    try:
        credentials = await generate_user_turn_credentials(str(user.id))
        logger.debug(f"Generated TURN credentials for user {user.id}")
        return TurnCredentialsResponse(**credentials)
    except Exception as e:
        logger.error(f"Failed to generate TURN credentials: {e}")
        raise HTTPException(
            status_code=500,
            detail="Failed to generate TURN credentials",
        )
