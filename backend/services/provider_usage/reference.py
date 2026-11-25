"""The tag that links a provider's usage record back to a workflow run."""

from __future__ import annotations

from typing import Any

from api.constants import ENVIRONMENT
from api.services.provider_usage.types import RunUsageContext

PROVIDER_USAGE_REFERENCE_KEY = "provider_usage_reference"


def format_run_reference(*, workflow_run_id: int) -> str:
    # The environment keeps dev and prod runs apart when they share a provider key.
    return f"convozent-{ENVIRONMENT}-run-{workflow_run_id}"


def to_run_usage_context(*, initial_context: dict[str, Any] | None) -> RunUsageContext:
    runtime_configuration = (initial_context or {}).get("runtime_configuration") or {}
    return RunUsageContext(
        reference=runtime_configuration.get(PROVIDER_USAGE_REFERENCE_KEY),
        stt_provider=runtime_configuration.get("stt_provider"),
        tts_provider=runtime_configuration.get("tts_provider"),
    )
