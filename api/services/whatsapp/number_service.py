"""Domain logic for connecting/managing WhatsApp numbers via OpenWA.

Routes stay thin and delegate here: creating a number provisions an OpenWA
session, persists our row, and registers the inbound webhook; status refresh
reconciles our row with the gateway.
"""

from __future__ import annotations

import re
import uuid

from loguru import logger
from sqlalchemy.exc import IntegrityError

from api.constants import (
    OPENWA_WEBHOOK_CALLBACK_BASE_URL,
    OPENWA_WEBHOOK_SECRET,
)
from api.db import db_client
from api.db.models import WhatsAppNumberModel
from api.services.whatsapp.openwa_client import OpenWAError, get_openwa_client


class WhatsAppNumberNameConflictError(Exception):
    """Raised when the org already has a WhatsApp number with this name."""

# Events we want OpenWA to push to our webhook.
WEBHOOK_EVENTS = [
    "message.received",
    "session.status",
    "session.qr",
    "session.authenticated",
    "session.disconnected",
]

# OpenWA maps gateway states onto our own connection lifecycle.
_STATUS_MAP = {
    "authenticated": "connected",
    "connected": "connected",
    "ready": "connected",
    "qr": "qr",
    "qr_ready": "qr",
    "scan_qr_code": "qr",
    "authenticating": "connecting",
    "connecting": "connecting",
    "initializing": "connecting",
    "starting": "connecting",
    "disconnected": "disconnected",
    "stopped": "disconnected",
    "unpaired": "disconnected",
    "failed": "error",
    "error": "error",
}


def normalize_status(raw: str | None) -> str:
    if not raw:
        return "created"
    return _STATUS_MAP.get(str(raw).strip().lower(), str(raw).strip().lower())


def gateway_id(number: WhatsAppNumberModel) -> str:
    """OpenWA session sub-endpoints key on the session UUID (``id``), not the
    name. Fall back to the name only if we somehow never captured the UUID."""
    return number.openwa_session_id or number.openwa_session_name


def _session_name(organization_id: int, name: str) -> str:
    """Gateway-safe, unique session name: alphanumeric + hyphen, 3–50 chars."""
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", name).strip("-").lower()[:24] or "wa"
    return f"org{organization_id}-{slug}-{uuid.uuid4().hex[:8]}"


async def create_connection(
    organization_id: int, name: str
) -> WhatsAppNumberModel:
    """Provision an OpenWA session + our row, then register the webhook.

    Raises OpenWAError if the gateway is unreachable / rejects the session.
    """
    client = get_openwa_client()
    session_name = _session_name(organization_id, name)

    created = await client.create_session(
        session_name, config={"autoReconnect": True}
    )
    session_id = str(
        created.get("id") or created.get("sessionId") or session_name
    )

    # A freshly-created session is idle; start it so the gateway begins the
    # WhatsApp Web handshake and produces a QR to scan. Best-effort — the QR
    # route also starts it on demand.
    status = normalize_status(created.get("status"))
    try:
        await client.start_session(session_id)
        status = "connecting"
    except OpenWAError as e:
        logger.warning(f"OpenWA start failed for {session_name}: {e}")

    try:
        number = await db_client.create_whatsapp_number(
            organization_id=organization_id,
            name=name,
            openwa_session_name=session_name,
            openwa_session_id=session_id,
            status=status,
            extra_metadata={"created": created},
        )
    except IntegrityError as e:
        # Don't leave an orphan gateway session behind when the DB rejects the row.
        try:
            await client.delete_session(session_id)
        except OpenWAError as cleanup_error:
            logger.warning(
                f"OpenWA cleanup failed for {session_name}: {cleanup_error}"
            )
        raise WhatsAppNumberNameConflictError(
            f"A WhatsApp number named '{name}' already exists."
        ) from e

    # Register the inbound webhook (best-effort — connection still works without
    # it; inbound messaging needs it). Never fail creation on this.
    await register_webhook(session_id, session_name)
    return number


async def register_webhook(session_id: str, session_name: str) -> bool:
    """Point an OpenWA session's inbound events at our backend. Returns success.

    Idempotent-ish: OpenWA dedupes by URL; safe to call again to (re)establish
    the webhook for a session created before the callback URL was reachable.
    """
    client = get_openwa_client()
    webhook_url = (
        f"{OPENWA_WEBHOOK_CALLBACK_BASE_URL.rstrip('/')}"
        f"/api/v1/whatsapp/webhook/{session_name}"
    )
    try:
        await client.create_webhook(
            session_id=session_id,
            url=webhook_url,
            events=WEBHOOK_EVENTS,
            secret=OPENWA_WEBHOOK_SECRET or None,
        )
        return True
    except OpenWAError as e:
        logger.warning(
            f"WhatsApp webhook registration failed for {session_name}: {e}"
        )
        return False


async def refresh_status(number: WhatsAppNumberModel) -> WhatsAppNumberModel:
    """Reconcile our row's status/phone with the gateway. Best-effort."""
    client = get_openwa_client()
    try:
        session = await client.get_session(gateway_id(number))
    except OpenWAError as e:
        logger.debug(f"refresh_status: gateway lookup failed: {e}")
        return number

    status = normalize_status(session.get("status") or session.get("state"))
    phone = session.get("phoneNumber") or session.get("phone")
    me = session.get("me")
    if not phone and isinstance(me, dict):
        phone = me.get("user")
    updated = await db_client.update_whatsapp_number(
        number.id,
        number.organization_id,
        status=status,
        phone_number=phone,
    )
    return updated or number


async def delete_connection(number: WhatsAppNumberModel) -> None:
    """Delete the gateway session (best-effort) then our row."""
    client = get_openwa_client()
    try:
        await client.delete_session(gateway_id(number))
    except OpenWAError as e:
        logger.warning(
            f"OpenWA session delete failed for {number.openwa_session_name}: {e}"
        )
    await db_client.delete_whatsapp_number(number.id, number.organization_id)
