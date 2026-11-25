from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from api.services.configuration.registry import (
    ConvozentEmbeddingsConfiguration,
    ConvozentLLMService,
    ConvozentSTTService,
    ConvozentTTSService,
    EmbeddingsConfig,
    LLMConfig,
    RealtimeConfig,
    ServiceProviders,
    STTConfig,
    TTSConfig,
)

CONVOZENT_SPEED_OPTIONS: tuple[float, ...] = (0.8, 1.0, 1.2)
CONVOZENT_DEFAULT_VOICE = "default"
CONVOZENT_DEFAULT_LANGUAGE = "multi"


class EffectiveAIModelConfiguration(BaseModel):
    llm: LLMConfig | None = None
    stt: STTConfig | None = None
    tts: TTSConfig | None = None
    embeddings: EmbeddingsConfig | None = None
    realtime: RealtimeConfig | None = None
    is_realtime: bool = False
    managed_service_version: int | None = None
    test_phone_number: str | None = None
    timezone: str | None = None
    last_validated_at: datetime | None = None

    @model_validator(mode="before")
    @classmethod
    def strip_incomplete_realtime_when_disabled(cls, data):
        """Skip realtime validation when is_realtime is False and api_key is missing."""
        if isinstance(data, dict) and not data.get("is_realtime", False):
            realtime = data.get("realtime")
            if isinstance(realtime, dict) and not realtime.get("api_key"):
                data.pop("realtime", None)
        return data


class ConvozentManagedAIModelConfiguration(BaseModel):
    api_key: str
    voice: str = CONVOZENT_DEFAULT_VOICE
    speed: float = Field(default=1.0)
    language: str = CONVOZENT_DEFAULT_LANGUAGE

    @model_validator(mode="after")
    def validate_speed(self):
        if self.speed not in CONVOZENT_SPEED_OPTIONS:
            allowed = ", ".join(str(speed) for speed in CONVOZENT_SPEED_OPTIONS)
            raise ValueError(f"Convozent speed must be one of: {allowed}")
        return self


class BYOKPipelineAIModelConfiguration(BaseModel):
    llm: LLMConfig
    tts: TTSConfig
    stt: STTConfig
    embeddings: EmbeddingsConfig | None = None

    @model_validator(mode="after")
    def reject_convozent_providers(self):
        _reject_convozent_provider("llm", self.llm)
        _reject_convozent_provider("tts", self.tts)
        _reject_convozent_provider("stt", self.stt)
        _reject_convozent_provider("embeddings", self.embeddings)
        return self


class BYOKRealtimeAIModelConfiguration(BaseModel):
    realtime: RealtimeConfig
    llm: LLMConfig
    embeddings: EmbeddingsConfig | None = None

    @model_validator(mode="after")
    def reject_convozent_providers(self):
        _reject_convozent_provider("llm", self.llm)
        _reject_convozent_provider("embeddings", self.embeddings)
        return self


class BYOKAIModelConfiguration(BaseModel):
    mode: Literal["pipeline", "realtime"]
    pipeline: BYOKPipelineAIModelConfiguration | None = None
    realtime: BYOKRealtimeAIModelConfiguration | None = None

    @model_validator(mode="after")
    def validate_selected_mode(self):
        if self.mode == "pipeline" and self.pipeline is None:
            raise ValueError("byok.pipeline is required when byok.mode is pipeline")
        if self.mode == "realtime" and self.realtime is None:
            raise ValueError("byok.realtime is required when byok.mode is realtime")
        return self


# Voice preview sentence saved per voice service, so reopening a configuration
# shows the sentence that was last typed. The preview renderer uses this same
# limit (api/services/voice_preview/sample_text.py).
VoicePreviewTextService = Literal["tts", "realtime"]
MAX_VOICE_PREVIEW_TEXT_CHARS = 500


