"""Base classes, data models, and typed exceptions for audio providers.

Defines the contract for all Speech-to-Text (STT) and Text-to-Speech (TTS)
providers used across WhatsApp and voice interfaces.
"""
from __future__ import annotations

import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional

from loguru import logger


class ProviderConfigurationError(Exception):
    """Raised when an API key, URL, or required credentials are missing or invalid."""
    def __init__(self, provider: str, message: str):
        self.provider = provider
        self.message = message
        super().__init__(f"STT/TTS provider '{provider}' is misconfigured: {message}")


class ProviderExecutionError(Exception):
    """Raised when an upstream provider returns an error status or fails execution."""
    def __init__(self, provider: str, status_code: int | None, message: str):
        self.provider = provider
        self.status_code = status_code
        self.message = message
        super().__init__(f"Provider '{provider}' failed (status={status_code}): {message}")


@dataclass
class STTRequest:
    """Request object passed to an STT provider."""
    audio_bytes: bytes
    filename: str
    content_type: str
    model: str
    api_key: Optional[str] = None
    language: Optional[str] = None
    base_url: Optional[str] = None
    credentials: Optional[str] = None
    location: Optional[str] = None


@dataclass
class TTSRequest:
    """Request object passed to a TTS provider."""
    text: str
    model: str
    voice: Optional[str] = None
    api_key: Optional[str] = None
    language: Optional[str] = None
    base_url: Optional[str] = None
    speed: Optional[float] = 1.0
    credentials: Optional[str] = None
    location: Optional[str] = None


class BaseSTTProvider(ABC):
    """Abstract base class for all STT providers."""

    @property
    @abstractmethod
    def provider_name(self) -> str:
        """Normalized provider name (e.g., 'openai', 'soniox', 'deepgram')."""
        ...

    @abstractmethod
    async def transcribe(self, request: STTRequest) -> str:
        """Transcribe audio bytes to text strictly using this provider.

        Raises:
            ProviderConfigurationError: If API key or configuration is invalid.
            ProviderExecutionError: If upstream API call fails.
        """
        ...

    def log_stt_start(self, model: str, transport: str, byte_count: int) -> float:
        """Standardized INFO start log for STT."""
        logger.info(
            f"WA STT provider={self.provider_name} model={model} transport={transport} bytes={byte_count}"
        )
        return time.perf_counter()

    def log_stt_success(self, transcript: str, start_time: float) -> None:
        """Standardized INFO success log for STT."""
        latency_ms = int((time.perf_counter() - start_time) * 1000)
        logger.info(
            f"WA STT provider={self.provider_name} status=success transcript_len={len(transcript)} latency_ms={latency_ms}"
        )

    def log_stt_error(self, code: int | None, msg: str) -> None:
        """Standardized INFO error log for STT."""
        trimmed = (msg or "")[:200]
        logger.info(
            f"WA STT provider={self.provider_name} status=error code={code} msg={trimmed}"
        )


class BaseTTSProvider(ABC):
    """Abstract base class for all TTS providers."""

    @property
    @abstractmethod
    def provider_name(self) -> str:
        """Normalized provider name (e.g., 'openai', 'soniox', 'deepgram')."""
        ...

    @abstractmethod
    async def synthesize(self, request: TTSRequest) -> bytes:
        """Synthesize text into raw audio bytes strictly using this provider.

        Raises:
            ProviderConfigurationError: If API key or configuration is invalid.
            ProviderExecutionError: If upstream API call fails.
        """
        ...

    def log_tts_start(self, model: str, voice: str | None, text: str) -> float:
        """Standardized INFO start log for TTS."""
        logger.info(
            f"WA TTS provider={self.provider_name} model={model} voice={voice or 'none'} text_len={len(text)}"
        )
        return time.perf_counter()

    def log_tts_success(self, audio_bytes: bytes, start_time: float) -> None:
        """Standardized INFO success log for TTS."""
        latency_ms = int((time.perf_counter() - start_time) * 1000)
        logger.info(
            f"WA TTS provider={self.provider_name} status=success bytes={len(audio_bytes)} latency_ms={latency_ms}"
        )

    def log_tts_error(self, code: int | None, msg: str) -> None:
        """Standardized INFO error log for TTS."""
        trimmed = (msg or "")[:200]
        logger.info(
            f"WA TTS provider={self.provider_name} status=error code={code} msg={trimmed}"
        )
