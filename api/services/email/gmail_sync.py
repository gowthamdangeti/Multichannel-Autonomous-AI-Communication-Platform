"""Gmail synchronization service.

Provides incremental synchronization via the Gmail History API, automatic token
refresh, MIME body decoding, and safe recovery on expired history cursors.
"""

from __future__ import annotations

import base64
from datetime import UTC, datetime, timedelta
import email
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
import json
import os
from typing import Any, Dict, List, Optional, Tuple

import httpx
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.db.models import EmailMessageModel, GmailAccountModel
from api.services.email.crypto import decrypt_token, encrypt_token

GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"

# Environment variables for OAuth client credentials
GMAIL_CLIENT_ID = os.getenv("GMAIL_CLIENT_ID", "")
GMAIL_CLIENT_SECRET = os.getenv("GMAIL_CLIENT_SECRET", "")


class GmailSyncError(Exception):
    """Raised when Gmail synchronization fails."""


def _decode_base64_url(data: str) -> str:
    """Decode URL-safe base64 data from Gmail API payloads."""
    if not data:
        return ""
    try:
        padding = 4 - (len(data) % 4)
        if padding and padding < 4:
            data += "=" * padding
        return base64.urlsafe_b64decode(data.encode("utf-8")).decode("utf-8", errors="replace")
    except Exception:
        return ""


def _extract_body_parts(payload: Dict[str, Any]) -> Tuple[str, str, List[Dict[str, Any]]]:
    """Recursively extract plain text, HTML, and attachment references from a message payload.
    
    Returns (body_text, body_html, attachments_meta).
    """
    body_text = ""
    body_html = ""
    attachments: List[Dict[str, Any]] = []

    mime_type = payload.get("mimeType", "")
    body = payload.get("body", {})
    filename = payload.get("filename", "")

    # Check for attachment
    if filename and body.get("attachmentId"):
        attachments.append({
            "attachment_id": body["attachmentId"],
            "filename": filename,
            "mime_type": mime_type,
            "size": body.get("size", 0),
        })

    data = body.get("data", "")
    if data:
        decoded = _decode_base64_url(data)
        if "text/plain" in mime_type and not body_text:
            body_text = decoded
        elif "text/html" in mime_type and not body_html:
            body_html = decoded

    # Process child parts
    for part in payload.get("parts", []):
        sub_text, sub_html, sub_att = _extract_body_parts(part)
        if sub_text and not body_text:
            body_text = sub_text
        if sub_html and not body_html:
            body_html = sub_html
        attachments.extend(sub_att)

    return body_text, body_html, attachments


async def refresh_gmail_access_token(
    session: AsyncSession,
    account: GmailAccountModel,
    client: Optional[httpx.AsyncClient] = None,
) -> str:
    """Refresh the access token for a GmailAccountModel if expired or near expiry."""
    now = datetime.now(UTC)
    if account.access_token_encrypted and account.access_token_expires_at:
        # If token is valid for more than 5 minutes, reuse it
        if account.access_token_expires_at > now + timedelta(minutes=5):
            return decrypt_token(account.access_token_encrypted)

    refresh_token = decrypt_token(account.refresh_token_encrypted)
    if not refresh_token:
        account.status = "error"
        raise GmailSyncError(f"No refresh token available for Gmail account {account.email}")

    client_id = (
        os.getenv("GMAIL_CLIENT_ID")
        or os.getenv("GOOGLE_CLIENT_ID")
        or GMAIL_CLIENT_ID
        or (account.extra_metadata or {}).get("client_id", "")
    )
    client_secret = (
        os.getenv("GMAIL_CLIENT_SECRET")
        or os.getenv("GOOGLE_CLIENT_SECRET")
        or GMAIL_CLIENT_SECRET
        or (account.extra_metadata or {}).get("client_secret", "")
    )

    if not client_id or not client_secret:
        # Fall back to existing decrypted access token if credentials missing in env
        if account.access_token_encrypted:
            return decrypt_token(account.access_token_encrypted)
        raise GmailSyncError("GMAIL_CLIENT_ID or GMAIL_CLIENT_SECRET is missing")

    owns_client = client is None
    http = client or httpx.AsyncClient(timeout=15.0)
    try:
        response = await http.post(
            GOOGLE_TOKEN_URL,
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
            },
        )
        if response.status_code != 200:
            account.status = "error"
            raise GmailSyncError(f"Failed to refresh Google token: {response.text}")

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


