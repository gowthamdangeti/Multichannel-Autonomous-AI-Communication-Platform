"""Pydantic schemas for voice preview generation."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

VoicePreviewScope = Literal["global", "organization"]
# "sts" is the speech-to-speech (realtime) segment of the model-configuration UI.
VoicePreviewServiceType = Literal["tts", "sts"]


class VoicePreviewRequest(BaseModel):
    """Request to render (or fetch a cached) voice preview."""

    service_type: VoicePreviewServiceType
    provider: str = Field(..., description="Provider selected in the config form")
    voice: str = Field(..., description="Provider voice id to preview")
    model: str = Field(default="", description="Model selected in the config form")
    text: str | None = Field(
        default=None,
        description="Sample text. Ignored for global previews, which use the default sample.",
    )
    config: dict[str, Any] = Field(
        default_factory=dict,
        description="Service configuration blob as edited in the form (may carry masked keys).",
    )
    scope: VoicePreviewScope = Field(
        default="organization",
        description="'organization' stores a tenant preview; 'global' is superadmin-only.",
    )
    model_configuration_id: int | None = Field(
        default=None,
        description=(
            "Admin model preset being edited. Masked API keys in `config` are "
            "restored from this preset first (superadmin-only)."
        ),
    )


class VoicePreviewResponse(BaseModel):
    provider: str
    voice_id: str
    model: str
    service_type: str
    scope: str
    preview_url: str
    content_type: str
    byte_size: int
    render_ms: int | None = None
    cached: bool = False


class PresetVoicePreviewResponse(BaseModel):
    """Stored preview of a model preset's voice — no provider or key details."""

    voice: str | None = Field(default=None, description="Voice the preset speaks with")
    gender: str | None = Field(
        default=None, description="Gender of the preset voice: male, female or neutral"
    )
    preview_url: str | None = Field(
        default=None, description="Signed URL of the stored preview audio"
    )
    sample_text: str | None = Field(
        default=None, description="Sentence the preview audio speaks"
    )


class VoicePreviewCapabilitySchema(BaseModel):
    supported: bool
    preview_provider: str | None = None
    reason: str | None = None


class VoicePreviewCapabilitiesResponse(BaseModel):
    providers: dict[str, dict[str, VoicePreviewCapabilitySchema]] = Field(
        ...,
        description="Capability map keyed by service type ('tts', 'sts'), then provider.",
    )
    sample_texts: dict[str, str] = Field(
        default_factory=dict,
        description="Default preview sentence keyed by base language code ('en', 'ta').",
    )
    default_sample_language: str = Field(
        default="en",
        description="Language whose sample is used when the voice's language has none.",
    )
