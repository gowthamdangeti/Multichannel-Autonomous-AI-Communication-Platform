"""Score an agent on the axes of its performance radar.

Each score is 0-100 and comes from what its runs recorded. An axis with nothing
to measure has no score, because a 0 there would read as a failure: an agent with
no tools hasn't got its tools wrong.
"""

import ast
from dataclasses import dataclass
from typing import Any

from api.schemas.agent_analytics import AgentPerformance, AgentPerformanceMetric
from api.services.reports.run_fields import as_dict

# No target is configured anywhere, so this is the line "fast enough" is drawn at.
SPEED_TARGET_SECONDS = 3.0
KNOWLEDGE_BASE_TOOL = "retrieve_from_knowledge_base"
PIPELINE_ERROR_DISPOSITION = "pipeline_error"
PIPELINE_ERROR_EVENT = "rtf-pipeline-error"
LATENCY_EVENT = "rtf-latency-measured"
TOOL_END_EVENT = "rtf-function-call-end"
UNAVAILABLE_TOOL_MARKER = "is not currently available"
# What a workflow edge returns: moving between nodes isn't a tool the agent used.
TRANSITION_STATUS = "done"


@dataclass
class _Share:
    """How many of the measured things went right."""

    good: int = 0
    total: int = 0

    def add(self, is_good: bool) -> None:
        self.good += 1 if is_good else 0
        self.total += 1

    @property
    def score(self) -> int | None:
        return round(self.good / self.total * 100) if self.total else None


def _parse_tool_result(result: Any) -> dict:
    """Tool results are stored as ``str(dict)``, or as plain text from some tools."""
    if not isinstance(result, str) or not result.startswith("{"):
        return {}
    try:
        return as_dict(ast.literal_eval(result))
    except (ValueError, SyntaxError, MemoryError, RecursionError):
        return {}


def _tool_failed(raw_result: Any, parsed: dict) -> bool:
    if isinstance(raw_result, str) and UNAVAILABLE_TOOL_MARKER in raw_result:
        return True
    status = str(parsed.get("status", "")).lower()
    return bool(parsed.get("error")) or "fail" in status or "error" in status


def _events_of(run: dict) -> list[dict]:
    events = as_dict(run.get("logs")).get("realtime_feedback_events") or []
    return [event for event in events if isinstance(event, dict)]


def _report_fields(run: dict) -> tuple[int, int]:
    """Filled and total report fields, or zeros for a run without a report."""
    meta = as_dict(as_dict(run.get("gathered_context")).get("report_variables_meta"))
    total = meta.get("total")
    if not isinstance(total, int) or total <= 0:
        return 0, 0
    empty = meta.get("empty")
    missing = len(empty) if isinstance(empty, list) else 0
    return max(total - missing, 0), total


def _metric(key: str, score: int | None, sample: int) -> AgentPerformanceMetric:
    return AgentPerformanceMetric(key=key, score=score, sample=sample)


def build_agent_performance(runs: list[dict]) -> AgentPerformance:
    scores: list[float] = []
    speed = _Share()
    knowledge = _Share()
    tools = _Share()
    context = _Share()
    reliability = _Share()
    reports = 0

    for run in runs:
        events = _events_of(run)
        had_error = False
        for event in events:
            event_type = event.get("type")
            payload = as_dict(event.get("payload"))
            if event_type == PIPELINE_ERROR_EVENT:
                had_error = True
            elif event_type == LATENCY_EVENT:
                latency = payload.get("latency_seconds")
                if isinstance(latency, int | float):
                    speed.add(latency <= SPEED_TARGET_SECONDS)
            elif event_type == TOOL_END_EVENT:
                raw_result = payload.get("result")
                parsed = _parse_tool_result(raw_result)
                if parsed.get("status") == TRANSITION_STATUS:
                    continue
                failed = _tool_failed(raw_result, parsed)
                tools.add(not failed)
                if payload.get("function_name") == KNOWLEDGE_BASE_TOOL:
                    knowledge.add(not failed and bool(parsed.get("chunks")))

        gathered = as_dict(run.get("gathered_context"))
        reliability.add(not had_error and gathered.get("call_disposition") != PIPELINE_ERROR_DISPOSITION)

        filled, total = _report_fields(run)
        context.good += filled
        context.total += total
        reports += 1 if total else 0

        score = as_dict(as_dict(run.get("annotations")).get("completeness")).get("score")
        if isinstance(score, int | float):
            scores.append(float(score))

    metrics = [
        _metric("resolution", round(sum(scores) / len(scores)) if scores else None, len(scores)),
        _metric("speed", speed.score, speed.total),
        _metric("kb_recall", knowledge.score, knowledge.total),
        _metric("tool_accuracy", tools.score, tools.total),
        _metric("context_rate", context.score, reports),
        _metric("reliability", reliability.score, reliability.total),
    ]
    measured = [metric.score for metric in metrics if metric.score is not None]
    overall = round(sum(measured) / len(measured)) if measured else None
    return AgentPerformance(overall=overall, metrics=metrics)
