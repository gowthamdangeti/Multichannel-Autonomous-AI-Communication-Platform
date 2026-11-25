"""Convozent token usage — single source of truth for per-run token counts.

Background: `cost_info.convozent_token_usage` / `cost_info.total_cost_usd`
have zero writers anywhere in the codebase (billing moved to the MPS wallet
ledger, debited by duration). The usage-list endpoint additionally hardcoded
`convozent_tokens = 0`. So every run reported 0 tokens while real provider
usage sat unused in `usage_info`.

This module derives tokens deterministically from `usage_info` at read time:
no migration, no backfill job, all history correct immediately.

Formula:
- LLM: sum of `total_tokens` across all `processor|||model` entries
- TTS: ceil(chars / 4) per entry (industry-standard char→token approximation)
- STT: 0 (seconds-metered, accounted via duration billing, not tokens)
"""

from __future__ import annotations

import math
from typing import Any

# Chars per token for TTS character counts. Documented approximation, kept
# as a constant so a future pricing change touches exactly one place.
TTS_CHARS_PER_TOKEN = 4


def _safe_float(value: Any) -> float:
    try:
        num = float(value)
    except (TypeError, ValueError):
        return 0.0
    if num != num or num in (float("inf"), float("-inf")):  # NaN / inf guard
        return 0.0
    return max(0.0, num)


def compute_convozent_tokens(usage_info: dict | None) -> float:
    """Derive convozent token usage from a run's stored `usage_info`.

    Returns 0.0 for missing/empty/malformed input (e.g. pipeline_error runs
    with no provider usage). Never raises.
    """
    if not isinstance(usage_info, dict):
        return 0.0

    total = 0.0

    llm = usage_info.get("llm")
    if isinstance(llm, dict):
        for entry in llm.values():
            if isinstance(entry, dict):
                total += _safe_float(entry.get("total_tokens"))
            else:
                total += _safe_float(entry)

    tts = usage_info.get("tts")
    if isinstance(tts, dict):
        for chars in tts.values():
            total += math.ceil(_safe_float(chars) / TTS_CHARS_PER_TOKEN)

    return round(total, 2)


__all__ = [
    "TTS_CHARS_PER_TOKEN",
    "compute_convozent_tokens",
]
