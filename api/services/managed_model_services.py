from __future__ import annotations

from typing import Any

from api.schemas.ai_model_configuration import EffectiveAIModelConfiguration
from api.services.configuration.registry import ServiceProviders

MPS_CORRELATION_ID_CONTEXT_KEY = "mps_correlation_id"


def uses_managed_model_services_v2(
    ai_model_config: EffectiveAIModelConfiguration | None,
) -> bool:
    # Managed model services have been removed. This always reports "not managed"
    # so the quota / MPS-billing / correlation scaffolding stays inert (no config
    # resolves to the hosted provider anymore).
    return False


def get_mps_correlation_id(initial_context: dict[str, Any] | None) -> str | None:
    if not initial_context:
        return None
    correlation_id = initial_context.get(MPS_CORRELATION_ID_CONTEXT_KEY)
    if correlation_id is None:
        return None
    return str(correlation_id)


async def ensure_mps_correlation_id(
    *,
    ai_model_config: EffectiveAIModelConfiguration,
    workflow_run_id: int,
    initial_context: dict[str, Any] | None,
) -> str | None:
    existing = get_mps_correlation_id(initial_context)
    if existing:
        return existing

    if not uses_managed_model_services_v2(ai_model_config):
        return None

    raise ValueError(
        "Managed model services v2 requires workflow run authorization before "
        f"the run starts. Missing correlation id for workflow_run_id={workflow_run_id}."
    )


def _is_convozent_service(service: Any) -> bool:
    provider = getattr(service, "provider", None)
    return (
        provider == ServiceProviders.CONVOZENT or provider == ServiceProviders.CONVOZENT.value
    )


def get_convozent_service_api_key(
    ai_model_config: EffectiveAIModelConfiguration,
) -> str | None:
    for section_name in ("llm", "tts", "stt", "embeddings"):
        service = getattr(ai_model_config, section_name, None)
        if not _is_convozent_service(service):
            continue

        if hasattr(service, "get_all_api_keys"):
            keys = service.get_all_api_keys()
            if keys:
                return keys[0]

        api_key = getattr(service, "api_key", None)
        if isinstance(api_key, str) and api_key:
            return api_key

    return None
