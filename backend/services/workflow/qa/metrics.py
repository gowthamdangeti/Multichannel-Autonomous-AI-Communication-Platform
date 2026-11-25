"""Call metrics computation from raw event logs."""

from pipecat.utils.enums import RealtimeFeedbackType


def compute_call_metrics(
    logs: list[dict], call_duration_seconds: float | None = None
) -> dict:
    """Pre-compute quantitative metrics from raw call logs."""
    latencies = []
    ttfb_values = []

    for event in logs:
        event_type = event.get("type")
        payload = event.get("payload") or {}
        # The same event type also carries non-numeric payloads (e.g. a
        # kind="breakdown" latency event without latency_seconds); skip those
        # instead of raising KeyError and failing the whole evaluation.
        if event_type == RealtimeFeedbackType.LATENCY_MEASURED.value:
            value = payload.get("latency_seconds")
            if isinstance(value, (int, float)):
                latencies.append(value)
        elif event_type == RealtimeFeedbackType.TTFB_METRIC.value:
            value = payload.get("ttfb_seconds")
            if isinstance(value, (int, float)):
                ttfb_values.append(value)

    turns = set()
    for event in logs:
        if event.get("type") in (
            RealtimeFeedbackType.USER_TRANSCRIPTION.value,
            RealtimeFeedbackType.BOT_TEXT.value,
        ):
            turns.add(event.get("turn", 0))

    return {
        "call_duration_seconds": call_duration_seconds,
        "num_turns": len(turns),
        "avg_latency_seconds": (
            round(sum(latencies) / len(latencies), 2) if latencies else None
        ),
        "avg_ttfb_seconds": (
            round(sum(ttfb_values) / len(ttfb_values), 2) if ttfb_values else None
        ),
        "max_latency_seconds": round(max(latencies), 2) if latencies else None,
    }
