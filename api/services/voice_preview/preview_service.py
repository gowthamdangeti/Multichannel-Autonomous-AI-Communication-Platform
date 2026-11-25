"""Render and cache TTS voice previews.

The preview is synthesized through the same provider implementations as live
calls (``api/services/audio_providers``), normalized to MP3, stored in the audio
bucket, and cached by ``(provider, voice, model, text)`` so repeated listens —
in the model-configuration page and in every workflow voice picker — cost
nothing.
"""

from __future__ import annotations

import asyncio
import hashlib
import re
import time

from loguru import logger

from api.db.voice_preview_client import VoicePreviewUpsert, voice_preview_client
from api.schemas.voice_preview import VoicePreviewRequest
from api.services.audio_providers.base import (
    ProviderConfigurationError,
    ProviderExecutionError,
)
from api.services.audio_providers.registry import get_tts_provider
from api.services.configuration.registry import BaseServiceConfiguration
from api.services.storage import storage_fs
from api.services.voice_preview.artifact_store import store_preview_audio
from api.services.voice_preview.audio_transcode import normalize_preview_audio
from api.services.voice_preview.capabilities import (
    get_preview_capability,
    normalize_provider,
)
from api.services.voice_preview.credentials import resolve_api_key
from api.services.voice_preview.exceptions import (
    VoicePreviewRenderError,
    VoicePreviewRequestError,
    VoicePreviewUnsupportedError,
)
from api.services.voice_preview.rate_limit import consume_render_budget
from api.services.voice_preview.renderer import (
    build_tts_request,
    compile_preview_config,
)
from api.services.voice_preview.sample_text import normalize_preview_text

# Bounds concurrent renders per worker process; renders are user-triggered and
# only need to stop bursts from fanning out into provider calls.
_RENDER_SEMAPHORE = asyncio.Semaphore(4)

_UNSAFE_PATH_CHARS = re.compile(r"[^A-Za-z0-9._-]+")


class VoicePreviewResult:
    """A rendered (or cache-hit) preview, ready to serialize."""

    def __init__(
        self,
        *,
        provider: str,
        voice_id: str,
        model: str,
        service_type: str,
        scope: str,
        preview_url: str,
        content_type: str,
        byte_size: int,
        render_ms: int | None,
        cached: bool,
    ):
        self.provider = provider
        self.voice_id = voice_id
        self.model = model
        self.service_type = service_type
        self.scope = scope
        self.preview_url = preview_url
        self.content_type = content_type
        self.byte_size = byte_size
        self.render_ms = render_ms
        self.cached = cached


def _text_hash(
    *, provider: str, service_type: str, model: str, voice: str, speed: float, text: str
) -> str:
    payload = f"{service_type}|{provider}|{model}|{voice}|{speed}|{text}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _safe_path_part(value: str) -> str:
    return _UNSAFE_PATH_CHARS.sub("_", value or "unknown")[:64]


def _audio_key(
    *,
    scope: str,
    organization_id: int | None,
    provider: str,
    voice: str,
    text_hash: str,
    extension: str,
) -> str:
    """Object key of a preview; tenant audio lives under its own organization."""
    owner = f"{scope}/{organization_id}" if organization_id is not None else scope
    return (
        f"voice-previews/{owner}/{_safe_path_part(provider)}/"
        f"{_safe_path_part(voice)}/{text_hash}.{extension}"
    )


def _is_same_cache_row(row, *, scope: str, organization_id: int | None) -> bool:
    """Whether `row` is the row this render upserts (not a visible platform row)."""
    return str(row.scope) == scope and row.organization_id == organization_id


async def _delete_replaced_audio(*, old_key: str, new_key: str) -> None:
    """Delete a replaced audio object unless another row still uses it."""
    if old_key == new_key:
        return
    if await voice_preview_client.is_audio_key_referenced(audio_key=old_key):
        return
    if not await storage_fs.adelete_file(old_key):
        logger.warning(f"Could not delete replaced voice preview audio {old_key}")


async def _synthesize(
    *,
    preview_provider: str,
    service_type: str,
    config: BaseServiceConfiguration,
    api_key: str,
    text: str,
) -> bytes:
    provider_instance = get_tts_provider(preview_provider)
    if provider_instance is None:
        raise VoicePreviewUnsupportedError(preview_provider, service_type)

    request = build_tts_request(config=config, api_key=api_key, text=text)
    started = time.perf_counter()
    try:
        audio = await provider_instance.synthesize(request)
    except ProviderConfigurationError as exc:
        raise VoicePreviewRequestError(exc.message) from exc
    except ProviderExecutionError as exc:
        raise VoicePreviewRenderError.from_provider_error(
            preview_provider, exc
        ) from exc
    except Exception as exc:  # pragma: no cover - defensive around vendor SDKs
        raise VoicePreviewRenderError(preview_provider, str(exc)) from exc
    finally:
        logger.info(
            f"Voice preview render provider={preview_provider} "
            f"ms={int((time.perf_counter() - started) * 1000)}"
        )

    if not audio:
        raise VoicePreviewRenderError(preview_provider, "Synthesized audio is empty.")
    return audio


