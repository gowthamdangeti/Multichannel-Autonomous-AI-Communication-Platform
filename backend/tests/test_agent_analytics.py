from datetime import UTC, datetime

from api.services.reports import agent_analytics
from api.services.reports.agent_analytics import aggregate_agent_analytics

NOW = datetime(2026, 11, 7, 12, 0, tzinfo=UTC)


def _run(run_id=1, day=6, prompt=100, completion=20, **extra):
    return {
        "id": run_id,
        "name": f"run-{run_id}",
        "conversation_title": None,
        "created_at": datetime(2026, 11, day, 10, 0, tzinfo=UTC),
        "usage_info": {
            "call_duration_seconds": 60,
            "llm": {"Svc|||model": {"prompt_tokens": prompt, "completion_tokens": completion}},
        },
        "logs": {},
        "gathered_context": {},
        "initial_context": {
            "runtime_configuration": {
                "preset_name": "Kira",
                "llm_provider": "groq",
                "llm_model": "gpt-oss",
            }
        },
        "annotations": {},
        **extra,
    }


def _event(event_type, node="greeting", **payload):
    return {"type": event_type, "node_name": node, "payload": payload}


def test_summary_adds_up_tokens_duration_and_sessions():
    summary = aggregate_agent_analytics([_run(1), _run(2, prompt=50, completion=5)], 7, NOW).summary

    assert summary.sessions == 2
    assert summary.prompt_tokens == 150
    assert summary.completion_tokens == 25
    assert summary.total_tokens == 175
    assert summary.total_duration_seconds == 120


def test_run_without_usage_counts_as_a_session_but_not_as_synced():
    empty = _run(2)
    empty["usage_info"] = {}

    summary = aggregate_agent_analytics([_run(1), empty], 7, NOW).summary

    assert summary.sessions == 2
    assert summary.sessions_with_usage == 1


def test_daily_has_a_row_for_every_day_including_quiet_ones():
    daily = aggregate_agent_analytics([_run(1, day=6)], 7, NOW).daily

    assert len(daily) == 7
    assert daily[-1].date == "2026-11-07"
    assert daily[-1].conversations == 0
    assert daily[-2].date == "2026-11-06"
    assert (daily[-2].prompt_tokens, daily[-2].conversations) == (100, 1)


def test_models_group_by_preset_and_share_sums_from_tokens():
    other = _run(2, prompt=300, completion=0)
    other["initial_context"] = {
        "runtime_configuration": {"preset_name": "Omni", "llm_model": "deepseek"}
    }

    models = aggregate_agent_analytics([_run(1, completion=0), other], 7, NOW).by_model

    assert [(m.name, m.total_tokens, m.share) for m in models] == [
        ("Omni", 300, 75.0),
        ("Kira", 100, 25.0),
    ]


def test_missing_runtime_configuration_falls_back_to_an_unknown_stack():
    run = _run(1)
    run["initial_context"] = None

    assert aggregate_agent_analytics([run], 7, NOW).by_model[0].name == "Unknown stack"


def test_model_stack_carries_its_own_tokens_turns_and_daily_series():
    other = _run(2, day=6, prompt=300, completion=50)
    other["initial_context"] = {
        "runtime_configuration": {"preset_name": "Omni", "llm_model": "deepseek"}
    }
    other["logs"] = {"realtime_feedback_events": [_event("rtf-user-transcription", final=True)]}

    kira = next(m for m in aggregate_agent_analytics([_run(1, completion=0), other], 7, NOW).by_model if m.name == "Kira")

    assert (kira.total_tokens, kira.prompt_tokens, kira.completion_tokens) == (100, 100, 0)
    assert (kira.sessions_with_usage, kira.conversations, kira.turns) == (1, 1, 0)
    assert len(kira.daily) == 7
    assert (kira.daily[-2].date, kira.daily[-2].prompt_tokens, kira.daily[-2].conversations) == (
        "2026-11-06",
        100,
        1,
    )
    assert kira.daily[-1].prompt_tokens == 0


def test_a_stack_without_usage_still_reports_a_full_empty_daily_series():
    empty = _run(2)
    empty["usage_info"] = {}
    empty["initial_context"] = {
        "runtime_configuration": {"preset_name": "Omni", "llm_model": "deepseek"}
    }

    stacks = aggregate_agent_analytics([_run(1), empty], 7, NOW).by_model

    assert [(s.name, s.total_tokens) for s in stacks] == [("Kira", 120), ("Omni", 0)]
    assert all(len(s.daily) == 7 for s in stacks)
    assert all(row.prompt_tokens == 0 for row in stacks[1].daily)


def test_nodes_count_final_turns_latency_and_tool_calls():
    logs = {
        "realtime_feedback_events": [
            _event("rtf-user-transcription", final=True),
            _event("rtf-user-transcription", final=False),
            _event("rtf-latency-measured", latency_seconds=1.0),
            _event("rtf-latency-measured", latency_seconds=2.0),
            _event("rtf-function-call-start"),
            _event("rtf-user-transcription", node="closing", final=True),
        ]
    }

    result = aggregate_agent_analytics([_run(1, logs=logs)], 7, NOW)

    assert [(n.name, n.turns, n.share) for n in result.by_node] == [
        ("greeting", 1, 50.0),
        ("closing", 1, 50.0),
    ]
    assert result.by_node[0].avg_response_ms == 1500
    assert result.summary.turns == 2
    assert result.summary.tool_calls == 1
    assert result.summary.avg_response_ms == 1500


