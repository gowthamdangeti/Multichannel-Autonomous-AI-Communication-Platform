"""The model list one provider shows in the picker: live if stored, else in code."""

from __future__ import annotations

from dataclasses import dataclass

from api.services.configuration.model_sync.store import LiveModel, get_live_models
from api.services.configuration.registry import REGISTRY, ServiceType

SOURCE_LIVE = "live"
SOURCE_STATIC = "static"

_SERVICE_TYPES = {
    "llm": ServiceType.LLM,
    "stt": ServiceType.STT,
    "tts": ServiceType.TTS,
    "realtime": ServiceType.REALTIME,
}


@dataclass(frozen=True)
class ModelOption:
    model_id: str
    name: str
    is_deprecated: bool = False


@dataclass(frozen=True)
class ProviderModels:
    source: str
    default: str | None
    models: list[ModelOption]


def _model_property(*, provider: str, capability: str) -> dict | None:
    """The ``model`` field of a provider's config schema."""
    for name, config_class in REGISTRY[_SERVICE_TYPES[capability]].items():
        if str(getattr(name, "value", name)) == provider:
            return (config_class.model_json_schema().get("properties") or {}).get("model")
    raise ValueError(f"{provider} does not offer {capability}")


def _static_model_ids(prop: dict | None) -> list[str]:
    if not prop:
        return []
    values = prop.get("enum") or prop.get("examples") or []
    ids = [str(value) for value in values]
    default = prop.get("default")
    if default is not None and str(default) not in ids:
        ids.append(str(default))
    return ids


def merge_models(
    *, live: list[LiveModel], static_ids: list[str], default: str | None
) -> ProviderModels:
    """Live models win. The default stays, or new agents couldn't be created."""
    active = [model for model in live if model.is_active]
    if not active:
        return ProviderModels(
            source=SOURCE_STATIC,
            default=default,
            models=[ModelOption(model_id, model_id) for model_id in static_ids],
        )
    options = [ModelOption(m.model_id, m.display_name or m.model_id) for m in active]
    options += [
        ModelOption(m.model_id, m.display_name or m.model_id, is_deprecated=True)
        for m in live
        if not m.is_active
    ]
    if default and all(option.model_id != default for option in options):
        options.append(ModelOption(default, default))
    return ProviderModels(source=SOURCE_LIVE, default=default, models=options)


async def list_provider_models(*, provider: str, capability: str) -> ProviderModels:
    """Raises ValueError for a provider that doesn't offer ``capability``."""
    prop = _model_property(provider=provider, capability=capability)
    default = str(prop["default"]) if prop and prop.get("default") is not None else None
    return merge_models(
        live=await get_live_models(provider=provider, capability=capability),
        static_ids=_static_model_ids(prop),
        default=default,
    )
