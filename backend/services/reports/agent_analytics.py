"""Roll an agent's recent runs up into the numbers its view page shows.

Tokens come from each run's ``usage_info``, which every run has. Turns, response
times and node names come from its realtime feedback events. Cost is left out:
no prices are stored, and an estimate here would read as a billed amount.
"""

import json
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from api.constants import ALL_TIME_DAYS
from api.db import db_client
from api.schemas.agent_analytics import (
    AgentAnalyticsResponse,
    AgentAnalyticsSummary,
    AgentCount,
    AgentDailyTokens,
    AgentDailyTrend,
    AgentHeavyConversation,
    AgentHourCount,
    AgentModelUsage,
    AgentNodeUsage,
    AgentWeekdayCount,
)
from api.services.configuration.ai_model_configuration import (
    resolve_preset_name_for_workflow,
)
from api.services.reports.agent_performance import build_agent_performance
from api.services.reports.run_fields import as_dict
from api.services.workflow.usage_contract import normalize_usage

# Enough for a busy agent's 90 days without loading every run's logs.
MAX_RUNS = 1000
HEAVIEST_LIMIT = 5
UNKNOWN_NODE = "Unknown node"
UNKNOWN_STACK = "Unknown stack"
WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")


@dataclass
class _NodeTotals:
    turns: int = 0
    tool_calls: int = 0
    latencies: list[float] = field(default_factory=list)


@dataclass
class _DayTotals:
    conversations: int = 0
    prompt_tokens: int = 0
    cache_read_tokens: int = 0
    durations: list[float] = field(default_factory=list)
    latencies: list[float] = field(default_factory=list)
    scores: list[float] = field(default_factory=list)
    outcomes: Counter = field(default_factory=Counter)


def _llm_tokens(usage_info: dict) -> tuple[int, int, int]:
    prompt = completion = cache_read = 0
    for raw in as_dict(usage_info.get("llm")).values():
        usage = normalize_usage(raw if isinstance(raw, dict) else {})
        prompt += usage.input_tokens
        completion += usage.output_tokens
        cache_read += usage.cache_read_tokens
    return prompt, completion, cache_read


def _stack_of(run: dict) -> tuple[str, str | None, str | None]:
    config = as_dict(as_dict(run.get("initial_context")).get("runtime_configuration"))
    provider = config.get("llm_provider")
    model = config.get("llm_model")
    return config.get("preset_name") or model or UNKNOWN_STACK, provider, model


def _share(part: int, total: int) -> float:
    return round(part / total * 100, 1) if total else 0.0


def _average_ms(seconds: list[float]) -> int | None:
    return round(sum(seconds) / len(seconds) * 1000) if seconds else None


def _is_final_user_turn(event: dict) -> bool:
    return event.get("type") == "rtf-user-transcription" and bool(
        as_dict(event.get("payload")).get("final")
    )


def _collect_node_totals(
    events: list, nodes: dict[str, _NodeTotals]
) -> tuple[list[float], int]:
    """Add a run's events to its nodes; return its response latencies and turn count."""
    latencies: list[float] = []
    turns = 0
    for event in events:
        if not isinstance(event, dict):
            continue
        node = nodes[event.get("node_name") or UNKNOWN_NODE]
        event_type = event.get("type")
        if _is_final_user_turn(event):
            node.turns += 1
            turns += 1
        elif event_type == "rtf-function-call-start":
            node.tool_calls += 1
        elif event_type == "rtf-latency-measured":
            latency = as_dict(event.get("payload")).get("latency_seconds")
            if isinstance(latency, int | float):
                node.latencies.append(float(latency))
                latencies.append(float(latency))
    return latencies, turns


def _average(values: list[float]) -> int | None:
    return round(sum(values) / len(values)) if values else None


def _trend_rows(
    day_totals: dict[str, _DayTotals], days: int, now: datetime
) -> list[AgentDailyTrend]:
    rows = []
    for offset in range(days - 1, -1, -1):
        day = (now - timedelta(days=offset)).date().isoformat()
        totals = day_totals.get(day, _DayTotals())
        rows.append(
            AgentDailyTrend(
                date=day,
                conversations=totals.conversations,
                avg_duration_seconds=_average(totals.durations),
                avg_response_ms=_average_ms(totals.latencies),
                avg_resolution_score=_average(totals.scores),
                cache_read_tokens=totals.cache_read_tokens,
                prompt_tokens=totals.prompt_tokens,
                outcomes=dict(totals.outcomes),
            )
        )
    return rows


def _daily_rows(
    tokens_by_day: dict[str, tuple[int, int]],
    conversations_by_day: Counter,
    days: int,
    now: datetime,
) -> list[AgentDailyTokens]:
    """One row per calendar day, so quiet days show as gaps rather than vanish."""
    rows = []
    for offset in range(days - 1, -1, -1):
        day = (now - timedelta(days=offset)).date().isoformat()
        prompt, completion = tokens_by_day.get(day, (0, 0))
        rows.append(
            AgentDailyTokens(
                date=day,
                prompt_tokens=prompt,
                completion_tokens=completion,
                conversations=conversations_by_day[day],
            )
        )
    return rows


