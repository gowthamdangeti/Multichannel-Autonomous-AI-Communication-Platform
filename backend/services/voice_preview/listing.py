"""Look up stored preview URLs for provider voice lists."""

from __future__ import annotations

from loguru import logger

from api.db.voice_preview_client import voice_preview_client
from api.services.storage import storage_fs
from api.services.voice_preview.capabilities import normalize_provider


async def get_voice_preview_urls(
    *, provider: str, organization_id: int | None
) -> dict[str, str]:
    """Map ``voice_id`` to a playable preview URL for one provider.

    Tenant previews win over platform previews; voices without a generated
    preview are simply absent from the result.
    """
    normalized = normalize_provider(provider)
    if not normalized:
        return {}

    rows = await voice_preview_client.list_voice_previews_by_provider(
        provider=normalized, organization_id=organization_id
    )

    urls: dict[str, str] = {}
    for row in rows:
        voice_id = str(row.voice_id)
        if voice_id in urls:
            continue
        url = await storage_fs.aget_signed_url(str(row.audio_key))
        if url:
            urls[voice_id] = url
    logger.debug(f"Voice previews available provider={normalized} count={len(urls)}")
    return urls
