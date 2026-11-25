"""Tests for the run report variable pipeline: truncation, rollups, gap-fill,
batch retry, run-metadata prompting, and the no-blank-values guarantee."""

import json
import re
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

from api.services.reports.report_context import (
    ReportVariable,
    ReportVariableType,
    extract_report_variables_from_transcript,
)
from api.services.reports.run_variable_pipeline import (
    NOT_DISCUSSED,
    TRUNCATION_MARKER,
    apply_metadata_values,
    apply_placeholders,
    apply_scaled_math_transforms,
    apply_score_rollups,
    apply_static_rubrics,
    build_run_metadata,
    build_run_report_variables,
    classify_report_variables,
    truncate_to_budget,
)

_VAR_LINE = re.compile(r"^- (\S+) \(type:", re.MULTILINE)


def _var(name: str, var_type: str = "text", description: str = "") -> ReportVariable:
    return ReportVariable(
        name=name, type=ReportVariableType(var_type), description=description
    )


class _FakeLLM:
    """OpenAI-compatible fake: handler(kwargs) returns the response content."""

    def __init__(self, handler):
        self.handler = handler
        self.calls: list[dict] = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    async def _create(self, **kwargs):
        self.calls.append(kwargs)
        content = self.handler(kwargs)
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=content))]
        )


def _patch_llm(fake: _FakeLLM):
    return patch(
        "api.services.reports.extraction.AsyncOpenAI",
        lambda **_kwargs: fake,
    )


def _requested_names(call: dict) -> list[str]:
    return _VAR_LINE.findall(call["messages"][1]["content"])


# --- Phase 1: truncation -------------------------------------------------


def test_truncate_noop_when_transcript_fits_budget():
    messages = [
        {"role": "user", "message": f"turn {i} " + "x" * 50} for i in range(10)
    ]
    result, truncated = truncate_to_budget(messages, max_tokens=12000)
    assert truncated is False
    assert result == messages


def test_truncate_over_budget_keeps_head_tail_and_marker():
    messages = [
        {"role": "user", "message": "m" * 400} for _ in range(200)
    ]
    result, truncated = truncate_to_budget(messages, max_tokens=12000)
    assert truncated is True
    roles = [m["message"] for m in result]
    assert TRUNCATION_MARKER in roles
    assert roles[0] == messages[0]["message"]
    assert roles[-1] == messages[-1]["message"]
    assert len(result) < len(messages)


def test_truncate_empty_and_single_message():
    assert truncate_to_budget([], max_tokens=100) == ([], False)
    big = [{"role": "user", "message": "y" * 100000}]
    result, truncated = truncate_to_budget(big, max_tokens=10)
    assert result == big
    assert truncated is False


# --- Phase 3a: deterministic rollups -------------------------------------


def test_rollup_derives_parent_score_from_children():
    defs = [
        _var("C1_Score", "score"),
        _var("C1a1_Score", "score"),
        _var("C1a2_Score", "score"),
    ]
    values = {"C1_Score": "", "C1a1_Score": "2", "C1a2_Score": "4"}
    derived = apply_score_rollups(values, defs)
    assert values["C1_Score"] == "3"
    assert derived == ["C1_Score"]


def test_rollup_never_overwrites_existing_value():
    defs = [_var("C1_Score", "score"), _var("C1a1_Score", "score")]
    values = {"C1_Score": "5", "C1a1_Score": "2"}
    derived = apply_score_rollups(values, defs)
    assert values["C1_Score"] == "5"
    assert derived == []


def test_rollup_excludes_digit_sibling_and_bare_score():
    # C1_Score must average C1a1_Score but not C10_Score; bare "Score" is left
    # to the gap-fill pass.
    defs = [
        _var("Score", "score"),
        _var("C1_Score", "score"),
        _var("C1a1_Score", "score"),
        _var("C10_Score", "score"),
    ]
    values = {"Score": "", "C1_Score": "", "C1a1_Score": "2", "C10_Score": "5"}
    derived = apply_score_rollups(values, defs)
    assert values["C1_Score"] == "2"
    assert values["Score"] == ""
    assert derived == ["C1_Score"]


