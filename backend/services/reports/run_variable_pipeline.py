"""Run (conversation) report variable pipeline.

Produces a complete value for every report template variable so a rendered
report never contains blank cells. Seven stages:

    ASSEMBLE  → caller supplies transcript + variable definitions
    BUDGET    → truncate_to_budget (token-aware, no-op when it fits)
    EXTRACT   → batched concurrent LLM extraction from transcript + descriptions
    ENRICH    → apply_score_rollups (deterministic parent-score derivation)
    GAP-FILL  → fill_report_variable_gaps (LLM, empty keys only, rollup-aware)
    PLACEHOLDER → apply_placeholders ("Not discussed" for empty scalars and lists)
    META      → diagnostics dict persisted alongside the values

Pure helpers (truncate/rollup/placeholder/metadata) live in variable_engine;
LLM extraction lives in extraction. This module orchestrates the stages and
re-exports the pure helpers for backward-compatible imports.
"""

from __future__ import annotations

from typing import Any, List, Optional

from loguru import logger

from api.services.reports.variable_engine import (
    MAX_TRANSCRIPT_TOKENS,
    NOT_DISCUSSED,
    TRUNCATION_MARKER,
    ReportVariable,
    ReportVariableType,
    RunReportVariables,
    _is_empty_value,
    apply_metadata_values,
    apply_overall_score_fallback,
    apply_placeholders,
    apply_scaled_math_transforms,
    apply_score_rollups,
    apply_static_rubrics,
    build_run_metadata,
    classify_report_variables,
    truncate_to_budget,
)
from api.services.reports.extraction import (
    extract_report_variables_from_transcript,
    fill_report_variable_gaps,
)


async def build_run_report_variables(
    transcript_messages: Optional[list[dict]],
    report_variables: List[ReportVariable],
    llm_config: Optional[dict] = None,
    run_metadata: Optional[dict] = None,
    max_tokens: int = MAX_TRANSCRIPT_TOKENS,
) -> RunReportVariables:
    """Run the full pipeline and return values plus a diagnostics meta dict.

    Meta keys: total, truncated, extraction_missing (batch losses), derived
    (deterministic rollups), gap_fill_attempted, gap_filled, placeholdered,
    empty (names with no real content before placeholders).
    """
    if not report_variables:
        return RunReportVariables(values={}, meta={"total": 0})

    budgeted: list[dict] = []
    truncated = False
    if transcript_messages:
        budgeted, truncated = truncate_to_budget(transcript_messages, max_tokens)

    usable_llm = bool(llm_config and llm_config.get("api_key")) and bool(budgeted)

    values: dict[str, Any] = {}
    extraction_missing: list[str] = []
    token_usage: dict[str, int] = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}

    # 1. Classify variables into deterministic (locked) vs generative (unlocked)
    locked_defs, unlocked_defs, cat_map = classify_report_variables(
        report_variables, run_metadata
    )

    # 2. Pre-populate deterministic static rubrics directly (0 tokens)
    rubric_derived = apply_static_rubrics(values, locked_defs)

    # 3. Only extract variables that are NOT deterministic math transforms
    vars_to_extract = [
        v for v in report_variables
        if cat_map.get(v.name) != "math_scale" and _is_empty_value(values.get(v.name))
    ]

    if usable_llm and vars_to_extract:
        extracted = await extract_report_variables_from_transcript(
            transcript_messages=budgeted,
            report_variables=vars_to_extract,
            llm_config=llm_config,
            run_metadata=run_metadata,
            usage_accumulator=token_usage,
        )
        values.update(extracted)
        present = set(extracted) | set(rubric_derived)
        extraction_missing = [v.name for v in vars_to_extract if v.name not in present]
    elif transcript_messages and vars_to_extract:
        logger.warning(
            "Report variable extraction skipped: no LLM config or empty transcript "
            f"({len(report_variables)} variables will be derived or placeholdered)"
        )

    # 4. Deterministic post-extraction transformations: Rollups & Scaled math
    derived = apply_score_rollups(values, report_variables)
    scaled_derived = apply_scaled_math_transforms(values, report_variables)
    for name in scaled_derived:
        if name not in derived:
            derived.append(name)

    empty_defs = [
        v for v in report_variables
        if cat_map.get(v.name) != "math_scale" and _is_empty_value(values.get(v.name))
    ]
    gap_fill_attempted = False
    gap_filled: list[str] = []
    if usable_llm and empty_defs:
        gap_fill_attempted = True
        filled = await fill_report_variable_gaps(
            empty_variables=empty_defs,
            extracted_values=values,
            transcript_messages=budgeted,
            llm_config=llm_config,
            run_metadata=run_metadata,
            usage_accumulator=token_usage,
        )
        for name, value in filled.items():
            # Never overwrite a first-pass or rollup result.
            if _is_empty_value(value) or not _is_empty_value(values.get(name)):
                continue
            values[name] = value
        gap_filled = [
            v.name for v in empty_defs if not _is_empty_value(values.get(v.name))
        ]
        for name in apply_score_rollups(values, report_variables):
            if name not in derived:
                derived.append(name)
        for name in apply_scaled_math_transforms(values, report_variables):
            if name not in derived:
                derived.append(name)

    # 5. Overall score the LLM left empty → mean of the competency scores
    overall_filled = apply_overall_score_fallback(values, report_variables)
    if overall_filled:
        derived.extend(n for n in overall_filled if n not in derived)
        for name in apply_scaled_math_transforms(values, report_variables):
            if name not in derived:
                derived.append(name)

    unresolved = [v.name for v in report_variables if _is_empty_value(values.get(v.name))]
    placeholdered = apply_placeholders(values, report_variables)

    meta = {
        "total": len(report_variables),
        "truncated": truncated,
        "extraction_missing": extraction_missing,
        "derived": derived,
        "gap_fill_attempted": gap_fill_attempted,
        "gap_filled": gap_filled,
        "placeholdered": placeholdered,
        "empty": unresolved,
        "token_usage": token_usage,
    }

    logger.info(
        f"Report variables: {len(report_variables) - len(unresolved)}/{len(report_variables)} "
        f"with content | derived {len(derived)} | gap-filled {len(gap_filled)} | "
        f"placeholdered {len(placeholdered)} | batch-missing {len(extraction_missing)} | "
        f"truncated={truncated}"
    )
    return RunReportVariables(values=values, meta=meta)


__all__ = [
    "MAX_TRANSCRIPT_TOKENS",
    "NOT_DISCUSSED",
    "TRUNCATION_MARKER",
    "ReportVariable",
    "ReportVariableType",
    "RunReportVariables",
    "apply_placeholders",
    "apply_score_rollups",
    "apply_scaled_math_transforms",
    "apply_static_rubrics",
    "apply_metadata_values",
    "classify_report_variables",
    "build_run_metadata",
    "truncate_to_budget",
    "extract_report_variables_from_transcript",
    "fill_report_variable_gaps",
    "build_run_report_variables",
]
