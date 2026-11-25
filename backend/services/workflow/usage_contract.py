"""Canonical usage-event values and validation for billable AI operations."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from math import isfinite
from typing import Any


class UsageCase(StrEnum):
    CONVERSATION = "conversation"
    CONVERSATION_TITLE = "conversation_title"
    CONVERSATION_COMPLETENESS = "conversation_completeness"
    AGENDA_OUTCOMES = "agenda_outcomes"
    QA_RESULTS = "qa_results"
    REPORT_GENERATION = "report_generation"


class UsageServiceType(StrEnum):
    LLM = "llm"
    STT = "stt"
    TTS = "tts"
    STS = "sts"


class UsageSource(StrEnum):
    PROVIDER_BILLED = "provider_billed"
    PROVIDER_UNREPORTED = "provider_unreported"


class UsageStatus(StrEnum):
    RECORDED = "recorded"
    UNAVAILABLE = "unavailable"
    FAILED = "failed"


@dataclass(frozen=True, slots=True)
class NormalizedUsage:
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    input_units: float = 0.0
    output_units: float = 0.0

def _non_negative_int(value: Any) -> int:
    try:
        number = float(value or 0)
    except (TypeError, ValueError, OverflowError):
        return 0
    if not isfinite(number) or number < 0:
        return 0
    return int(number)

def _non_negative_float(value: Any) -> float:
    try:
        number = float(value or 0)
    except (TypeError, ValueError):
        return 0.0
    return number if isfinite(number) and number >= 0 else 0.0


def _usage_field(obj: Any, name: str) -> Any:
    if obj is None:
        return None
    if isinstance(obj, dict):
        return obj.get(name)
    return getattr(obj, name, None)


def cached_prompt_tokens(usage: Any) -> int:
    """Cached (prefix-cache hit) input tokens from a provider usage object.

    Providers report this in different places, and the one-shot callers read
    only prompt/completion/total, so cache hits were dropped as 0:
      - OpenAI-compatible (OpenAI, DeepSeek, Azure, Groq...):
        ``usage.prompt_tokens_details.cached_tokens``
      - DeepSeek native: ``usage.prompt_cache_hit_tokens``
      - Anthropic-style: ``usage.cache_read_input_tokens``
    """
    details = _usage_field(usage, "prompt_tokens_details")
    for value in (
        _usage_field(details, "cached_tokens"),
        _usage_field(usage, "prompt_cache_hit_tokens"),
        _usage_field(usage, "cache_read_input_tokens"),
    ):
        tokens = _non_negative_int(value)
        if tokens > 0:
            return tokens
    return 0


def normalize_usage(raw: dict[str, Any] | None) -> NormalizedUsage:
    """Normalize provider usage without inventing missing provider fields."""
    raw = raw if isinstance(raw, dict) else {}
    input_tokens = _non_negative_int(raw.get("prompt_tokens", raw.get("input_tokens")))
    output_tokens = _non_negative_int(raw.get("completion_tokens", raw.get("output_tokens")))
    declared_total = _non_negative_int(raw.get("total_tokens"))
    total_tokens = max(declared_total, input_tokens + output_tokens)
    return NormalizedUsage(
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=total_tokens,
        cache_read_tokens=_non_negative_int(
            raw.get("cache_read_input_tokens", raw.get("cache_read_tokens"))
        ),
        cache_write_tokens=_non_negative_int(
            raw.get("cache_creation_input_tokens", raw.get("cache_write_tokens"))
        ),
        input_units=_non_negative_float(raw.get("input_units")),
        output_units=_non_negative_float(raw.get("output_units")),
    )