def test_overall_score_fallback_averages_competency_scores():
    from api.services.reports.variable_engine import apply_overall_score_fallback

    defs = [
        _var("Score", "score"),
        _var("C1_Score", "score"), _var("C1a1_Score", "score"),
        _var("C2_Score", "score"), _var("C2a1_Score", "score"),
        _var("C3_Score", "score"), _var("C3a1_Score", "score"),
    ]
    # C3 not assessed: excluded from the mean. Aspect scores are not counted.
    values = {"Score": "", "C1_Score": "3.5", "C1a1_Score": "5",
              "C2_Score": "2.5", "C2a1_Score": "1", "C3_Score": ""}
    assert apply_overall_score_fallback(values, defs) == ["Score"]
    assert values["Score"] == "3"

    # An LLM-provided overall score is kept; nothing to average leaves it empty.
    kept = {"Score": "4.2", "C1_Score": "3"}
    assert apply_overall_score_fallback(kept, defs) == []
    assert kept["Score"] == "4.2"
    none = {"Score": ""}
    assert apply_overall_score_fallback(none, defs) == []
    assert none["Score"] == ""


def test_rollup_non_numeric_children_yield_no_derivation():
    defs = [_var("C1_Score", "score"), _var("C1a1_Score", "score")]
    values = {"C1_Score": "", "C1a1_Score": "not-a-number"}
    derived = apply_score_rollups(values, defs)
    assert values["C1_Score"] == ""
    assert derived == []


# --- Phase 3c: placeholders ----------------------------------------------


def test_placeholders_fill_empty_scalars_and_lists():
    defs = [
        _var("Notes"),
        _var("Highlights", "list"),
        _var("Summary"),
        _var("Scores", "list"),
    ]
    values = {"Notes": "", "Highlights": [], "Summary": "keep me", "Scores": ["a"]}
    placeholdered = apply_placeholders(values, defs)
    assert values["Notes"] == NOT_DISCUSSED
    assert values["Highlights"] == [NOT_DISCUSSED]
    assert values["Summary"] == "keep me"
    assert values["Scores"] == ["a"]
    assert placeholdered == ["Notes", "Highlights"]


def test_placeholders_cover_variables_missing_from_extraction():
    defs = [_var("LostInFailedBatch"), _var("LostList", "list")]
    values: dict = {}
    placeholdered = apply_placeholders(values, defs)
    assert values["LostInFailedBatch"] == NOT_DISCUSSED
    assert values["LostList"] == [NOT_DISCUSSED]
    assert placeholdered == ["LostInFailedBatch", "LostList"]


# --- run metadata ---------------------------------------------------------


def test_build_run_metadata_exposes_factual_fields():
    run = SimpleNamespace(
        created_at=datetime(2026, 3, 14, 10, 30, tzinfo=timezone.utc),
        usage_info={"call_duration_seconds": 42},
        gathered_context={"mapped_call_disposition": "user_hangup"},
    )
    meta = build_run_metadata(run)
    assert meta == {
        "call_date": "2026-03-14",
        "call_duration_seconds": 42,
        "call_disposition": "user_hangup",
    }


def test_build_run_metadata_counts_chat_turns():
    run = SimpleNamespace(
        created_at=datetime(2026, 3, 14, 10, 30, tzinfo=timezone.utc),
        usage_info={"call_duration_seconds": 42},
        gathered_context={},
    )
    messages = [
        {"role": "user", "message": "hi"},
        {"role": "agent", "message": "hello"},
        {"role": "user", "message": "bye"},
        {"role": "agent", "message": "goodbye"},
    ]
    meta = build_run_metadata(run, messages)
    assert meta["user_turns"] == 2
    assert meta["assistant_turns"] == 2
    assert meta["total_messages"] == 4


# --- Phase 2: extraction hardening ---------------------------------------


