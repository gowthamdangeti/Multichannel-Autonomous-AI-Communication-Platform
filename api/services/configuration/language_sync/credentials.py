"""Find platform credentials to call a provider's listing API with.

Order:
1. Environment overrides, e.g. ``LANGUAGE_SYNC_ELEVENLABS_API_KEY``,
   ``LANGUAGE_SYNC_AZURE_SPEECH_REGION``, ``LANGUAGE_SYNC_GOOGLE_CREDENTIALS``.
2. Keys the super-admin already saved: the global model configuration, then
   active model presets. A service block for the right capability (it has a
   ``voice`` field for TTS) is preferred over, say, a Gemini LLM key.

Organisation-owned keys are never used.
"""

from __future__ import annotations

import os
from typing import Any, Iterator

from api.db.platform_client import platform_client
from api.enums import OrganizationConfigurationKey

# Same key admin.py uses for the platform-wide model configuration.
GLOBAL_MODEL_CONFIG_KEY = OrganizationConfigurationKey.MODEL_CONFIGURATION_V2.value
_CREDENTIAL_FIELDS = ("api_key", "credentials")


def _env_credentials(provider: str) -> dict[str, Any] | None:
    prefix = f"LANGUAGE_SYNC_{provider.upper()}_"
    found = {
        field: os.environ[f"{prefix}{field.upper()}"]
        for field in ("api_key", "credentials", "region")
        if os.environ.get(f"{prefix}{field.upper()}")
    }
    return found if any(found.get(f) for f in _CREDENTIAL_FIELDS) else None


def _service_blocks(value: Any, provider: str) -> Iterator[dict[str, Any]]:
    """Every dict (at any depth) configured for ``provider`` that holds a credential."""
    if isinstance(value, dict):
        if str(value.get("provider", "")).lower() == provider and any(
            value.get(f) for f in _CREDENTIAL_FIELDS
        ):
            yield value
        for child in value.values():
            yield from _service_blocks(child, provider)
    elif isinstance(value, list):
        for child in value:
            yield from _service_blocks(child, provider)


def pick_credentials(configs: list[Any], provider: str, capability: str) -> dict[str, Any] | None:
    blocks = [b for config in configs for b in _service_blocks(config, provider)]
    if not blocks:
        return None
    # TTS blocks carry a voice; prefer the block for the capability being synced,
    # but any key for the provider works (one Soniox/Deepgram key covers both).
    preferred = [b for b in blocks if ("voice" in b) == (capability == "tts")]
    return (preferred or blocks)[0]


async def resolve_credentials(provider: str, capability: str) -> dict[str, Any] | None:
    env = _env_credentials(provider)
    if env:
        return env
    configs: list[Any] = []
    global_config = await platform_client.get_platform_config_value(GLOBAL_MODEL_CONFIG_KEY)
    if global_config:
        configs.append(global_config)
    for preset in await platform_client.list_model_configurations(active_only=True):
        configs.append(preset.config)
    return pick_credentials(configs, provider, capability)
