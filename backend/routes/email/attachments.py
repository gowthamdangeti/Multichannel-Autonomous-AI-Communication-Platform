"""FastAPI Smart Filing and Attachment Management Routes."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select, desc

from api.db import db_client
from api.db.models import EmailAttachmentModel, UserModel
from api.services.auth.depends import get_user
from api.services.email.attachment_service import AttachmentService

router = APIRouter(prefix="/attachments", tags=["email-attachments"])


def _require_org(user: UserModel) -> int:
    if not user.selected_organization_id:
        raise HTTPException(status_code=400, detail="No organization selected")
    return user.selected_organization_id


class AttachmentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email_message_id: int
    message_id: Optional[int] = None
    filename: str
    content_type: Optional[str] = None
    file_size: int
    size_bytes: Optional[int] = None
    storage_path: str
    file_hash: Optional[str] = None
    is_uploaded: bool
    created_at: Optional[datetime] = None
    message_subject: Optional[str] = None
    message_sender: Optional[str] = None


class DownloadUrlResponse(BaseModel):
    attachment_id: int
    filename: str
    download_url: str
    expires_in_seconds: int


@router.get("", response_model=List[AttachmentResponse])
async def list_attachments(
    message_id: Annotated[Optional[int], Query(description="Filter by email message ID")] = None,
    extension: Annotated[Optional[str], Query(description="Filter by file extension (e.g. pdf, png)")] = None,
    content_type: Annotated[Optional[str], Query(description="Filter by content type substring")] = None,
    search: Annotated[Optional[str], Query(description="Keyword search in filename")] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    user: UserModel = Depends(get_user),
) -> List[AttachmentResponse]:
    """List attachments filed for the organization with search and extension filters."""
    org_id = _require_org(user)

    async with db_client.async_session() as session:
        filters = [EmailAttachmentModel.organization_id == org_id]
        if message_id:
            filters.append(EmailAttachmentModel.email_message_id == message_id)
        if extension:
            ext = extension.lower().lstrip(".")
            filters.append(EmailAttachmentModel.filename.ilike(f"%.{ext}"))
        if content_type:
            filters.append(EmailAttachmentModel.content_type.ilike(f"%{content_type}%"))
        if search:
            filters.append(EmailAttachmentModel.filename.ilike(f"%{search.strip()}%"))

        stmt = (
            select(EmailAttachmentModel)
            .where(*filters)
            .order_by(desc(EmailAttachmentModel.created_at))
            .limit(limit)
            .offset(offset)
        )
        res = await session.execute(stmt)
        attachments = list(res.scalars().all())

    return [
        AttachmentResponse(
            id=a.id,
            email_message_id=a.email_message_id,
            message_id=a.email_message_id,
            filename=a.filename,
            content_type=a.content_type,
            file_size=a.file_size,
            size_bytes=a.file_size,
            storage_path=a.storage_path,
            file_hash=a.file_hash,
            is_uploaded=a.is_uploaded,
            created_at=a.created_at,
        )
        for a in attachments
    ]


@router.get("/{attachment_id}/download", response_model=DownloadUrlResponse)
async def get_attachment_download_url(
    attachment_id: int,
    expiration: Annotated[int, Query(ge=60, le=86400, description="Signed URL expiration in seconds")] = 3600,
    user: UserModel = Depends(get_user),
) -> DownloadUrlResponse:
    """Generate a presigned secure download URL for an attachment."""
    org_id = _require_org(user)

    async with db_client.async_session() as session:
        service = AttachmentService(db=session, organization_id=org_id)
        # Verify ownership and get attachment record
        stmt = select(EmailAttachmentModel).where(
            EmailAttachmentModel.id == attachment_id,
            EmailAttachmentModel.organization_id == org_id,
        )
        res = await session.execute(stmt)
        attachment = res.scalar_one_or_none()
        if not attachment:
            raise HTTPException(status_code=404, detail="Attachment not found")

        signed_url = await service.get_download_url(attachment_id, expiration_seconds=expiration)
        if not signed_url:
            raise HTTPException(status_code=500, detail="Failed to generate download URL from storage")

        return DownloadUrlResponse(
            attachment_id=attachment.id,
            filename=attachment.filename,
            download_url=signed_url,
            expires_in_seconds=expiration,
        )
