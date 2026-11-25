"""Typed async client for the OpenWA gateway REST API.

Thin wrapper over ``httpx`` — one method per gateway operation we use. All calls
are authenticated with the ``X-API-Key`` header and raise :class:`OpenWAError`
on transport failures or non-2xx responses so callers can surface a clean 502.

Reference: OpenWA OpenAPI (``/api/docs``) — sessions, qr, webhooks, messages.
"""

from __future__ import annotations

import base64
from typing import Any, Optional

import httpx
from loguru import logger

from api.constants import OPENWA_API_KEY, OPENWA_BASE_URL

# WhatsApp individual-chat suffix. A bare phone number (digits only) becomes
# "<number>@c.us"; group ids already carry "@g.us".
WA_INDIVIDUAL_SUFFIX = "@c.us"


class OpenWAError(Exception):
    """Raised when the OpenWA gateway is unreachable or returns an error."""

    def __init__(self, message: str, status_code: Optional[int] = None):
        super().__init__(message)
        self.status_code = status_code


def to_chat_id(phone_or_chat_id: str) -> str:
    """Normalise a phone number to a WhatsApp chat id (idempotent)."""
    value = phone_or_chat_id.strip()
    if "@" in value:
        return value
    digits = "".join(ch for ch in value if ch.isdigit())
    return f"{digits}{WA_INDIVIDUAL_SUFFIX}"


class OpenWAClient:
    """Async REST client for a single OpenWA gateway instance."""

    def __init__(
        self,
        base_url: str = OPENWA_BASE_URL,
        api_key: str = OPENWA_API_KEY,
        timeout: float = 30.0,
    ):
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._timeout = timeout

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self._api_key:
            headers["X-API-Key"] = self._api_key
        return headers

    async def _request(
        self, method: str, path: str, *, json: Any = None
    ) -> httpx.Response:
        url = f"{self._base_url}{path}"
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.request(
                    method, url, json=json, headers=self._headers()
                )
        except httpx.HTTPError as e:
            logger.error(f"OpenWA request failed: {method} {path}: {e}")
            raise OpenWAError(f"OpenWA gateway unreachable: {e}") from e

        if resp.status_code >= 400:
            body = resp.text[:500]
            logger.warning(
                f"OpenWA {method} {path} -> {resp.status_code}: {body}"
            )
            raise OpenWAError(
                f"OpenWA returned {resp.status_code}: {body}",
                status_code=resp.status_code,
            )
        return resp

    # ── Sessions (one per connected phone number) ────────────────────────────

    async def create_session(
        self, name: str, config: Optional[dict] = None
    ) -> dict:
        """Create a session. ``name`` must be alphanumeric/hyphen, 3–50 chars."""
        payload: dict[str, Any] = {"name": name}
        if config is not None:
            payload["config"] = config
        resp = await self._request("POST", "/api/sessions", json=payload)
        return resp.json()

    async def get_session(self, session_id: str) -> dict:
        resp = await self._request("GET", f"/api/sessions/{session_id}")
        return resp.json()

    async def list_sessions(self) -> Any:
        resp = await self._request("GET", "/api/sessions")
        return resp.json()

    async def start_session(self, session_id: str) -> dict:
        resp = await self._request("POST", f"/api/sessions/{session_id}/start")
        return resp.json()

    async def stop_session(self, session_id: str) -> dict:
        resp = await self._request("POST", f"/api/sessions/{session_id}/stop")
        return resp.json()

    async def delete_session(self, session_id: str) -> None:
        await self._request("DELETE", f"/api/sessions/{session_id}")

    async def get_qr(self, session_id: str) -> dict:
        """Return the QR payload for pairing (JSON, typically a data URL)."""
        resp = await self._request("GET", f"/api/sessions/{session_id}/qr")
        # The gateway may return JSON or a raw image; normalise to a dict.
        content_type = resp.headers.get("content-type", "")
        if "application/json" in content_type:
            return resp.json()
        return {"contentType": content_type, "raw": resp.content}

    # ── Webhooks (inbound events -> our backend) ─────────────────────────────

    async def create_webhook(
        self,
        session_id: str,
        url: str,
        events: list[str],
        secret: Optional[str] = None,
    ) -> dict:
        payload: dict[str, Any] = {"url": url, "events": events}
        if secret:
            payload["secret"] = secret
        resp = await self._request(
            "POST", f"/api/sessions/{session_id}/webhooks", json=payload
        )
        return resp.json()

    # ── Outbound messages ────────────────────────────────────────────────────

    async def send_text(
        self, session_id: str, phone_or_chat_id: str, text: str
    ) -> dict:
        payload = {"chatId": to_chat_id(phone_or_chat_id), "text": text}
        resp = await self._request(
            "POST",
            f"/api/sessions/{session_id}/messages/send-text",
            json=payload,
        )
        return resp.json()

    async def send_voice(
        self,
        session_id: str,
        phone_or_chat_id: str,
        audio_bytes: bytes,
        mimetype: str = "audio/ogg; codecs=opus",
    ) -> dict:
        """Send an outbound WhatsApp voice note (PTT mic bubble + waveform)."""
        b64 = base64.b64encode(audio_bytes).decode("utf-8")
        payload = {
            "chatId": to_chat_id(phone_or_chat_id),
            "base64": b64,
            "mimetype": mimetype,
            "ptt": True,
        }
        resp = await self._request(
            "POST",
            f"/api/sessions/{session_id}/messages/send-audio",
            json=payload,
        )
        return resp.json()

    # ── Media download ───────────────────────────────────────────────────

    async def download_media(
        self, session_id: str, chat_id: str, message_id: str
    ) -> tuple[bytes, str] | None:
        """Download media bytes for an inbound WhatsApp message.

        OpenWA requires the exact inbound ``chatId`` and message id in the
        media route. Returns ``(bytes, mime_type)`` or ``None`` on failure.
        """
        if not session_id or not chat_id or not message_id:
            logger.warning(
                "OpenWA media download skipped: missing session/chat/message id"
            )
            return None

        path = (
            f"/api/sessions/{session_id}/messages/"
            f"{chat_id}/{message_id}/media"
        )
        url = f"{self._base_url}{path}"
        headers = {"X-API-Key": self._api_key}
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.get(url, headers=headers)
        except httpx.HTTPError as e:
            logger.error(
                f"OpenWA media download failed session={session_id} "
                f"chat_id={chat_id} message_id={message_id}: {e}"
            )
            return None

        content_type = resp.headers.get("content-type", "application/octet-stream")
        if resp.status_code >= 400:
            body_preview = resp.text[:300].strip()
            logger.warning(
                f"OpenWA media download failed session={session_id} chat_id={chat_id} "
                f"message_id={message_id} status={resp.status_code} url={url} "
                f"body={body_preview}"
            )
            return None

        logger.info(
            f"OpenWA media download session={session_id} chat_id={chat_id} "
            f"message_id={message_id} status={resp.status_code} "
            f"mime={content_type} bytes={len(resp.content)}"
        )
        return resp.content, content_type


_default_client: Optional[OpenWAClient] = None


def get_openwa_client() -> OpenWAClient:
    """Process-wide default client (reads OPENWA_* env at first use)."""
    global _default_client
    if _default_client is None:
        _default_client = OpenWAClient()
    return _default_client