async def fetch_gmail_message_detail(
    http: httpx.AsyncClient,
    access_token: str,
    message_id: str,
) -> Optional[Dict[str, Any]]:
    """Fetch full parsed message metadata and body by message ID."""
    resp = await http.get(
        f"{GMAIL_API_BASE}/messages/{message_id}",
        params={"format": "full"},
        headers={"Authorization": f"Bearer {access_token}"},
    )
    if resp.status_code == 404:
        return None
    if resp.status_code != 200:
        raise GmailSyncError(f"Failed to fetch Gmail message {message_id}: {resp.status_code}")
    return resp.json()


def parse_gmail_message_data(
    raw_msg: Dict[str, Any],
    account: GmailAccountModel,
) -> Dict[str, Any]:
    """Parse raw Gmail message API JSON into normalized dictionary for EmailMessageModel."""
    payload = raw_msg.get("payload", {})
    headers_list = payload.get("headers", [])
    headers_map = {h["name"].lower(): h["value"] for h in headers_list if "name" in h and "value" in h}

    subject = headers_map.get("subject", "")
    sender = headers_map.get("from", "")
    body_text, body_html, attachments = _extract_body_parts(payload)

    # Date parsing
    internal_date_ms = raw_msg.get("internalDate")
    internal_date = None
    if internal_date_ms:
        try:
            internal_date = datetime.fromtimestamp(int(internal_date_ms) / 1000.0, tz=UTC)
        except Exception:
            internal_date = datetime.now(UTC)

    labels = raw_msg.get("labelIds", [])
    is_sent = "SENT" in labels
    is_draft = "DRAFT" in labels
    initial_category = "sent" if is_sent else ("draft" if is_draft else None)

    return {
        "organization_id": account.organization_id,
        "gmail_account_id": account.id,
        "provider": "gmail",
        "gmail_message_id": raw_msg["id"],
        "gmail_thread_id": raw_msg.get("threadId"),
        "subject": subject[:1024] if subject else None,
        "sender": sender[:320] if sender else None,
        "snippet": (raw_msg.get("snippet") or "")[:2048],
        "body_text": body_text or raw_msg.get("snippet", ""),
        "body_html": body_html or None,
        "gmail_labels": labels,
        "headers": headers_map,
        "internal_date": internal_date,
        "ai_category": initial_category,
        "is_read": "UNREAD" not in labels,
        "is_archived": "INBOX" not in labels,
        "_raw_attachments": attachments,
    }