class OrganizationAIModelConfigurationV2(BaseModel):
    version: Literal[2] = 2
    mode: Literal["convozent", "byok"]
    convozent: ConvozentManagedAIModelConfiguration | None = None
    byok: BYOKAIModelConfiguration | None = None
    voice_preview_texts: dict[VoicePreviewTextService, str] | None = Field(
        default=None,
        description=(
            "Preview sentence typed per voice service ('tts', 'realtime'). "
            "Editor-only: never used when running calls."
        ),
    )

    @model_validator(mode="after")
    def clean_voice_preview_texts(self):
        if self.voice_preview_texts is not None:
            cleaned = {
                service: text.strip()[:MAX_VOICE_PREVIEW_TEXT_CHARS]
                for service, text in self.voice_preview_texts.items()
                if text and text.strip()
            }
            self.voice_preview_texts = cleaned or None
        return self

    @model_validator(mode="after")
    def validate_selected_mode(self):
        if self.mode == "convozent" and self.convozent is None:
            raise ValueError(
                "convozent configuration is required when mode is convozent"
            )
        if self.mode == "byok" and self.byok is None:
            raise ValueError("byok configuration is required when mode is byok")
        return self


class OrganizationAIModelConfigurationResponse(BaseModel):
    configuration: dict | None
    effective_configuration: dict
    source: Literal[
        "platform_org",
        "platform_global",
        "organization_v2",
        "legacy_user_v1",
        "empty",
    ]
    # True when the model/keys are managed by the super-admin platform layer.
    # The UI uses this to render a read-only "Managed by platform" state.
    managed: bool = False


def compile_ai_model_configuration_v2(
    configuration: OrganizationAIModelConfigurationV2,
) -> EffectiveAIModelConfiguration:
    if configuration.mode == "convozent":
        # Managed model services have been removed. Any legacy "convozent" (hosted)
        # config now compiles to an empty configuration so the org is treated as
        # unconfigured and must supply its own provider keys (BYOK).
        return EffectiveAIModelConfiguration()

    if configuration.byok is None:
        raise ValueError("byok configuration is required")
    if configuration.byok.mode == "pipeline":
        if configuration.byok.pipeline is None:
            raise ValueError("byok.pipeline is required")
        pipeline = configuration.byok.pipeline
        return EffectiveAIModelConfiguration(
            llm=pipeline.llm,
            tts=pipeline.tts,
            stt=pipeline.stt,
            embeddings=pipeline.embeddings,
            is_realtime=False,
        )

    if configuration.byok.realtime is None:
        raise ValueError("byok.realtime is required")
    realtime = configuration.byok.realtime
    return EffectiveAIModelConfiguration(
        llm=realtime.llm,
        realtime=realtime.realtime,
        embeddings=realtime.embeddings,
        is_realtime=True,
    )


def _compile_convozent_configuration(
    configuration: ConvozentManagedAIModelConfiguration,
) -> EffectiveAIModelConfiguration:
    return EffectiveAIModelConfiguration(
        llm=ConvozentLLMService(
            provider=ServiceProviders.CONVOZENT,
            api_key=configuration.api_key,
            model="default",
        ),
        tts=ConvozentTTSService(
            provider=ServiceProviders.CONVOZENT,
            api_key=configuration.api_key,
            model="default",
            voice=configuration.voice,
            speed=configuration.speed,
        ),
        stt=ConvozentSTTService(
            provider=ServiceProviders.CONVOZENT,
            api_key=configuration.api_key,
            model="default",
            language=configuration.language,
        ),
        embeddings=ConvozentEmbeddingsConfiguration(
            provider=ServiceProviders.CONVOZENT,
            api_key=configuration.api_key,
            model="default",
        ),
        is_realtime=False,
        managed_service_version=2,
    )


def _reject_convozent_provider(section: str, service) -> None:
    if service is None:
        return
    if getattr(service, "provider", None) == ServiceProviders.CONVOZENT:
        raise ValueError(f"BYOK {section} cannot use Convozent provider")
