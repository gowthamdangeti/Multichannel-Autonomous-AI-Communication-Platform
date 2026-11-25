"""What a chat session ran with, recorded when it starts.

The voice run page shows an "Initial Context" with the runtime configuration;
this is the chat equivalent. It holds identifiers and model names only, never
API keys or other credentials.
"""

from __future__ import annotations

from typing import Any, Optional

from loguru import logger

from api.db.models import ChatAgentModel
from api.db.platform_client import platform_client
from api.services.configuration.ai_model_configuration import (
    get_effective_ai_model_configuration_for_workflow,
)

_PRESET_ID_KEY = "platform_model_configuration_id"


def _value(obj: Any) -> Any:
    """An enum's value, or the thing itself."""
    return getattr(obj, "value", obj)


async def _preset_name(agent: ChatAgentModel) -> Optional[str]:
    preset_id = (agent.model_config_ref or {}).get(_PRESET_ID_KEY)
    if preset_id is None:
        return None
    try:
        preset = await platform_client.get_model_configuration(int(preset_id))
    except (TypeError, ValueError):
        return None
    return getattr(preset, "name", None)


async def build_initial_context(agent: ChatAgentModel, origin: Optional[str]) -> dict:
    """Best-effort snapshot; a missing piece is left out, never guessed."""
    context: dict = {
        "agent_id": agent.id,
        "agent_name": agent.name,
        "channel": "website_chat",
        "origin": origin,
    }
    try:
        effective = await get_effective_ai_model_configuration_for_workflow(
            user_id=None,
            organization_id=agent.organization_id,
            workflow_configurations=agent.model_config_ref or {},
        )
        runtime: dict = {
            "preset_name": await _preset_name(agent),
            "llm_provider": _value(getattr(effective.llm, "provider", None)),
            "llm_model": getattr(effective.llm, "model", None),
            "temperature": getattr(effective.llm, "temperature", None),
            "language": getattr(effective.llm, "language", None)
            or getattr(effective.stt, "language", None),
        }
        context["runtime_configuration"] = {k: v for k, v in runtime.items() if v is not None}
    except Exception as e:  # never block a visitor on a snapshot
        logger.warning(f"Chat agent {agent.id}: could not record runtime configuration: {e}")
    return {k: v for k, v in context.items() if v is not None}