async def upsert_email_message(
    session: AsyncSession,
    msg_data: Dict[str, Any],
) -> Tuple[EmailMessageModel, bool]:
    """Upsert an email message idempotently preventing duplicates.
    
    Returns (message_instance, is_created).
    """
    raw_attachments = msg_data.pop("_raw_attachments", [])
    query = select(EmailMessageModel).where(
        EmailMessageModel.organization_id == msg_data["organization_id"],
        EmailMessageModel.gmail_account_id == msg_data["gmail_account_id"],
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
        existing._raw_attachments = raw_attachments
        return existing, False

    new_msg = EmailMessageModel(**msg_data)
    session.add(new_msg)
    await session.flush()
    new_msg._raw_attachments = raw_attachments
    return new_msg, True


async def sync_gmail_account(
    session: AsyncSession,
    account: GmailAccountModel,
    max_messages: int = 50,
    organization_id: Optional[int] = None,
) -> Dict[str, Any]:
    """Perform synchronization for a Gmail account.
    
    Uses incremental History API when history_id exists. If history_id is expired
    or missing, falls back to full initial sync with pagination.
    """
    if organization_id is not None and account.organization_id != organization_id:
        raise GmailSyncError(
            f"Tenant isolation violation: Account {account.id} belongs to org {account.organization_id}, not {organization_id}"
        )

    access_token = await refresh_gmail_access_token(session, account)
    synced_messages: List[EmailMessageModel] = []

    async with httpx.AsyncClient(timeout=30.0) as http:
        # 1. Try incremental sync if history_id is present
        if account.history_id:
            try:
                logger.info(f"Syncing Gmail account {account.email} incrementally from historyId {account.history_id}")
                history_resp = await http.get(
                    f"{GMAIL_API_BASE}/history",
                    params={
                        "startHistoryId": account.history_id,
                        "historyTypes": ["messageAdded"],
                        "maxResults": min(max_messages, 100),
                    },
                    headers={"Authorization": f"Bearer {access_token}"},
                )
                if history_resp.status_code == 200:
                    hist_data = history_resp.json()
                    new_history_id = hist_data.get("historyId")
                    message_ids = set()
                    for record in hist_data.get("history", []):
                        for added in record.get("messagesAdded", []):
                            msg = added.get("message")
                            if msg and msg.get("id"):
                                message_ids.add(msg["id"])

                    for msg_id in list(message_ids)[:max_messages]:
                        raw_msg = await fetch_gmail_message_detail(http, access_token, msg_id)
                        if raw_msg:
                            parsed = parse_gmail_message_data(raw_msg, account)
                            msg_model, _ = await upsert_email_message(session, parsed)
                            synced_messages.append(msg_model)

                    final_history_id = str(new_history_id) if new_history_id else account.history_id
                    if new_history_id:
                        account.history_id = final_history_id
                    account.status = "connected"
                    account.updated_at = datetime.now(UTC)
                    await session.commit()
                    return {
                        "status": "success",
                        "mode": "incremental",
                        "messages_synced": len(synced_messages),
                        "history_id": final_history_id,
                    }

                elif history_resp.status_code in (404, 400):
                    # History cursor expired - fall through to full resync
                    logger.warning(f"Gmail history cursor {account.history_id} expired for {account.email}. Falling back to full sync.")
                else:
                    raise GmailSyncError(f"History sync failed: {history_resp.status_code} {history_resp.text}")

            except GmailSyncError:
                raise
            except Exception as exc:
                logger.warning(f"Incremental sync error for {account.email}: {exc}. Triggering full sync.")

        # 2. Full synchronization fallback
        logger.info(f"Performing initial/full sync for Gmail account {account.email}")
        list_resp = await http.get(
            f"{GMAIL_API_BASE}/messages",
            params={"maxResults": min(max_messages, 50)},
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if list_resp.status_code != 200:
            raise GmailSyncError(f"Failed to list Gmail messages: {list_resp.text}")

        list_data = list_resp.json()
        messages_to_fetch = list_data.get("messages", [])

        # Fetch latest history ID from profile
        profile_resp = await http.get(
            f"{GMAIL_API_BASE}/profile",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if profile_resp.status_code == 200:
            account.history_id = str(profile_resp.json().get("historyId", ""))

        for item in messages_to_fetch[:max_messages]:
            msg_id = item["id"]
            raw_msg = await fetch_gmail_message_detail(http, access_token, msg_id)
            if raw_msg:
                parsed = parse_gmail_message_data(raw_msg, account)
                msg_model, _ = await upsert_email_message(session, parsed)
                synced_messages.append(msg_model)

        final_history_id = account.history_id
        account.status = "connected"
        account.updated_at = datetime.now(UTC)
        await session.commit()
        return {
            "status": "success",
            "mode": "full",
            "messages_synced": len(synced_messages),
            "history_id": final_history_id,
        }


async def send_gmail_reply(
    session: AsyncSession,
    account: GmailAccountModel,
    to_email: str,
    subject: str,
    body_text: str,
    thread_id: Optional[str] = None,
    in_reply_to_message_id: Optional[str] = None,
    references: Optional[str] = None,
) -> Dict[str, Any]:
    """Send an outbound email reply through the connected Gmail account using Gmail REST API."""
    access_token = await refresh_gmail_access_token(session, account)

    msg = MIMEMultipart("alternative")
    msg["To"] = to_email
    msg["From"] = account.email

    clean_subject = subject or "Re: Your message"
    if not clean_subject.lower().startswith("re:"):
        clean_subject = f"Re: {clean_subject}"
    msg["Subject"] = clean_subject

    if in_reply_to_message_id:
        msg["In-Reply-To"] = in_reply_to_message_id
        msg["References"] = references or in_reply_to_message_id

    text_part = MIMEText(body_text, "plain", "utf-8")
    msg.attach(text_part)

    raw_bytes = base64.urlsafe_b64encode(msg.as_bytes()).decode("utf-8")

    payload: Dict[str, Any] = {"raw": raw_bytes}
    if thread_id:
        payload["threadId"] = thread_id

    async with httpx.AsyncClient(timeout=30.0) as http:
        resp = await http.post(
            f"{GMAIL_API_BASE}/messages/send",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
        if resp.status_code not in (200, 201):
            logger.error(f"Gmail send error: {resp.status_code} {resp.text}")
            raise GmailSyncError(f"Failed to send Gmail reply: {resp.status_code} {resp.text}")

        data = resp.json()
        logger.info(f"Successfully sent Gmail reply to {to_email} (message_id={data.get('id')})")
        return {
            "status": "sent",
            "provider": "gmail",
            "message_id": data.get("id"),
            "thread_id": data.get("threadId"),
        }
