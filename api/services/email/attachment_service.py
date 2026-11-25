"""Smart Filing and Attachment Management Service.

Handles downloading, validating, hashing, storing, and organizing email attachments
into S3/MinIO via storage_fs, and tracks metadata in EmailAttachmentModel.
"""

from __future__ import annotations

import base64
from datetime import datetime, UTC
import hashlib
import io
import os
import re
from typing import Any, Dict, List, Optional
import httpx
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.db.models import (
    EmailAttachmentModel,
    EmailMessageModel,
    GmailAccountModel,
    OutlookAccountModel,
)
from api.services.email.crypto import decrypt_token
from api.services.storage import storage_fs

MAX_ATTACHMENT_SIZE_BYTES = 25 * 1024 * 1024  # 25MB limit


def sanitize_filename(filename: str) -> str:
    """Sanitize filename to prevent directory traversal and illegal characters."""
    base = os.path.basename(filename)
    clean = re.sub(r'[^a-zA-Z0-9_.\-\(\)\s]', '_', base)
    clean = clean.strip()
    return clean or "unnamed_attachment"


class AttachmentService:
    """Service for managing, uploading, and retrieving email attachments."""

    def __init__(self, db: AsyncSession, organization_id: int):
        self.db = db
        self.organization_id = organization_id

    async def save_attachment(
        self,
        email_message_id: int,
        filename: str,
        content_bytes: bytes,
        content_type: Optional[str] = None,
    ) -> EmailAttachmentModel:
        """Validate, store, and record an email attachment."""
        file_size = len(content_bytes)
        if file_size > MAX_ATTACHMENT_SIZE_BYTES:
            raise ValueError(
                f"Attachment '{filename}' exceeds maximum allowed size of {MAX_ATTACHMENT_SIZE_BYTES} bytes ({file_size} bytes)"
            )

        clean_name = sanitize_filename(filename)
        sha256_hash = hashlib.sha256(content_bytes).hexdigest()

        # Check if already saved for this message to prevent duplicate storage
        stmt = (
            select(EmailAttachmentModel)
            .where(
                EmailAttachmentModel.organization_id == self.organization_id,
                EmailAttachmentModel.email_message_id == email_message_id,
                EmailAttachmentModel.filename == clean_name,
                EmailAttachmentModel.file_hash == sha256_hash,
            )
            .limit(1)
        )
        result = await self.db.execute(stmt)
        existing = result.scalar_one_or_none()
        if existing:
            return existing

        # Organized cloud storage path: email_attachments/org_{id}/{yyyy-mm}/{hash12}_{clean_name}
        now = datetime.now(UTC)
        date_prefix = now.strftime("%Y-%m")
        short_hash = sha256_hash[:12]
        storage_path = (
            f"email_attachments/org_{self.organization_id}/{date_prefix}/{short_hash}_{clean_name}"
        )

        # Upload binary stream to storage_fs
        stream = io.BytesIO(content_bytes)
        uploaded = await storage_fs.acreate_file(storage_path, stream)
        if not uploaded:
            logger.warning(
                f"storage_fs.acreate_file returned False for {storage_path}; setting is_uploaded=False"
            )

        attachment = EmailAttachmentModel(
            organization_id=self.organization_id,
            email_message_id=email_message_id,
            filename=clean_name,
            content_type=content_type or "application/octet-stream",
            file_size=file_size,
            storage_path=storage_path,
            file_hash=sha256_hash,
            is_uploaded=bool(uploaded),
        )
        self.db.add(attachment)
        await self.db.flush()
        return attachment

    async def fetch_and_save_gmail_attachment(
        self,
        account: GmailAccountModel,
        email_message: EmailMessageModel,
        attachment_id: str,
        filename: str,
        content_type: Optional[str] = None,
    ) -> EmailAttachmentModel:
        """Download an attachment from Gmail API and save it."""
        if account.organization_id != self.organization_id:
            raise PermissionError("Account does not belong to this organization")
        if email_message.organization_id != self.organization_id:
            raise PermissionError("Message does not belong to this organization")

        access_token = decrypt_token(account.access_token_encrypted)
        url = (
            f"https://gmail.googleapis.com/gmail/v1/users/me/messages/"
            f"{email_message.provider_message_id}/attachments/{attachment_id}"
        )

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                url,
                headers={"Authorization": f"Bearer {access_token}"},
            )
            resp.raise_for_status()
            data_json = resp.json()

        raw_data = data_json.get("data", "")
        # Gmail base64 urlsafe encoding
        content_bytes = base64.urlsafe_b64decode(raw_data.encode("utf-8") + b"==")

        return await self.save_attachment(
            email_message_id=email_message.id,
            filename=filename,
            content_bytes=content_bytes,
            content_type=content_type,
        )

    async def fetch_and_save_outlook_attachment(
        self,
        account: OutlookAccountModel,
        email_message: EmailMessageModel,
        attachment_id: str,
        filename: str,
        content_type: Optional[str] = None,
    ) -> EmailAttachmentModel:
        """Download an attachment from Microsoft Graph API and save it."""
        if account.organization_id != self.organization_id:
            raise PermissionError("Account does not belong to this organization")
        if email_message.organization_id != self.organization_id:
            raise PermissionError("Message does not belong to this organization")

        access_token = decrypt_token(account.access_token_encrypted)
        url = (
            f"https://graph.microsoft.com/v1.0/me/messages/"
            f"{email_message.provider_message_id}/attachments/{attachment_id}/$value"
        )

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                url,
                headers={"Authorization": f"Bearer {access_token}"},
            )
            resp.raise_for_status()
            content_bytes = resp.content

        return await self.save_attachment(
            email_message_id=email_message.id,
            filename=filename,
            content_bytes=content_bytes,
            content_type=content_type,
        )

    async def get_download_url(
        self, attachment_id: int, expiration_seconds: int = 3600
    ) -> Optional[str]:
        """Generate a presigned download URL for an authorized attachment."""
        stmt = (
            select(EmailAttachmentModel)
            .where(
                EmailAttachmentModel.id == attachment_id,
                EmailAttachmentModel.organization_id == self.organization_id,
            )
        )
        res = await self.db.execute(stmt)
        attachment = res.scalar_one_or_none()
        if not attachment:
            return None

        return await storage_fs.aget_signed_url(
            attachment.storage_path, expiration=expiration_seconds
        )

    async def list_message_attachments(
        self, email_message_id: int
    ) -> List[EmailAttachmentModel]:
        """List attachments for a specific email message."""
        stmt = (
            select(EmailAttachmentModel)
            .where(
                EmailAttachmentModel.organization_id == self.organization_id,
                EmailAttachmentModel.email_message_id == email_message_id,
            )
            .order_by(EmailAttachmentModel.created_at.asc())
        )
        res = await self.db.execute(stmt)
        return list(res.scalars().all())