def test_heaviest_is_sorted_limited_and_skips_runs_without_tokens():
    runs = [_run(i, prompt=i * 10, completion=0) for i in range(1, 8)]
    runs.append(_run(99, prompt=0, completion=0))

    heaviest = aggregate_agent_analytics(runs, 7, NOW).heaviest

    assert [row.run_id for row in heaviest] == [7, 6, 5, 4, 3]


def test_outcomes_verdicts_and_resolution_score():
    runs = [
        _run(
            1,
            gathered_context={"call_disposition": "user_hangup"},
            annotations={"completeness": {"score": 80, "verdict": "completed"}},
        ),
        _run(
            2,
            gathered_context={"call_disposition": "user_hangup"},
            annotations={"completeness": {"score": 40, "verdict": "partially_completed"}},
        ),
    ]

    result = aggregate_agent_analytics(runs, 7, NOW)

    assert [(o.name, o.count) for o in result.outcomes] == [("user_hangup", 2)]
    assert {v.name for v in result.verdicts} == {"completed", "partially_completed"}
    assert result.summary.avg_resolution_score == 60


def test_no_runs_gives_empty_totals_not_an_error():
    result = aggregate_agent_analytics([], 7, NOW)

    assert result.summary.sessions == 0
    assert result.summary.avg_response_ms is None
    assert result.summary.avg_resolution_score is None
    assert result.by_model == []
    assert len(result.daily) == 7


def test_malformed_logs_and_usage_are_ignored():
    run = _run(1)
    run["usage_info"] = {"llm": {"Svc|||m": "not-a-dict"}}
    run["logs"] = {"realtime_feedback_events": ["nope", _event("rtf-latency-measured", latency_seconds="x")]}

    summary = aggregate_agent_analytics([run], 7, NOW).summary

    assert summary.total_tokens == 0
    assert summary.avg_response_ms is None


def test_trends_average_each_day_and_keep_quiet_days_empty():
    logs = {"realtime_feedback_events": [_event("rtf-latency-measured", latency_seconds=2.0)]}
    runs = [
        _run(
            1,
            day=6,
            logs=logs,
            gathered_context={"call_disposition": "user_hangup"},
            annotations={"completeness": {"score": 80}},
        ),
        _run(2, day=6, annotations={"completeness": {"score": 40}}),
    ]

    trends = aggregate_agent_analytics(runs, 7, NOW).trends

    assert len(trends) == 7
    quiet, busy = trends[-1], trends[-2]
    assert (busy.conversations, busy.avg_duration_seconds) == (2, 60)
    assert busy.avg_response_ms == 2000
    assert busy.avg_resolution_score == 60
    assert busy.outcomes == {"user_hangup": 1}
    assert quiet.conversations == 0
    assert quiet.avg_response_ms is None
    assert quiet.avg_duration_seconds is None


def test_cache_tokens_count_in_summary_and_trend():
    run = _run(1)
    run["usage_info"]["llm"]["Svc|||model"]["cache_read_input_tokens"] = 40

    result = aggregate_agent_analytics([run], 7, NOW)

    assert result.summary.cache_read_tokens == 40
    assert result.trends[-2].cache_read_tokens == 40


def test_hours_and_days_cover_every_slot():
    result = aggregate_agent_analytics([_run(1, day=6)], 7, NOW)

    assert len(result.hourly) == 24
    assert result.hourly[10].conversations == 1
    # 2026-11-06 is a Friday.
    assert [(w.day, w.conversations) for w in result.weekdays if w.conversations] == [("Fri", 1)]


def test_timezone_moves_a_late_call_into_the_next_local_day():
    run = _run(1, day=6)
    run["created_at"] = datetime(2026, 11, 6, 20, 0, tzinfo=UTC)

    result = aggregate_agent_analytics([run], 7, NOW, tz_offset_minutes=330)

    # 20:00 UTC is 01:30 on Saturday in India.
    assert result.hourly[1].conversations == 1
    assert [w.day for w in result.weekdays if w.conversations] == ["Sat"]
    assert [row.date for row in result.trends if row.conversations] == ["2026-11-07"]


def _metrics(runs):
    return {m.key: (m.score, m.sample) for m in aggregate_agent_analytics(runs, 7, NOW).performance.metrics}


def _tool_end(name, result):
    return _event("rtf-function-call-end", function_name=name, result=result)


def test_no_activity_leaves_scores_empty_not_zero():
    performance = aggregate_agent_analytics([], 7, NOW).performance

    assert performance.overall is None
    assert all(m.score is None for m in performance.metrics)


