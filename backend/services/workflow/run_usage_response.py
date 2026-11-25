"""Format workflow run usage for public API responses."""

from api.services.workflow.token_usage import compute_convozent_tokens


def format_public_usage_info(usage_info: dict | None) -> dict | None:
    if not usage_info:
        return None

    return {
        "llm": usage_info.get("llm") or {},
        "tts": usage_info.get("tts") or {},
        "stt": usage_info.get("stt") or {},
        "call_duration_seconds": usage_info.get("call_duration_seconds"),
    }


def format_public_cost_info(
    cost_info: dict | None, usage_info: dict | None
) -> dict | None:
    """Return the legacy response shape without doing local cost accounting."""
    duration = None
    if usage_info and usage_info.get("call_duration_seconds") is not None:
        duration = int(round(usage_info.get("call_duration_seconds") or 0))
    elif cost_info and cost_info.get("call_duration_seconds") is not None:
        duration = int(round(cost_info.get("call_duration_seconds") or 0))

    convozent_token_usage = 0
    if cost_info:
        if "convozent_token_usage" in cost_info:
            convozent_token_usage = cost_info.get("convozent_token_usage") or 0
        elif "total_cost_usd" in cost_info:
            convozent_token_usage = round(
                float(cost_info.get("total_cost_usd", 0)) * 100, 2
            )
    if not convozent_token_usage:
        # cost_info token fields have no writers (billing moved to the wallet
        # ledger); derive from stored provider usage so detail never reads 0
        # while the run actually consumed LLM/TTS tokens.
        convozent_token_usage = compute_convozent_tokens(usage_info)

    if duration is None and convozent_token_usage == 0:
        return None

    return {
        "convozent_token_usage": convozent_token_usage,
        "call_duration_seconds": duration,
    }