def _cached_result(row, preview_url: str) -> VoicePreviewResult:
    return VoicePreviewResult(
        provider=row.provider,
        voice_id=row.voice_id,
        model=row.model,
        service_type=row.service_type,
        scope=row.scope,
        preview_url=preview_url,
        content_type=row.content_type,
        byte_size=row.byte_size,
        render_ms=row.render_ms,
        cached=True,
    )


async def render_voice_preview(
    *,
    request: VoicePreviewRequest,
    organization_id: int | None,
    user_id: int | None,
) -> VoicePreviewResult:
    """Render (or return the cached) preview for one provider voice."""
    capability = get_preview_capability(
        service_type=request.service_type, provider=request.provider
    )
    if not capability.supported or capability.preview_provider is None:
        raise VoicePreviewUnsupportedError(request.provider, request.service_type)

    provider = normalize_provider(request.provider)
    preview_provider = capability.preview_provider
    scope_organization_id = organization_id if request.scope == "organization" else None

    config = compile_preview_config(
        service_type=request.service_type,
        provider=provider,
        raw_config=request.config,
    )
    voice = (request.voice or "").strip()
    if not voice:
        raise VoicePreviewRequestError("Select a voice before generating a preview.")
    model = getattr(config, "model", None) or request.model or ""
    speed = float(getattr(config, "speed", 1.0) or 1.0)

    text = normalize_preview_text(
        request.text,
        use_custom_text=request.scope == "organization",
        language=getattr(config, "language", None),
    )
    text_hash = _text_hash(
        provider=provider,
        service_type=request.service_type,
        model=model,
        voice=voice,
        speed=speed,
        text=text,
    )

    cached_row = await voice_preview_client.get_voice_preview(
        provider=provider,
        voice_id=voice,
        model=model,
        text_hash=text_hash,
        organization_id=scope_organization_id,
    )
    if cached_row is not None:
        preview_url = await storage_fs.aget_signed_url(str(cached_row.audio_key))
        if preview_url:
            return _cached_result(cached_row, preview_url)
        logger.warning(
            f"Voice preview cache row {cached_row.id} has no reachable audio; "
            "re-rendering."
        )

    # Cache miss: this is a paid provider call. Tenant renders are budgeted;
    # platform renders are superadmin/save-triggered and bounded by the cache.
    if scope_organization_id is not None:
        await consume_render_budget(organization_id=scope_organization_id)

    api_key = await resolve_api_key(
        service_type=request.service_type,
        provider=provider,
        preview_provider=preview_provider,
        config=config,
        organization_id=scope_organization_id,
        user_id=user_id,
        model_configuration_id=request.model_configuration_id,
    )

    async with _RENDER_SEMAPHORE:
        started = time.perf_counter()
        raw_audio = await _synthesize(
            preview_provider=preview_provider,
            service_type=request.service_type,
            config=config,
            api_key=api_key,
            text=text,
        )
        audio = await normalize_preview_audio(raw_audio)
        render_ms = int((time.perf_counter() - started) * 1000)

        audio_key = _audio_key(
            scope=request.scope,
            organization_id=scope_organization_id,
            provider=provider,
            voice=voice,
            text_hash=text_hash,
            extension=audio.extension,
        )
        await store_preview_audio(audio_key=audio_key, data=audio.data)

    await voice_preview_client.upsert_voice_preview(
        data=VoicePreviewUpsert(
            scope=request.scope,
            service_type=request.service_type,
            provider=provider,
            model=model,
            voice_id=voice,
            text_hash=text_hash,
            sample_text=text,
            audio_key=audio_key,
            content_type=audio.content_type,
            byte_size=len(audio.data),
            render_ms=render_ms,
            created_by_user_id=user_id,
        ),
        organization_id=scope_organization_id,
    )
    # A re-render of this same row replaced its audio: drop the old object.
    if cached_row is not None and _is_same_cache_row(
        cached_row, scope=request.scope, organization_id=scope_organization_id
    ):
        await _delete_replaced_audio(
            old_key=str(cached_row.audio_key), new_key=audio_key
        )

    preview_url = await storage_fs.aget_signed_url(audio_key)
    if not preview_url:
        raise VoicePreviewRenderError(
            preview_provider, f"Could not produce a URL for {audio_key}"
        )

    logger.info(
        f"Voice preview stored provider={provider} preview_provider={preview_provider} "
        f"voice={voice} scope={request.scope} bytes={len(audio.data)} ms={render_ms}"
    )
    return VoicePreviewResult(
        provider=provider,
        voice_id=voice,
        model=model,
        service_type=request.service_type,
        scope=request.scope,
        preview_url=preview_url,
        content_type=audio.content_type,
        byte_size=len(audio.data),
        render_ms=render_ms,
        cached=False,
    )