def test_speed_is_the_share_of_responses_within_target():
    logs = {
        "realtime_feedback_events": [
            _event("rtf-latency-measured", latency_seconds=1.0),
            _event("rtf-latency-measured", latency_seconds=3.0),
            _event("rtf-latency-measured", latency_seconds=3.1),
            _event("rtf-latency-measured", latency_seconds=9.0),
        ]
    }

    assert _metrics([_run(1, logs=logs)])["speed"] == (50, 4)


def test_tool_accuracy_reads_status_rather_than_searching_the_text():
    logs = {
        "realtime_feedback_events": [
            _tool_end("transfer_call", "{'status': 'transfer_success', 'message': 'connected'}"),
            _tool_end("transfer_call", "{'status': 'transfer_failed', 'reason': 'busy'}"),
            _tool_end("check_order_status", "The function `check_order_status` is not currently available."),
            _tool_end("search", "Plain text mentioning a failed error, from a tool that worked."),
        ]
    }

    assert _metrics([_run(1, logs=logs)])["tool_accuracy"] == (50, 4)


def test_workflow_transitions_do_not_count_as_tool_calls():
    logs = {
        "realtime_feedback_events": [
            _tool_end("customer_is_available", "{'status': 'done'}"),
            _tool_end("transfer_call", "{'status': 'transfer_failed'}"),
        ]
    }

    assert _metrics([_run(1, logs=logs)])["tool_accuracy"] == (0, 1)


def test_kb_recall_counts_lookups_that_found_content():
    logs = {
        "realtime_feedback_events": [
            _tool_end("retrieve_from_knowledge_base", "{'chunks': [{'text': 'failed error text'}], 'total_results': 1}"),
            _tool_end("retrieve_from_knowledge_base", "{'chunks': [], 'total_results': 0}"),
            _tool_end("retrieve_from_knowledge_base", "{'error': 'embedding down', 'chunks': []}"),
            _tool_end("retrieve_from_knowledge_base", "{'chunks': [{'text': 'cut off"),
        ]
    }

    metrics = _metrics([_run(1, logs=logs)])

    assert metrics["kb_recall"] == (25, 4)
    assert metrics["tool_accuracy"] == (75, 4)


def test_context_rate_adds_up_report_fields_across_runs():
    first = {"report_variables_meta": {"total": 10, "empty": ["a", "b"]}}
    second = {"report_variables_meta": {"total": 30, "empty": []}}

    metrics = _metrics([_run(1, gathered_context=first), _run(2, gathered_context=second), _run(3)])

    assert metrics["context_rate"] == (95, 2)


def test_reliability_fails_a_run_on_the_disposition_or_an_error_event():
    errored = {"realtime_feedback_events": [_event("rtf-pipeline-error", error="boom")]}
    runs = [
        _run(1),
        _run(2, gathered_context={"call_disposition": "user_hangup"}),
        _run(3, gathered_context={"call_disposition": "pipeline_error"}),
        _run(4, logs=errored),
    ]

    assert _metrics(runs)["reliability"] == (50, 4)


def test_overall_averages_only_what_was_measured():
    run = _run(1, annotations={"completeness": {"score": 60}})

    performance = aggregate_agent_analytics([run], 7, NOW).performance

    # Resolution 60 and Reliability 100; the other four have nothing to measure.
    assert performance.overall == 80


def test_all_time_rows_start_at_the_oldest_call():
    result = aggregate_agent_analytics([_run(1, day=3), _run(2, day=6)], 0, NOW)

    assert result.trends[0].date == "2026-11-03"
    assert result.trends[-1].date == "2026-11-07"
    assert len(result.daily) == 5
    assert result.summary.sessions == 2


def test_all_time_with_no_calls_has_no_rows():
    result = aggregate_agent_analytics([], 0, NOW)

    assert result.trends == []
    assert result.daily == []


async def test_stack_names_come_from_the_resolved_preset_not_the_model(monkeypatch):
    calls: list[dict] = []

    async def fake_resolve(configurations):
        calls.append(configurations)
        return "Omni"

    monkeypatch.setattr(agent_analytics, "resolve_preset_name_for_workflow", fake_resolve)

    runs = []
    for run_id in (1, 2):
        run = _run(run_id)
        run["initial_context"]["runtime_configuration"].pop("preset_name")
        run["definition_workflow_configurations"] = {"platform_model_configuration_id": 3}
        runs.append(run)

    await agent_analytics._backfill_preset_names(runs)

    assert [r["initial_context"]["runtime_configuration"]["preset_name"] for r in runs] == ["Omni", "Omni"]
    # Identical configurations are looked up once, not once per run.
    assert len(calls) == 1
    # The model that actually served each run stays visible under the stack.
    stack = aggregate_agent_analytics(runs, 7, NOW).by_model[0]
    assert (stack.name, stack.model, stack.total_tokens) == ("Omni", "gpt-oss", 240)


async def test_a_stored_preset_name_is_never_re_resolved(monkeypatch):
    async def explode(configurations):
        raise AssertionError("stored preset names must not trigger a lookup")

    monkeypatch.setattr(agent_analytics, "resolve_preset_name_for_workflow", explode)

    run = _run(1)

    await agent_analytics._backfill_preset_names([run])

    assert run["initial_context"]["runtime_configuration"]["preset_name"] == "Kira"
