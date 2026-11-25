"""Provider registry for Speech-to-Text and Text-to-Speech engines.

Enforces provider-agnostic lookup without hardcoded branching in consumer services.
"""
from __future__ import annotations

from typing import Dict, Optional, Type

from loguru import logger

from api.services.audio_providers.base import BaseSTTProvider, BaseTTSProvider

# Global registry mappings: normalized provider name -> provider class
_STT_REGISTRY: Dict[str, Type[BaseSTTProvider]] = {}
_TTS_REGISTRY: Dict[str, Type[BaseTTSProvider]] = {}

# Cached singletons
_STT_INSTANCES: Dict[str, BaseSTTProvider] = {}
_TTS_INSTANCES: Dict[str, BaseTTSProvider] = {}


def register_stt_provider(cls: Type[BaseSTTProvider]) -> Type[BaseSTTProvider]:
    """Class decorator to register an STT provider implementation."""
    instance = cls()
    name = instance.provider_name.lower().strip()
    _STT_REGISTRY[name] = cls
    _STT_INSTANCES[name] = instance
    logger.debug(f"Registered audio STT provider: '{name}' -> {cls.__name__}")
    return cls


def register_tts_provider(cls: Type[BaseTTSProvider]) -> Type[BaseTTSProvider]:
    """Class decorator to register a TTS provider implementation."""
    instance = cls()
    name = instance.provider_name.lower().strip()
    _TTS_REGISTRY[name] = cls
    _TTS_INSTANCES[name] = instance
    logger.debug(f"Registered audio TTS provider: '{name}' -> {cls.__name__}")
    return cls


def get_stt_provider(provider_name: str | None) -> Optional[BaseSTTProvider]:
    """Retrieve an STT provider instance by name without branching.

    Returns None if provider is not registered.
    """
    if not provider_name:
        return None
    name = str(provider_name).lower().strip()
    # Check singleton cache
    if name in _STT_INSTANCES:
        return _STT_INSTANCES[name]
    # Instantiate from class registry
    cls = _STT_REGISTRY.get(name)
    if cls:
        inst = cls()
        _STT_INSTANCES[name] = inst
        return inst
    return None


def get_tts_provider(provider_name: str | None) -> Optional[BaseTTSProvider]:
    """Retrieve a TTS provider instance by name without branching.

    Returns None if provider is not registered.
    """
    if not provider_name:
        return None
    name = str(provider_name).lower().strip()
    # Check singleton cache
    if name in _TTS_INSTANCES:
        return _TTS_INSTANCES[name]
    # Instantiate from class registry
    cls = _TTS_REGISTRY.get(name)
    if cls:
        inst = cls()
        _TTS_INSTANCES[name] = inst
        return inst
    return None


def list_stt_providers() -> list[str]:
    """Return all registered STT provider names."""
    return sorted(list(_STT_REGISTRY.keys()))


def list_tts_providers() -> list[str]:
    """Return all registered TTS provider names."""
    return sorted(list(_TTS_REGISTRY.keys()))


def registered_stt_names() -> set[str]:
    """Return set of all registered STT provider names."""
    return set(_STT_REGISTRY.keys())


def registered_tts_names() -> set[str]:
    """Return set of all registered TTS provider names."""
    return set(_TTS_REGISTRY.keys())