def _days_to_show(
    runs: list[dict], days: int, local_now: datetime, tz_offset: timedelta
) -> int:
    """All time runs from the oldest call loaded through today."""
    if days != ALL_TIME_DAYS:
        return days
    if not runs:
        return 0
    oldest = min(run["created_at"] for run in runs) + tz_offset
    return (local_now.date() - oldest.date()).days + 1


def aggregate_agent_analytics(
    runs: list[dict],
    days: int,
    now: datetime,
    is_truncated: bool = False,
    tz_offset_minutes: int = 0,
) -> AgentAnalyticsResponse:
    """``tz_offset_minutes`` is added to UTC, so days and hours read as the viewer's."""
    tz_offset = timedelta(minutes=tz_offset_minutes)
    local_now = now + tz_offset
    day_totals: dict[str, _DayTotals] = defaultdict(_DayTotals)
    hour_counts: Counter = Counter()
    weekday_counts: Counter = Counter()
    cache_read_total = 0
    tokens_by_day: dict[str, tuple[int, int]] = defaultdict(lambda: (0, 0))
    conversations_by_day: Counter = Counter()
    stacks: dict[str, dict] = {}
    nodes: dict[str, _NodeTotals] = defaultdict(_NodeTotals)
    outcomes: Counter = Counter()
    verdicts: Counter = Counter()
    scores: list[float] = []
    heaviest: list[AgentHeavyConversation] = []
    duration = 0.0
    prompt_total = completion_total = sessions_with_usage = 0

    for run in runs:
        usage_info = as_dict(run.get("usage_info"))
        prompt, completion, cache_read = _llm_tokens(usage_info)
        total = prompt + completion
        run_duration = float(usage_info.get("call_duration_seconds") or 0)
        duration += run_duration
        cache_read_total += cache_read
        prompt_total += prompt
        completion_total += completion
        sessions_with_usage += 1 if total else 0

        created_at: datetime = run["created_at"]
        local_created_at = created_at + tz_offset
        day = local_created_at.date().isoformat()
        hour_counts[local_created_at.hour] += 1
        weekday_counts[local_created_at.weekday()] += 1
        day_total = day_totals[day]
        day_total.conversations += 1
        day_total.prompt_tokens += prompt
        day_total.cache_read_tokens += cache_read
        if run_duration:
            day_total.durations.append(run_duration)
        day_prompt, day_completion = tokens_by_day[day]
        tokens_by_day[day] = (day_prompt + prompt, day_completion + completion)
        conversations_by_day[day] += 1

        name, provider, model = _stack_of(run)
        stack = stacks.setdefault(
            name,
            {
                "provider": provider,
                "model": model,
                "tokens": 0,
                "prompt": 0,
                "completion": 0,
                "cache_read": 0,
                "conversations": 0,
                "sessions_with_usage": 0,
                "turns": 0,
                "daily": defaultdict(lambda: (0, 0)),
                "conversations_by_day": Counter(),
            },
        )
        stack["tokens"] += total
        stack["prompt"] += prompt
        stack["completion"] += completion
        stack["cache_read"] += cache_read
        stack["conversations"] += 1
        stack["sessions_with_usage"] += 1 if total else 0
        stack_prompt, stack_completion = stack["daily"][day]
        stack["daily"][day] = (stack_prompt + prompt, stack_completion + completion)
        stack["conversations_by_day"][day] += 1

        latencies, run_turns = _collect_node_totals(
            as_dict(run.get("logs")).get("realtime_feedback_events") or [], nodes
        )
        stack["turns"] += run_turns
        day_total.latencies.extend(latencies)

        gathered = as_dict(run.get("gathered_context"))
        disposition = gathered.get("call_disposition")
        if disposition:
            outcomes[str(disposition)] += 1
            day_total.outcomes[str(disposition)] += 1

        completeness = as_dict(as_dict(run.get("annotations")).get("completeness"))
        if completeness.get("verdict"):
            verdicts[str(completeness["verdict"])] += 1
        if isinstance(completeness.get("score"), int | float):
            scores.append(float(completeness["score"]))
            day_total.scores.append(float(completeness["score"]))

        if total:
            heaviest.append(
                AgentHeavyConversation(
                    run_id=run["id"],
                    title=run.get("conversation_title")
                    or run.get("name")
                    or f"Run {run['id']}",
                    created_at=created_at,
                    disposition=str(disposition) if disposition else None,
                    total_tokens=total,
                )
            )

    row_days = _days_to_show(runs, days, local_now, tz_offset)
    token_total = prompt_total + completion_total
    turn_total = sum(node.turns for node in nodes.values())
    all_latencies = [value for node in nodes.values() for value in node.latencies]
    # A node that only logged system events isn't one the caller spent time in.
    active_nodes = {
        name: node for name, node in nodes.items() if node.turns or node.latencies
    }

    return AgentAnalyticsResponse(
        days=days,
        is_truncated=is_truncated,
        summary=AgentAnalyticsSummary(
            sessions=len(runs),
            sessions_with_usage=sessions_with_usage,
            total_duration_seconds=duration,
            prompt_tokens=prompt_total,
            completion_tokens=completion_total,
            total_tokens=token_total,
            cache_read_tokens=cache_read_total,
            turns=turn_total,
            tool_calls=sum(node.tool_calls for node in nodes.values()),
            avg_response_ms=_average_ms(all_latencies),
            avg_resolution_score=round(sum(scores) / len(scores)) if scores else None,
        ),
        daily=_daily_rows(tokens_by_day, conversations_by_day, row_days, local_now),
        trends=_trend_rows(day_totals, row_days, local_now),
        hourly=[
            AgentHourCount(hour=hour, conversations=hour_counts[hour])
            for hour in range(24)
        ],
        weekdays=[
            AgentWeekdayCount(day=name, conversations=weekday_counts[index])
            for index, name in enumerate(WEEKDAYS)
        ],
        by_model=sorted(
            (
                AgentModelUsage(
                    name=name,
                    provider=stack["provider"],
                    model=stack["model"],
                    total_tokens=stack["tokens"],
                    prompt_tokens=stack["prompt"],
                    completion_tokens=stack["completion"],
                    cache_read_tokens=stack["cache_read"],
                    share=_share(stack["tokens"], token_total),
                    conversations=stack["conversations"],
                    sessions_with_usage=stack["sessions_with_usage"],
                    turns=stack["turns"],
                    daily=_daily_rows(
                        stack["daily"],
                        stack["conversations_by_day"],
                        row_days,
                        local_now,
                    ),
                )
                for name, stack in stacks.items()
            ),
            key=lambda row: row.total_tokens,
            reverse=True,
        ),
        by_node=sorted(
            (
                AgentNodeUsage(
                    name=name,
                    turns=node.turns,
                    share=_share(node.turns, turn_total),
                    avg_response_ms=_average_ms(node.latencies),
                    tool_calls=node.tool_calls,
                )
                for name, node in active_nodes.items()
            ),
            key=lambda row: row.turns,
            reverse=True,
        ),
        heaviest=sorted(heaviest, key=lambda row: row.total_tokens, reverse=True)[
            :HEAVIEST_LIMIT
        ],
        outcomes=[
            AgentCount(name=name, count=count) for name, count in outcomes.most_common()
        ],
        performance=build_agent_performance(runs),
        verdicts=[
            AgentCount(name=name, count=count) for name, count in verdicts.most_common()
        ],
    )


