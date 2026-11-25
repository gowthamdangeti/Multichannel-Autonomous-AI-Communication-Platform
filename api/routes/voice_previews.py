"""Voice preview routes.

Generates the short TTS sample shown next to a voice in the model-configuration
page and reused by the workflow voice pickers. Platform-scoped previews are
superadmin-only and always use the neutral default sample text.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from loguru import logger

from api.db.models import UserModel
from api.schemas.voice_preview import (
    VoicePreviewCapabilitiesResponse,
    VoicePreviewCapabilitySchema,
    VoicePreviewRequest,
    VoicePreviewResponse,
)
from api.services.auth.depends import get_user
from api.services.voice_preview.capabilities import list_preview_capabilities
from api.services.voice_preview.exceptions import (
    VoicePreviewRateLimitError,
    VoicePreviewRenderError,
    VoicePreviewRequestError,
    VoicePreviewUnsupportedError,
)
from api.services.voice_preview.preview_service import render_voice_preview
from api.services.voice_preview.sample_text import (
    DEFAULT_SAMPLE_LANGUAGE,
    PREVIEW_SAMPLE_TEXTS,
)

router = APIRouter(tags=["voice-previews"])


def _require_scope_access(*, user: UserModel, scope: str) -> int | None:
    """Return the organization to scope the write to, or raise for forbidden scopes."""
    if scope == "global":
        if not user.is_superuser:
            raise HTTPException(
                status_code=403,
                detail="Only platform administrators can create global voice previews.",
            )
        return None
    if not user.selected_organization_id:
        raise HTTPException(
            status_code=400,
            detail="No organization selected",
        )
    return int(user.selected_organization_id)


@router.get(
    "/voice-previews/capabilities",
    response_model=VoicePreviewCapabilitiesResponse,
)
async def get_voice_preview_capabilities(
    user: UserModel = Depends(get_user),
) -> VoicePreviewCapabilitiesResponse:
    """Providers that can render a preview, and through which engine."""
    capabilities = list_preview_capabilities()
    return VoicePreviewCapabilitiesResponse(
        providers={
            service_type: {
                provider: VoicePreviewCapabilitySchema(
                    supported=capability.supported,
                    preview_provider=capability.preview_provider,
                    reason=capability.reason,
                )
                for provider, capability in providers.items()
            }
            for service_type, providers in capabilities.items()
        },
        sample_texts=PREVIEW_SAMPLE_TEXTS,
        default_sample_language=DEFAULT_SAMPLE_LANGUAGE,
    )


@router.post("/voice-previews", response_model=VoicePreviewResponse)
async def create_voice_preview(
    request: VoicePreviewRequest,
    user: UserModel = Depends(get_user),
) -> VoicePreviewResponse:
    """Render a preview for one provider voice, or return the cached one."""
    organization_id = _require_scope_access(user=user, scope=request.scope)
    if request.model_configuration_id is not None and not user.is_superuser:
        raise HTTPException(
            status_code=403,
            detail="Only platform administrators can preview with a model preset's key.",
        )

    try:
        result = await render_voice_preview(
            request=request,
            organization_id=organization_id,
            user_id=int(user.id),
        )
    except VoicePreviewUnsupportedError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except VoicePreviewRateLimitError as exc:
        raise HTTPException(
            status_code=429,
            detail=exc.message,
            headers={"Retry-After": str(exc.retry_after_seconds)},
        ) from exc
    except VoicePreviewRequestError as exc:
        raise HTTPException(status_code=400, detail=exc.message) from exc
    except VoicePreviewRenderError as exc:
        logger.error(f"Voice preview render failed: {exc}")
        # 424, not 502: Cloudflare replaces origin 502 responses with its own
        # "Bad gateway" page, hiding the provider's message from the user.
        raise HTTPException(status_code=424, detail=exc.message) from exc

    logger.info(
        f"Voice preview ready user_id={user.id} organization_id={organization_id} "
        f"provider={result.provider} voice={result.voice_id} cached={result.cached}"
    )
    return VoicePreviewResponse(
        provider=result.provider,
        voice_id=result.voice_id,
        model=result.model,
        service_type=result.service_type,
        scope=result.scope,
        preview_url=result.preview_url,
        content_type=result.content_type,
        byte_size=result.byte_size,
        render_ms=result.render_ms,
        cached=result.cached,
    )
