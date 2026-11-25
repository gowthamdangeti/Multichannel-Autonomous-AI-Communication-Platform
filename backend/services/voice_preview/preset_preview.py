"""Stored voice preview for an admin model preset ("model stack").

Org users pick presets by name on the agent settings page; this resolves the
preset's voice to its stored preview so they can listen before choosing. A
preset saved before previews were auto-rendered gets its preview rendered once,
on first request, with the preset's own saved key.
"""

from __future__ import annotations

from loguru import logger
from pydantic import ValidationError

from api.db.platform_client import platform_client
from api.db.voice_preview_client import voice_preview_client
from api.schemas.ai_model_configuration import OrganizationAIModelConfigurationV2
from api.schemas.voice_preview import PresetVoicePreviewResponse, VoicePreviewRequest
from api.services.configuration.provider_catalog import voice_metadata
from api.services.storage import storage_fs
from api.services.voice_preview.auto_render import (
    list_configured_voices,
    list_preview_requests,
)
from api.services.voice_preview.capabilities import normalize_provider
from api.services.voice_preview.exceptions import (
    VoicePreviewRenderError,
    VoicePreviewRequestError,
    VoicePreviewUnsupportedError,
)
from api.services.voice_preview.preview_service import render_voice_preview


async def _get_voice_gender(*, provider: str, voice: str) -> str | None:
    """Admin catalog gender for the voice when set, else the provider's tables."""
    normalized = normalize_provider(provider)
    for entry in await platform_client.list_voices(active_only=False):
        if (
            normalize_provider(str(entry.provider)) == normalized
            and str(entry.voice_id).lower() == voice.lower()
            and entry.gender
        ):
            return str(entry.gender).lower()
    gender, _ = voice_metadata(provider, voice)
    if gender:
        return gender.lower()

    alias = {
        "azure_speech": "azure",
        "google_realtime": "google",
        "google_vertex_realtime": "google",
        "openai_realtime": "openai",
    }.get(normalized)
    if alias:
        gender, _ = voice_metadata(alias, voice)
        if gender:
            return gender.lower()

    return None


def extract_preset_gender_from_config(config: dict | None) -> str | None:
    """Extract voice gender saved directly in a preset configuration dict."""
    if not config or not isinstance(config, dict):
        return None

    def _clean(val: object) -> str | None:
        if isinstance(val, str) and val.strip():
            g = val.strip().lower()
            if g in {"female", "male", "neutral"}:
                return g
        return None

    # 1. BYOK mode
    byok = config.get("byok")
    if isinstance(byok, dict):
        pipeline = byok.get("pipeline")
        if isinstance(pipeline, dict):
            tts = pipeline.get("tts")
            if isinstance(tts, dict) and (g := _clean(tts.get("gender"))):
                return g
        realtime = byok.get("realtime")
        if isinstance(realtime, dict):
            rt = realtime.get("realtime")
            if isinstance(rt, dict) and (g := _clean(rt.get("gender"))):
                return g
            if g := _clean(realtime.get("gender")):
                return g

    # 2. Convozent managed mode
    convozent = config.get("convozent")
    if isinstance(convozent, dict):
        tts = convozent.get("tts")
        if isinstance(tts, dict) and (g := _clean(tts.get("gender"))):
            return g

    # 3. Flat / legacy shapes
    tts = config.get("tts")
    if isinstance(tts, dict) and (g := _clean(tts.get("gender"))):
        return g
    realtime = config.get("realtime")
    if isinstance(realtime, dict) and (g := _clean(realtime.get("gender"))):
        return g

    return None


async def resolve_preset_gender(preset: object) -> str | None:
    """Resolve gender for a preset from saved config, catalog, or voice metadata."""
    if not preset:
        return None

    config = (
        getattr(preset, "config", None)
        if not isinstance(preset, dict)
        else preset.get("config")
    )
    saved = extract_preset_gender_from_config(config)
    if saved:
        return saved

    voices = []
    if config:
        try:
            configuration = OrganizationAIModelConfigurationV2.model_validate(config)
            voices = list_configured_voices(configuration)
        except (ValidationError, ValueError):
            voices = []

    if voices:
        service_gender = getattr(voices[0], "gender", None) or getattr(
            getattr(voices[0], "service", None), "gender", None
        )
        if service_gender:
            cleaned = str(service_gender).strip().lower()
            if cleaned in {"female", "male", "neutral"}:
                return cleaned

        gender = await _get_voice_gender(
            provider=voices[0].provider, voice=voices[0].voice
        )
        if gender:
            return gender

    # Fallback to inspecting raw voice and provider from config
    if config and isinstance(config, dict):
        raw_voice = None
        raw_provider = None
        byok = config.get("byok")
        if isinstance(byok, dict):
            pipe = byok.get("pipeline")
            if isinstance(pipe, dict) and isinstance(pipe.get("tts"), dict):
                raw_voice = pipe["tts"].get("voice")
                raw_provider = pipe["tts"].get("provider")
        if raw_voice:
            gender = await _get_voice_gender(
                provider=str(raw_provider or ""), voice=str(raw_voice)
            )
            if gender:
                return gender

    return None


async def _find_stored_preview(
    request: VoicePreviewRequest, *, organization_id: int
) -> PresetVoicePreviewResponse | None:
    """Stored preview for the request's voice; an exact model match wins."""
    rows = await voice_preview_client.list_voice_previews_by_provider(
        provider=normalize_provider(request.provider),
        organization_id=organization_id,
    )
    voice_rows = [row for row in rows if str(row.voice_id) == request.voice]
    if not voice_rows:
        return None
    row = next((r for r in voice_rows if str(r.model) == request.model), voice_rows[0])
    url = await storage_fs.aget_signed_url(str(row.audio_key))
    if not url:
        return None
    return PresetVoicePreviewResponse(
        voice=request.voice, preview_url=url, sample_text=str(row.sample_text)
    )


async def _render_platform_preview(request: VoicePreviewRequest) -> None:
    """Render the preset voice as a platform preview; failures are logged."""
    try:
        await render_voice_preview(request=request, organization_id=None, user_id=None)
    except (
        VoicePreviewRequestError,
        VoicePreviewRenderError,
        VoicePreviewUnsupportedError,
    ) as exc:
        logger.warning(
            f"Preset voice preview render failed provider={request.provider} "
            f"voice={request.voice}: {exc}"
        )


async def get_preset_voice_preview(
    *, preset_id: int, organization_id: int
) -> PresetVoicePreviewResponse | None:
    """Preview of an active preset's voice, or None when the preset is unknown."""
    preset = await platform_client.get_model_configuration(preset_id)
    if preset is None or not preset.is_active:
        return None
    if not preset.config:
        return PresetVoicePreviewResponse()

    gender = await resolve_preset_gender(preset)

    try:
        configuration = OrganizationAIModelConfigurationV2.model_validate(preset.config)
        voices = list_configured_voices(configuration)
        requests = list_preview_requests(configuration, "global")
    except (ValidationError, ValueError) as exc:
        logger.warning(f"Preset {preset_id} config is invalid for previews: {exc}")
        return PresetVoicePreviewResponse(gender=gender)
    if not voices:
        return PresetVoicePreviewResponse(gender=gender)

    if not requests:
        return PresetVoicePreviewResponse(voice=voices[0].voice, gender=gender)

    request = requests[0]
    stored = await _find_stored_preview(request, organization_id=organization_id)
    if stored is None:
        await _render_platform_preview(request)
        stored = await _find_stored_preview(request, organization_id=organization_id)
    preview = stored or PresetVoicePreviewResponse(voice=request.voice)
    return preview.model_copy(update={"gender": gender})
