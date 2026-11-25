"""DB client for generated voice previews (``voice_previews`` table).

Platform-curated previews live in rows with ``organization_id IS NULL``; tenant
previews live in rows carrying the organization that rendered them. Every
lookup prefers the tenant row and falls back to the platform row.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import and_, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from api.db.base_client import BaseDBClient
from api.db.models import VoicePreviewModel


@dataclass(frozen=True)
class VoicePreviewUpsert:
    """Values needed to cache one rendered preview."""

    scope: str
    service_type: str
    provider: str
    model: str
    voice_id: str
    text_hash: str
    sample_text: str
    audio_key: str
    content_type: str
    byte_size: int
    render_ms: int | None = None
    created_by_user_id: int | None = None


class VoicePreviewClient(BaseDBClient):
    async def get_voice_preview(
        self,
        *,
        provider: str,
        voice_id: str,
        model: str,
        text_hash: str,
        organization_id: int | None,
    ) -> VoicePreviewModel | None:
        """Return the cached preview for this render key, tenant row first.

        A platform lookup (``organization_id=None``) sees platform rows only, so
        it can never return — or be satisfied by — another tenant's row.
        """
        visibility = VoicePreviewModel.scope == "global"
        if organization_id is not None:
            visibility = or_(
                visibility, VoicePreviewModel.organization_id == organization_id
            )
        conditions = [
            VoicePreviewModel.provider == provider,
            VoicePreviewModel.voice_id == voice_id,
            VoicePreviewModel.model == model,
            VoicePreviewModel.text_hash == text_hash,
            visibility,
        ]
        async with self.async_session() as session:
            result = await session.execute(
                select(VoicePreviewModel)
                .where(and_(*conditions))
                .order_by(VoicePreviewModel.scope.desc())
                .limit(1)
            )
            return result.scalar_one_or_none()

    async def list_voice_previews_by_provider(
        self,
        *,
        provider: str,
        organization_id: int | None,
    ) -> list[VoicePreviewModel]:
        """Return every preview for a provider visible to this organization.

        Tenant rows come first so callers can key by ``voice_id`` and let the
        first row win.
        """
        visibility = VoicePreviewModel.scope == "global"
        if organization_id is not None:
            visibility = or_(
                visibility, VoicePreviewModel.organization_id == organization_id
            )
        async with self.async_session() as session:
            result = await session.execute(
                select(VoicePreviewModel)
                .where(and_(VoicePreviewModel.provider == provider, visibility))
                .order_by(
                    VoicePreviewModel.scope.desc(), VoicePreviewModel.updated_at.desc()
                )
            )
            return list(result.scalars().all())

    async def is_audio_key_referenced(self, *, audio_key: str) -> bool:
        """Whether any preview row still points at this stored object."""
        async with self.async_session() as session:
            result = await session.execute(
                select(VoicePreviewModel.id)
                .where(VoicePreviewModel.audio_key == audio_key)
                .limit(1)
            )
            return result.first() is not None

    async def upsert_voice_preview(
        self,
        *,
        data: VoicePreviewUpsert,
        organization_id: int | None,
    ) -> VoicePreviewModel:
        """Insert or refresh the cached row for one render key."""
        values = {
            "scope": data.scope,
            "organization_id": organization_id,
            "service_type": data.service_type,
            "provider": data.provider,
            "model": data.model,
            "voice_id": data.voice_id,
            "text_hash": data.text_hash,
            "sample_text": data.sample_text,
            "audio_key": data.audio_key,
            "content_type": data.content_type,
            "byte_size": data.byte_size,
            "render_ms": data.render_ms,
            "created_by_user_id": data.created_by_user_id,
            "created_at": datetime.now(UTC),
            "updated_at": datetime.now(UTC),
        }
        statement = (
            pg_insert(VoicePreviewModel)
            .values(**values)
            .on_conflict_do_update(
                constraint="uq_voice_previews_cache_key",
                set_={
                    "sample_text": values["sample_text"],
                    "audio_key": values["audio_key"],
                    "content_type": values["content_type"],
                    "byte_size": values["byte_size"],
                    "render_ms": values["render_ms"],
                    "updated_at": values["updated_at"],
                },
            )
            .returning(VoicePreviewModel)
        )
        async with self.async_session() as session:
            result = await session.execute(statement)
            row = result.scalar_one()
            await session.commit()
            return row


voice_preview_client = VoicePreviewClient()
