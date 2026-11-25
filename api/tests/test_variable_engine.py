"""Tests for the pure shared variable engine: discovery, resolution, cache
self-heal, formatting, truncation, rollups, placeholders, metadata."""

from datetime import datetime, timezone

from api.services.reports.variable_engine import (
    CAMPAIGN_BUILTIN_VARS,
    NOT_DISCUSSED,
    ReportVariable,
    ReportVariableType,
    apply_placeholders,
    apply_score_rollups,
    build_run_metadata,
    discover_template_variables,
    missing_cached_vars,
    resolve_definitions,
    truncate_to_budget,
)


def _var(name: str, var_type: str = "text", description: str = "") -> ReportVariable:
    return ReportVariable(
        name=name, type=ReportVariableType(var_type), description=description
    )


class TestDiscoverTemplateVariables:
    def test_discovers_flat_and_loop_vars(self):
        html = "<p>{{ name }}</p>{% for item in items %}<li>{{ item }}</li>{% endfor %}"
        found = {v.name: v.type for v in discover_template_variables(html)}
        assert found["name"] == ReportVariableType.text
        assert found["items"] == ReportVariableType.list

    def test_excludes_jinja_builtins(self):
        html = "{% for i in range(3) %}{{ i }}{{ loop.index }}{% endfor %}{{ foo }}"
        names = {v.name for v in discover_template_variables(html)}
        assert "range" not in names
        assert "loop" not in names
        assert "foo" in names

    def test_invalid_template_returns_empty(self):
        assert discover_template_variables("{% for %}") == []


class TestResolveDefinitions:
    def test_saved_defs_win_on_collision(self):
        html = "{{ score }}"
        saved = [{"name": "score", "type": "score", "description": "Overall"}]
        resolved = {v.name: v for v in resolve_definitions(html, saved)}
        assert resolved["score"].type == ReportVariableType.score
        assert resolved["score"].description == "Overall"

    def test_exclude_drops_builtin_names(self):
        html = "{{ campaign_name }} {{ custom }}"
        resolved = resolve_definitions(
            html, [], exclude=CAMPAIGN_BUILTIN_VARS
        )
        names = {v.name for v in resolved}
        assert "campaign_name" not in names
        assert "custom" in names

    def test_empty_template_and_no_saved(self):
        assert resolve_definitions(None, []) == []
        assert resolve_definitions("", None) == []


class TestMissingCachedVars:
    def test_empty_string_counts_as_missing(self):
        defs = [_var("a"), _var("b")]
        cached = {"a": "real", "b": ""}
        missing = missing_cached_vars(defs, cached)
        assert [v.name for v in missing] == ["b"]

    def test_absent_and_none_and_empty_list_count_as_missing(self):
        defs = [_var("a"), _var("b", "list"), _var("c")]
        cached = {"a": None, "b": []}
        missing = missing_cached_vars(defs, cached)
        assert {v.name for v in missing} == {"a", "b", "c"}

    def test_non_empty_values_are_not_missing(self):
        defs = [_var("a"), _var("b", "list")]
        cached = {"a": "x", "b": ["y"]}
        assert missing_cached_vars(defs, cached) == []

    def test_none_cache_treats_all_missing(self):
        defs = [_var("a")]
        assert [v.name for v in missing_cached_vars(defs, None)] == ["a"]


class TestTruncateToBudget:
    def test_short_transcript_unchanged(self):
        messages = [{"role": "user", "message": "hi"}]
        out, truncated = truncate_to_budget(messages, max_tokens=100)
        assert out == messages
        assert truncated is False

    def test_long_transcript_keeps_head_and_tail(self):
        messages = [
            {"role": "user", "message": f"message {i} " + "x" * 100}
            for i in range(100)
        ]
        out, truncated = truncate_to_budget(messages, max_tokens=100)
        assert truncated is True
        assert out[0]["message"].startswith("message 0")
        assert out[-1]["message"].startswith("message 99")
        assert any("truncated" in m.get("message", "") for m in out)

    def test_empty_transcript(self):
        assert truncate_to_budget([]) == ([], False)


