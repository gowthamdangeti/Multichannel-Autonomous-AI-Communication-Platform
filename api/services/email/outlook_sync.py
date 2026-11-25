"""Outlook / Microsoft Graph synchronization service.

Provides incremental synchronization via Microsoft Graph Delta API, automatic token
refresh, body extraction, and recovery on expired delta links.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
import os
from typing import Any, Dict, List, Optional, Tuple

import httpx
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.db.models import EmailMessageModel, OutlookAccountModel
from api.services.email.crypto import decrypt_token, encrypt_token

GRAPH_API_BASE = "https://graph.microsoft.com/v1.0/me"
MS_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token"

OUTLOOK_CLIENT_ID = os.getenv("OUTLOOK_CLIENT_ID", "")
OUTLOOK_CLIENT_SECRET = os.getenv("OUTLOOK_CLIENT_SECRET", "")


class OutlookSyncError(Exception):
    """Raised when Outlook synchronization fails."""


async def refresh_outlook_access_token(
    session: AsyncSession,
    account: OutlookAccountModel,
    client: Optional[httpx.AsyncClient] = None,
) -> str:
    """Refresh the access token for an OutlookAccountModel if expired or near expiry."""
    now = datetime.now(UTC)
    if account.access_token_encrypted and account.access_token_expires_at:
        if account.access_token_expires_at > now + timedelta(minutes=5):
            return decrypt_token(account.access_token_encrypted)

    refresh_token = decrypt_token(account.refresh_token_encrypted)
    if not refresh_token:
        account.status = "error"
        raise OutlookSyncError(f"No refresh token available for Outlook account {account.email}")

    client_id = os.getenv("OUTLOOK_CLIENT_ID") or OUTLOOK_CLIENT_ID or (account.extra_metadata or {}).get("client_id", "")
    client_secret = os.getenv("OUTLOOK_CLIENT_SECRET") or OUTLOOK_CLIENT_SECRET or (account.extra_metadata or {}).get("client_secret", "")

    if not client_id or not client_secret:
        if account.access_token_encrypted:
            return decrypt_token(account.access_token_encrypted)
        raise OutlookSyncError("OUTLOOK_CLIENT_ID or OUTLOOK_CLIENT_SECRET is missing")

    owns_client = client is None
    http = client or httpx.AsyncClient(timeout=15.0)
    try:
        response = await http.post(
            MS_TOKEN_URL,
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
                "scope": "https://graph.microsoft.com/Mail.ReadWrite offline_access",
            },
        )
        if response.status_code != 200:
            account.status = "error"
            raise OutlookSyncError(f"Failed to refresh Microsoft token: {response.text}")

        data = response.json()
        new_access_token = data.get("access_token", "")
        expires_in = data.get("expires_in", 3600)

        account.access_token_encrypted = encrypt_token(new_access_token)
        account.access_token_expires_at = now + timedelta(seconds=expires_in)
        account.status = "connected"
        account.updated_at = now
        await session.flush()
        return new_access_token
    finally:
        if owns_client:
            await http.aclose()


def parse_outlook_message_data(
    raw_msg: Dict[str, Any],
    account: OutlookAccountModel,
) -> Dict[str, Any]:
    """Parse raw Microsoft Graph message JSON into normalized dictionary for EmailMessageModel."""
    subject = raw_msg.get("subject", "")
    from_info = raw_msg.get("from", {}).get("emailAddress", {})
    sender = from_info.get("address") or from_info.get("name", "")

    body_obj = raw_msg.get("body", {})
    content_type = body_obj.get("contentType", "text").lower()
    content = body_obj.get("content", "")

    body_text = content if content_type == "text" else raw_msg.get("bodyPreview", "")
    body_html = content if content_type == "html" else None

    # Parse date
    received_time = raw_msg.get("receivedDateTime")
    internal_date = None
    if received_time:
        try:
            # ISO 8601 format e.g. 2026-11-05T09:00:00Z
            internal_date = datetime.fromisoformat(received_time.replace("Z", "+00:00"))
        except Exception:
            internal_date = datetime.now(UTC)

    return {
        "organization_id": account.organization_id,
        "outlook_account_id": account.id,
        "provider": "outlook",
        "gmail_message_id": raw_msg["id"],  # Maps to primary external message ID
        "gmail_thread_id": raw_msg.get("conversationId"),
        "subject": subject[:1024] if subject else None,
        "sender": sender[:320] if sender else None,
        "snippet": (raw_msg.get("bodyPreview") or "")[:2048],
        "body_text": body_text or raw_msg.get("bodyPreview", ""),
        "body_html": body_html,
        "gmail_labels": raw_msg.get("categories", []),
        "headers": {
            "internet_message_id": raw_msg.get("internetMessageId"),
            "importance": raw_msg.get("importance"),
        },
        "internal_date": internal_date,
        "is_read": raw_msg.get("isRead", False),
        "is_archived": False,
        "_has_attachments": raw_msg.get("hasAttachments", False),
    }


async def upsert_outlook_message(
    session: AsyncSession,
    msg_data: Dict[str, Any],
) -> Tuple[EmailMessageModel, bool]:
    """Upsert an Outlook message idempotently preventing duplicates."""
    has_attachments = msg_data.pop("_has_attachments", False)
    query = select(EmailMessageModel).where(
        EmailMessageModel.organization_id == msg_data["organization_id"],
        EmailMessageModel.outlook_account_id == msg_data["outlook_account_id"],
        EmailMessageModel.gmail_message_id == msg_data["gmail_message_id"],
    )
    result = await session.execute(query)
    existing = result.scalars().first()

    if existing:
        for k, v in msg_data.items():
            if k == "ai_category" and existing.ai_category is not None:
                continue
            setattr(existing, k, v)
        await session.flush()
        existing._has_attachments = has_attachments
        return existing, False

    new_msg = EmailMessageModel(**msg_data)
    session.add(new_msg)
    await session.flush()
    new_msg._has_attachments = has_attachments
    return new_msg, True


async def sync_outlook_account(
    session: AsyncSession,
    account: OutlookAccountModel,
    max_messages: int = 50,
    organization_id: Optional[int] = None,
) -> Dict[str, Any]:
    """Perform delta synchronization for a Microsoft Graph Outlook account."""
    if organization_id is not None and account.organization_id != organization_id:
        raise OutlookSyncError(
            f"Tenant isolation violation: Account {account.id} belongs to org {account.organization_id}, not {organization_id}"
        )

    access_token = await refresh_outlook_access_token(session, account)
    synced_messages: List[EmailMessageModel] = []

    async with httpx.AsyncClient(timeout=30.0) as http:
        url = account.delta_link or f"{GRAPH_API_BASE}/mailFolders/inbox/messages/delta"
        params = {"$top": min(max_messages, 50)} if not account.delta_link else {}

        resp = await http.get(
            url,
            params=params,
            headers={"Authorization": f"Bearer {access_token}"},
        )

        if resp.status_code == 410:  # Gone / expired delta token
            logger.warning(f"Delta link expired for Outlook account {account.email}. Resetting delta sync.")
            account.delta_link = None
            url = f"{GRAPH_API_BASE}/mailFolders/inbox/messages/delta"
            resp = await http.get(
                url,
                params={"$top": min(max_messages, 50)},
                headers={"Authorization": f"Bearer {access_token}"},
            )

        if resp.status_code != 200:
            raise OutlookSyncError(f"Outlook delta sync failed: {resp.status_code} {resp.text}")

        data = resp.json()
        messages = data.get("value", [])

        for item in messages[:max_messages]:
            # Deleted messages in delta query have '@removed' attribute
            if "@removed" in item:
                continue
            parsed = parse_outlook_message_data(item, account)
            msg_model, _ = await upsert_outlook_message(session, parsed)
            synced_messages.append(msg_model)

        # Store next delta link or next link
        new_delta_link = data.get("@odata.deltaLink") or data.get("@odata.nextLink")
        if new_delta_link:
            account.delta_link = new_delta_link

        account.status = "connected"
        account.updated_at = datetime.now(UTC)
        await session.commit()

        return {
            "status": "success",
            "messages_synced": len(synced_messages),
            "delta_link_updated": bool(new_delta_link),
        }


async def send_outlook_reply(
    session: AsyncSession,
    account: OutlookAccountModel,
    to_email: str,
    subject: str,
    body_text: str,
    outlook_message_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Send an outbound email reply through the connected Outlook account using Microsoft Graph."""
    access_token = await refresh_outlook_access_token(session, account)

    clean_subject = subject or "Re: Your message"
    if not clean_subject.lower().startswith("re:"):
        clean_subject = f"Re: {clean_subject}"

    async with httpx.AsyncClient(timeout=30.0) as http:
        if outlook_message_id:
            reply_url = f"{GRAPH_API_BASE}/messages/{outlook_message_id}/reply"
            resp = await http.post(
                reply_url,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json",
                },
                json={"comment": body_text},
            )
            if resp.status_code in (200, 202):
                logger.info(f"Successfully sent Outlook reply to {to_email} (in-reply-to={outlook_message_id})")
                return {"status": "sent", "provider": "outlook", "message_id": outlook_message_id}

        send_url = f"{GRAPH_API_BASE}/sendMail"
        payload = {
            "message": {
                "subject": clean_subject,
                "body": {"contentType": "Text", "content": body_text},
                "toRecipients": [{"emailAddress": {"address": to_email}}],
            },
            "saveToSentItems": "true",
        }
        resp = await http.post(
            send_url,
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
        if resp.status_code not in (200, 202):
            logger.error(f"Outlook send error: {resp.status_code} {resp.text}")
            raise OutlookSyncError(f"Failed to send Outlook email: {resp.status_code} {resp.text}")

        logger.info(f"Successfully sent Outlook email to {to_email}")
        return {"status": "sent", "provider": "outlook"}