def test_extraction_batch_retries_split_after_unparseable_json():
    responses = [
        "this is not json",
        "still not json",
        json.dumps({"VarA": "alpha"}),
        json.dumps({"VarB": "beta"}),
    ]
    fake = _FakeLLM(lambda _kwargs: responses.pop(0))
    defs = [_var("VarA"), _var("VarB")]

    with _patch_llm(fake):
        import asyncio

        merged = asyncio.run(
            extract_report_variables_from_transcript(
                transcript_messages=[{"role": "user", "message": "hello"}],
                report_variables=defs,
                llm_config={"api_key": "k", "model": "m", "base_url": "u"},
            )
        )

    assert merged == {"VarA": "alpha", "VarB": "beta"}
    assert len(fake.calls) == 4


def test_extraction_includes_run_metadata_in_prompt():
    fake = _FakeLLM(lambda kwargs: json.dumps({"Date": "2026-03-14"}))
    with _patch_llm(fake):
        import asyncio

        merged = asyncio.run(
            extract_report_variables_from_transcript(
                transcript_messages=[{"role": "user", "message": "hello"}],
                report_variables=[_var("Date")],
                llm_config={"api_key": "k", "model": "m", "base_url": "u"},
                run_metadata={"call_date": "2026-03-14", "call_disposition": ""},
            )
        )

    assert merged == {"Date": "2026-03-14"}
    user_prompt = fake.calls[0]["messages"][1]["content"]
    assert "call_date: 2026-03-14" in user_prompt
    assert "call_disposition" not in user_prompt


def test_extraction_without_llm_config_returns_empty():
    import asyncio

    merged = asyncio.run(
        extract_report_variables_from_transcript(
            transcript_messages=[{"role": "user", "message": "hello"}],
            report_variables=[_var("X")],
            llm_config=None,
        )
    )
    assert merged == {}


# --- pipeline end-to-end --------------------------------------------------


def _scripted_handler(first_pass: dict, second_pass: dict):
    """Returns LLM content for extraction vs gap-fill prompts."""

    def handler(kwargs):
        user_prompt = kwargs["messages"][1]["content"]
        names = _VAR_LINE.findall(user_prompt)
        source = second_pass if "Variables to fill" in user_prompt else first_pass
        return json.dumps({name: source.get(name, "") for name in names})

    return handler


def test_pipeline_end_to_end_yields_no_empty_values():
    defs = [
        _var("Summary", description="executive summary"),
        _var("Score", "score"),
        _var("C1_Score", "score"),
        _var("C1a1_Score", "score"),
        _var("C1a2_Score", "score"),
        _var("Notes"),
        _var("Highlights", "list"),
        _var("Date"),
    ]
    first_pass = {
        "Summary": "Candidate aligned production with QA.",
        "Score": "",
        "C1_Score": "",
        "C1a1_Score": "2",
        "C1a2_Score": "4",
        "Notes": "",
        "Highlights": [],
        "Date": "",
    }
    second_pass = {
        "Score": "3",
        "Date": "2026-03-14",
        "Notes": "",
        "Highlights": [],
    }
    fake = _FakeLLM(_scripted_handler(first_pass, second_pass))

    with _patch_llm(fake):
        import asyncio

        result = asyncio.run(
            build_run_report_variables(
                transcript_messages=[
                    {"role": "user", "message": "we reduce complexity"},
                    {"role": "agent", "message": "tell me more"},
                ],
                report_variables=defs,
                llm_config={"api_key": "k", "model": "m", "base_url": "u"},
                run_metadata={"call_date": "2026-03-14"},
            )
        )

    values = result.values
    # Extraction value untouched by gap-fill.
    assert values["Summary"] == "Candidate aligned production with QA."
    # Deterministic rollup from sub-scores.
    assert values["C1_Score"] == "3"
    # Gap-fill populated the empty scalars only.
    assert values["Score"] == "3"
    assert values["Date"] == "2026-03-14"
    # Still-empty scalar and list got placeholders.
    assert values["Notes"] == NOT_DISCUSSED
    assert values["Highlights"] == [NOT_DISCUSSED]
    # Nothing anywhere is blank: scalars non-empty, lists non-empty.
    assert all(str(v).strip() for v in values.values() if not isinstance(v, list))
    assert all(len(v) > 0 for v in values.values() if isinstance(v, list))

    meta = result.meta
    assert meta["total"] == len(defs)
    assert meta["derived"] == ["C1_Score"]
    assert meta["gap_fill_attempted"] is True
    assert "Date" in meta["gap_filled"] and "Score" in meta["gap_filled"]
    assert meta["placeholdered"] == ["Notes", "Highlights"]
    assert meta["empty"] == ["Notes", "Highlights"]
    assert meta["truncated"] is False
    assert meta["extraction_missing"] == []


