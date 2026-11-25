"""Per-organization budget for paid voice preview renders.

A fixed one-hour window in Redis, shared by every API worker and replica.
Only cache misses (real provider calls) are counted. When Redis is unreachable
the check fails open: previews are a convenience, not worth an outage.
"""

from __future__ import annotations

import redis.asyncio as aioredis
from loguru import logger
from redis.exceptions import RedisError

from api.constants import REDIS_URL, VOICE_PREVIEW_ORG_RENDERS_PER_HOUR
from api.services.voice_preview.exceptions import VoicePreviewRateLimitError

WINDOW_SECONDS = 3600

_redis: aioredis.Redis | None = None


def _get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(REDIS_URL, decode_responses=True)
    return _redis


def _window_key(organization_id: int) -> str:
    return f"voice_preview:renders:org:{organization_id}"


async def consume_render_budget(
    *, organization_id: int, limit: int = VOICE_PREVIEW_ORG_RENDERS_PER_HOUR
) -> None:
    """Count one render for the organization; raise once the hour's budget is spent."""
    key = _window_key(organization_id)
    try:
        redis = _get_redis()
        count = await redis.incr(key)
        if count == 1:
            await redis.expire(key, WINDOW_SECONDS)
        if count <= limit:
            return
        ttl = await redis.ttl(key)
    except (RedisError, OSError) as exc:
        logger.warning(f"Voice preview rate limit skipped (Redis unavailable): {exc}")
        return

    raise VoicePreviewRateLimitError(
        retry_after_seconds=ttl if ttl and ttl > 0 else WINDOW_SECONDS
    )