async def _backfill_preset_names(runs: list[dict]) -> None:
    """Stamp each run's model-stack name before the rollup reads it.

    Stored runs carry no ``preset_name`` until a detail view resolves it, so
    without this the breakdown would label stacks by their underlying model.
    Same resolution as the run-detail route, cached per distinct configuration.
    """
    resolved: dict[str, str | None] = {}
    for run in runs:
        runtime = as_dict(
            as_dict(run.get("initial_context")).get("runtime_configuration")
        )
        if not runtime or runtime.get("preset_name"):
            continue
        configurations = as_dict(
            run.get("definition_workflow_configurations")
        ) or as_dict(run.get("workflow_workflow_configurations"))
        key = json.dumps(configurations, sort_keys=True, default=str)
        if key not in resolved:
            try:
                resolved[key] = await resolve_preset_name_for_workflow(configurations)
            except Exception:  # noqa: BLE001 — a lookup failure must not fail the page
                resolved[key] = None
        preset_name = resolved[key]
        if preset_name:
            runtime["preset_name"] = preset_name


async def get_agent_analytics(
    *,
    workflow_id: int,
    organization_id: int,
    days: int,
    tz_offset_minutes: int = 0,
    campaign_id: int | None = None,
) -> AgentAnalyticsResponse:
    """Agent rollup over the last N days; ``campaign_id`` limits it to one campaign's runs."""
    now = datetime.now(UTC)
    fetched = await db_client.get_workflow_runs_for_analytics(
        workflow_id=workflow_id,
        organization_id=organization_id,
        since=None if days == ALL_TIME_DAYS else now - timedelta(days=days),
        limit=MAX_RUNS + 1,
        campaign_id=campaign_id,
    )
    runs = fetched[:MAX_RUNS]
    await _backfill_preset_names(runs)
    return aggregate_agent_analytics(
        runs,
        days,
        now,
        is_truncated=len(fetched) > MAX_RUNS,
        tz_offset_minutes=tz_offset_minutes,
    )
