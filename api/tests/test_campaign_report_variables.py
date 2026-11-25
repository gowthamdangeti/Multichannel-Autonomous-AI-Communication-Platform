"""Tests for the unified campaign report variable pipeline: batched extraction,
domain-specific prompts, gap-fill, rollups, placeholders, cache self-heal,
and quota-error propagation."""

import json
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from api.services.reports.variable_engine import (
    CAMPAIGN_BUILTIN_VARS,
    NOT_DISCUSSED,
    ReportVariable,
    ReportVariableType,
    missing_cached_vars,
    resolve_definitions,
)
from api.services.reports.extraction import (
    extract_campaign_report_variables,
    fill_campaign_variable_gaps,
)
from api.services.reports.campaign_report_aggregator import (
    finalize_campaign_variables,
)


def _var(name: str, var_type: str = "text", description: str = "") -> ReportVariable:
    return ReportVariable(
        name=name, type=ReportVariableType(var_type), description=description
    )


class _FakeLLM:
    def __init__(self, handler):
        self.handler = handler
        self.calls: list[dict] = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    async def _create(self, **kwargs):
        self.calls.append(kwargs)
        content = self.handler(kwargs)
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])


def _patch_llm(fake: _FakeLLM):
    return patch(
        "api.services.reports.extraction.AsyncOpenAI",
        lambda **_kwargs: fake,
    )


def _names_from_prompt(kwargs: dict) -> list[str]:
    user = kwargs["messages"][1]["content"]
    names = []
    for line in user.splitlines():
        if line.startswith("- **"):
            names.append(line.split("**", 2)[1])
    return names


class TestExtractCampaignReportVariables:
    @pytest.mark.asyncio
    async def test_returns_empty_without_defs_or_data_or_config(self):
        defs = [_var("a")]
        assert await extract_campaign_report_variables({}, defs, None) == {}
        assert await extract_campaign_report_variables({"x": 1}, [], None) == {}
        assert await extract_campaign_report_variables({"x": 1}, defs, {}) == {}

    @pytest.mark.asyncio
    async def test_batched_extraction_merges_and_formats(self):
        defs = [_var(f"v{i}") for i in range(30)]
        fake = _FakeLLM(
            lambda kwargs: json.dumps({v: f"val-{v}" for v in _names_from_prompt(kwargs)})
        )
        with _patch_llm(fake):
            result = await extract_campaign_report_variables(
                {"total_calls": 10}, defs, {"api_key": "k", "model": "m"}
            )
        assert len(fake.calls) == 2  # 25 + 5
        assert result["v0"] == "val-v0"
        assert result["v29"] == "val-v29"

    @pytest.mark.asyncio
    async def test_specific_var_prompt_used_for_campaign_summary(self):
        defs = [_var("campaign_summary")]
        fake = _FakeLLM(lambda kwargs: json.dumps({"campaign_summary": "Solid campaign."}))
        with _patch_llm(fake):
            await extract_campaign_report_variables(
                {"total_calls": 5}, defs, {"api_key": "k"}
            )
        user_prompt = fake.calls[0]["messages"][1]["content"]
        assert "executive summary" in user_prompt.lower()

    @pytest.mark.asyncio
    async def test_quota_error_propagates(self):
        class _QuotaErr(Exception):
            pass

        async def _raise(**kwargs):
            raise _QuotaErr("429 rate limit exceeded")

        class _QuotaLLM:
            chat = SimpleNamespace(completions=SimpleNamespace(create=_raise))

        defs = [_var("a")]
        with patch("api.services.reports.extraction.AsyncOpenAI", lambda **_k: _QuotaLLM()):
            with pytest.raises(_QuotaErr):
                await extract_campaign_report_variables(
                    {"x": 1}, defs, {"api_key": "k"}
                )


class TestFillCampaignVariableGaps:
    @pytest.mark.asyncio
    async def test_only_requested_keys_returned(self):
        defs = [_var("a"), _var("b")]
        fake = _FakeLLM(lambda kwargs: json.dumps({"a": "filled", "b": "ignored-later"}))
        with _patch_llm(fake):
            result = await fill_campaign_variable_gaps(
                empty_variables=[defs[0]],
                extracted_values={"b": "existing"},
                campaign_payload={"total_calls": 3},
                llm_config={"api_key": "k"},
            )
        assert "a" in result
        assert "b" not in result  # not requested

    @pytest.mark.asyncio
    async def test_empty_inputs_return_empty(self):
        assert await fill_campaign_variable_gaps([], {}, {}, None) == {}


class TestFinalizeCampaignVariables:
    @pytest.mark.asyncio
    async def test_rollup_then_placeholder_and_meta(self):
        defs = [
            _var("C1_Score", "score"),
            _var("C1a1_Score", "score"),
            _var("summary"),
            _var("findings", "list"),
        ]
        values = {"C1a1_Score": "4", "summary": "Done."}
        meta = await finalize_campaign_variables(values, defs)
        assert values["C1_Score"] == "4"  # rollup from child
        assert values["summary"] == "Done."
        assert values["findings"] == [NOT_DISCUSSED]
        assert meta["derived"] == ["C1_Score"]
        assert meta["placeholdered"] == ["findings"]
        assert meta["total"] == 4

    @pytest.mark.asyncio
    async def test_gap_fill_called_when_empty_and_payload_present(self):
        defs = [_var("a"), _var("b")]
        values = {"a": "", "b": ""}
        fake = _FakeLLM(lambda kwargs: json.dumps({"a": "gap-a", "b": "gap-b"}))
        with _patch_llm(fake):
            meta = await finalize_campaign_variables(
                values,
                defs,
                payload={"total_calls": 7},
                llm_config={"api_key": "k"},
            )
        assert values["a"] == "gap-a"
        assert values["b"] == "gap-b"
        assert meta["gap_fill_attempted"] is True
        assert set(meta["gap_filled"]) == {"a", "b"}
        assert meta["placeholdered"] == []

    @pytest.mark.asyncio
    async def test_no_gap_fill_without_llm_config(self):
        defs = [_var("a")]
        values = {"a": ""}
        meta = await finalize_campaign_variables(values, defs, payload={"x": 1}, llm_config=None)
        assert values["a"] == NOT_DISCUSSED
        assert meta["gap_fill_attempted"] is False


class TestCampaignCacheSelfHeal:
    def test_resolve_definitions_excludes_builtins(self):
        html = "{{ campaign_name }} {{ campaign_summary }} {{ total_calls }}"
        resolved = resolve_definitions(html, [], exclude=CAMPAIGN_BUILTIN_VARS)
        names = {v.name for v in resolved}
        assert "campaign_name" not in names
        assert "total_calls" not in names
        assert "campaign_summary" in names

    def test_legacy_empty_cache_heals(self):
        defs = [_var("campaign_summary"), _var("key_findings", "list")]
        cached = {"campaign_summary": "", "key_findings": []}
        missing = missing_cached_vars(defs, cached)
        assert {v.name for v in missing} == {"campaign_summary", "key_findings"}