class TestApplyScoreRollups:
    def test_parent_score_derived_from_children(self):
        defs = [_var("C1_Score", "score"), _var("C1a1_Score", "score"), _var("C1a2_Score", "score")]
        values = {"C1a1_Score": "4", "C1a2_Score": "2"}
        derived = apply_score_rollups(values, defs)
        assert values["C1_Score"] == "3"
        assert derived == ["C1_Score"]

    def test_no_overwrite_non_empty(self):
        defs = [_var("C1_Score", "score"), _var("C1a1_Score", "score")]
        values = {"C1_Score": "5", "C1a1_Score": "1"}
        derived = apply_score_rollups(values, defs)
        assert values["C1_Score"] == "5"
        assert derived == []

    def test_c10_not_picked_up_by_c1(self):
        defs = [_var("C1_Score", "score"), _var("C10_Score", "score")]
        values = {"C10_Score": "2"}
        derived = apply_score_rollups(values, defs)
        assert "C1_Score" not in values
        assert derived == []

    def test_nested_rollup_fixpoint(self):
        # C1_Score <- C1a_Score <- C1ax_Score: letter-chained prefixes resolve
        # over multiple passes regardless of derivation order.
        defs = [
            _var("C1_Score", "score"),
            _var("C1a_Score", "score"),
            _var("C1ax_Score", "score"),
        ]
        values = {"C1ax_Score": "4"}
        derived = apply_score_rollups(values, defs)
        assert values["C1a_Score"] == "4"
        assert values["C1_Score"] == "4"
        assert set(derived) == {"C1a_Score", "C1_Score"}


class TestApplyPlaceholders:
    def test_empty_scalar_becomes_not_discussed(self):
        defs = [_var("a")]
        values = {"a": ""}
        names = apply_placeholders(values, defs)
        assert values["a"] == NOT_DISCUSSED
        assert names == ["a"]

    def test_empty_list_becomes_not_discussed_list(self):
        defs = [_var("a", "list")]
        values = {"a": []}
        names = apply_placeholders(values, defs)
        assert values["a"] == [NOT_DISCUSSED]
        assert names == ["a"]

    def test_missing_key_also_placeholdered(self):
        defs = [_var("a"), _var("b", "list")]
        values: dict = {}
        names = apply_placeholders(values, defs)
        assert values == {"a": NOT_DISCUSSED, "b": [NOT_DISCUSSED]}
        assert set(names) == {"a", "b"}

    def test_non_empty_untouched(self):
        defs = [_var("a"), _var("b", "list")]
        values = {"a": "real", "b": ["one"]}
        names = apply_placeholders(values, defs)
        assert values == {"a": "real", "b": ["one"]}
        assert names == []


class TestBuildRunMetadata:
    def test_counts_chat_turns(self):
        run = type("R", (), {
            "created_at": datetime(2026, 10, 6, tzinfo=timezone.utc),
            "usage_info": {"call_duration_seconds": 120},
            "gathered_context": {"mapped_call_disposition": "completed"},
        })()
        messages = [
            {"role": "user", "message": "hi"},
            {"role": "agent", "message": "hello"},
            {"role": "user", "message": "bye"},
        ]
        meta = build_run_metadata(run, messages)
        assert meta["call_date"] == "2026-10-06"
        assert meta["call_duration_seconds"] == 120
        assert meta["call_disposition"] == "completed"
        assert meta["user_turns"] == 2
        assert meta["assistant_turns"] == 1
        assert meta["total_messages"] == 3

    def test_no_transcript_no_turn_counts(self):
        run = type("R", (), {
            "created_at": None, "usage_info": {}, "gathered_context": {},
        })()
        meta = build_run_metadata(run)
        assert "user_turns" not in meta