def test_pipeline_without_llm_placeholders_everything():
    defs = [_var("Summary"), _var("Highlights", "list")]
    import asyncio

    result = asyncio.run(
        build_run_report_variables(
            transcript_messages=[{"role": "user", "message": "hi"}],
            report_variables=defs,
            llm_config=None,
        )
    )
    assert result.values == {"Summary": NOT_DISCUSSED, "Highlights": [NOT_DISCUSSED]}
    assert result.meta["gap_fill_attempted"] is False
    assert sorted(result.meta["empty"]) == ["Highlights", "Summary"]


def test_pipeline_marks_failed_batch_variables():
    # Every LLM reply is unparseable → batch split also fails → extraction
    # returns nothing → placeholders still guarantee renderable values.
    fake = _FakeLLM(lambda _kwargs: "not json at all")
    defs = [_var("Alpha"), _var("Beta")]

    with _patch_llm(fake):
        import asyncio

        result = asyncio.run(
            build_run_report_variables(
                transcript_messages=[{"role": "user", "message": "hello"}],
                report_variables=defs,
                llm_config={"api_key": "k", "model": "m", "base_url": "u"},
            )
        )

    assert result.values == {"Alpha": NOT_DISCUSSED, "Beta": NOT_DISCUSSED}
    assert sorted(result.meta["extraction_missing"]) == ["Alpha", "Beta"]
    assert sorted(result.meta["empty"]) == ["Alpha", "Beta"]


# --- Scaled Variable Classification & Math Optimization Tests -------------


def test_classify_report_variables_detects_all_categories():
    defs = [
        _var("Call_Date", description="Call date"),
        _var("Call_Duration_Seconds", "number"),
        _var("C1_Title", description="Planning & Decision Making"),
        _var("C1a1_Anchor", description="Demonstrates structured planning with clear timelines"),
        _var("C1a1_Score_5_100round", "number"),
        _var("C1_Score", "score"),
        _var("C1a1_Score", "score"),
        _var("C1a1_Ev", description="Evidence from interview"),
        _var("Summary", description="Executive summary"),
    ]
    meta = {"call_date": "2026-03-14", "call_duration_seconds": 120}

    locked, unlocked, cat_map = classify_report_variables(defs, meta)

    locked_names = {v.name for v in locked}
    unlocked_names = {v.name for v in unlocked}

    assert "Call_Date" in locked_names and cat_map["Call_Date"] == "metadata"
    assert "Call_Duration_Seconds" in locked_names and cat_map["Call_Duration_Seconds"] == "metadata"
    assert "C1_Title" in locked_names and cat_map["C1_Title"] == "static_rubric"
    assert "C1a1_Anchor" in locked_names and cat_map["C1a1_Anchor"] == "static_rubric"
    assert "C1a1_Score_5_100round" in locked_names and cat_map["C1a1_Score_5_100round"] == "math_scale"
    assert "C1_Score" in locked_names and cat_map["C1_Score"] == "score_rollup"

    assert "C1a1_Score" in unlocked_names
    assert "C1a1_Ev" in unlocked_names
    assert "Summary" in unlocked_names


def test_apply_scaled_math_transforms_handles_100round_and_pct():
    defs = [
        _var("C1a1_Score_5_100round", "number"),
        _var("C1_Score_5_100round", "number"),
        _var("C2_pct", "number"),
    ]
    values = {
        "C1a1_Score": "4",
        "C1_Score": "3.5",
        "C2_Score": "4.5",
    }
    derived = apply_scaled_math_transforms(values, defs)

    assert values["C1a1_Score_5_100round"] == "80"
    assert values["C1_Score_5_100round"] == "70"
    assert values["C2_pct"] == "90"
    assert set(derived) == {"C1a1_Score_5_100round", "C1_Score_5_100round", "C2_pct"}


