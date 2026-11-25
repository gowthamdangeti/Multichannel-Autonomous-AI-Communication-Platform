"""What the run page receives about real provider usage."""

from typing import Literal

from pydantic import BaseModel

ProviderUsageStatus = Literal["none", "pending", "billed", "unavailable"]


class BilledServiceUsage(BaseModel):
    """One service and model on a run. Costs are exact decimal text."""

    service_type: str
    provider: str | None
    model: str | None
    request_count: int = 0
    input_seconds: float = 0.0
    output_seconds: float = 0.0
    input_text_tokens: int = 0
    input_audio_tokens: int = 0
    output_text_tokens: int = 0
    output_audio_tokens: int = 0
    input_text_cost_usd: str = "0"
    input_audio_cost_usd: str = "0"
    output_text_cost_usd: str = "0"
    output_audio_cost_usd: str = "0"
    cost_usd: str = "0"


class ProviderRequest(BaseModel):
    """One billed request, to compare with the provider's own log."""

    request_id: str
    provider: str | None
    service_type: str
    model: str | None
    input_tokens: int
    output_tokens: int
    input_seconds: float
    output_seconds: float
    cost_usd: str
    started_at: str | None
    ended_at: str | None


class ProviderRequestLookup(BaseModel):
    workflow_id: int
    run_id: int
    run_name: str | None
    request: ProviderRequest


class ProviderUsageSummary(BaseModel):
    status: ProviderUsageStatus
    services: list[BilledServiceUsage]
    requests: list[ProviderRequest] = []
    client_reference_id: str | None = None
    awaiting_providers: list[str]
    unreported_llm_requests: int = 0