def test_apply_static_rubrics_populates_anchors_and_titles():
    defs = [
        _var("C1_Title", description="Planning & Decision Making"),
        _var("C1a1_Anchor", description="Demonstrates structured planning with clear timelines"),
        _var("Candidate_Strengths", description="Extract 3 candidate strengths"),
    ]
    values: dict = {}
    applied = apply_static_rubrics(values, defs)

    assert values["C1_Title"] == "Planning & Decision Making"
    assert values["C1a1_Anchor"] == "Demonstrates structured planning with clear timelines"
    assert "Candidate_Strengths" not in values
    assert set(applied) == {"C1_Title", "C1a1_Anchor"}


_ASPECT_NAME_DESC = (
    'Short name for aspect 1.1, "Challenge diagnosis". Keep the aspect meaning stable '
    "across candidates so that the score remains comparable; this card focuses on the "
    "candidate's identification of the main operational problems and their effects. Do "
    "not switch to a different behavior just because a transcript discusses a different example."
)
_ASPECT_ANCHOR_DESC = (
    'Brief supporting line under "Challenge diagnosis", normally a compact phrase that '
    "names the issue or behavior actually discussed. It should orient the reader to the "
    "candidate's identification of the main operational problems and their effects, "
    "without claiming an outcome, diagnosis, or job fact that the candidate did not provide."
)


def test_instructional_descriptions_are_not_rendered_verbatim():
    defs = [
        _var("C1a1_Name", description=_ASPECT_NAME_DESC),
        _var("C1a1_Anchor", description=_ASPECT_ANCHOR_DESC),
    ]
    values: dict = {}
    applied = apply_static_rubrics(values, defs)

    # The name takes the quoted label; the anchor is left for extraction.
    assert values == {"C1a1_Name": "Challenge diagnosis"}
    assert applied == ["C1a1_Name"]

    _, unlocked, cat_map = classify_report_variables(defs, {})
    assert cat_map["C1a1_Name"] == "static_rubric"
    assert [v.name for v in unlocked] == ["C1a1_Anchor"]


def test_pipeline_skips_llm_for_locked_variables():
    defs = [
        _var("C1_Title", description="Planning & Strategy"),
        _var("C1a1_Anchor", description="Consistently sets structured operational goals"),
        _var("C1_Score", "score"),
        _var("C1a1_Score", "score"),
        _var("C1a2_Score", "score"),
        _var("C1a1_Score_5_100round", "number"),
        _var("C1_Score_5_100round", "number"),
        _var("C1a1_Ev", description="Evidence from transcript"),
    ]

    llm_prompts: list[str] = []

    def handler(kwargs):
        content = kwargs["messages"][1]["content"]
        llm_prompts.append(content)
        names = _VAR_LINE.findall(content)
        res = {}
        if "C1a1_Score" in names:
            res["C1a1_Score"] = "4"
        if "C1a2_Score" in names:
            res["C1a2_Score"] = "2"
        if "C1a1_Ev" in names:
            res["C1a1_Ev"] = "Candidate established clear weekly reviews."
        return json.dumps(res)

    fake = _FakeLLM(handler)

    with _patch_llm(fake):
        import asyncio

        result = asyncio.run(
            build_run_report_variables(
                transcript_messages=[{"role": "user", "message": "I run weekly sprint planning"}],
                report_variables=defs,
                llm_config={"api_key": "k", "model": "m", "base_url": "u"},
            )
        )

    assert len(llm_prompts) >= 1
    first_prompt = llm_prompts[0]
    assert "C1a1_Score_5_100round" not in first_prompt
    assert "C1_Score_5_100round" not in first_prompt
    assert "C1a1_Anchor" not in first_prompt
    assert "C1_Title" not in first_prompt

    vals = result.values
    assert vals["C1_Title"] == "Planning & Strategy"
    assert vals["C1a1_Anchor"] == "Consistently sets structured operational goals"
    assert vals["C1a1_Score"] == "4"
    assert vals["C1a2_Score"] == "2"
    assert vals["C1_Score"] == "3"
    assert vals["C1a1_Score_5_100round"] == "80"
    assert vals["C1_Score_5_100round"] == "60"
    assert vals["C1a1_Ev"] == "Candidate established clear weekly reviews."
