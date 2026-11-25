"""Report variable extraction — the only module that calls an LLM for variables.

Shared by run and campaign report pipelines:

- batched, concurrency-bounded extraction with split-half retry and JSON repair
- gap-fill second pass (empty keys only, given already-extracted values)
- campaign extraction unified here (batched + domain-specific var prompts)
- quota / rate-limit errors always propagate so callers can mark the report failed

Imports only variable_engine (pure) — never context builders or pipelines.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, List, Optional

from loguru import logger
from openai import AsyncOpenAI

from api.services.gen_ai.json_parser import parse_llm_json
from api.services.workflow.usage_contract import cached_prompt_tokens
from api.services.reports.variable_engine import (
    ReportVariable,
    ReportVariableType,
    _flatten_json,
    _format_report_value,
    _is_empty_value,
)
from api.services.gen_ai.temperature import create_chat_completion

# Batch size for LLM variable extraction. Modern models (Gemini Flash, GPT-4o-mini)
# easily handle 50+ variables per call within their 8k output window. This cuts
# transcript resends in half while split-half retry protects against JSON truncation.
REPORT_EXTRACT_BATCH_SIZE = 50

# Max concurrent LLM batch calls during extraction. Keeps latency near one batch
# round-trip for large templates without opening an unbounded fan-out.
EXTRACT_CONCURRENCY = 4


def _is_quota_error(exc: BaseException) -> bool:
    """Detect rate-limit / quota exhaustion without touching model configuration."""
    msg = f"{type(exc).__name__}: {exc}".lower()
    return any(
        s in msg
        for s in (
            "429",
            "resource_exhausted",
            "quota",
            "rate limit",
            "rate_limit",
            "retryinfo",
            "too many requests",
        )
    )


def _vars_block(report_variables: List[ReportVariable]) -> str:
    return "\n".join(
        f"- {v.name} (type: {v.type.value}): {v.description or 'No description'}"
        for v in report_variables
    )


def _metadata_block(run_metadata: Optional[dict]) -> str:
    if not run_metadata:
        return ""
    lines = [
        f"- {key}: {value}"
        for key, value in run_metadata.items()
        if value not in (None, "")
    ]
    if not lines:
        return ""
    return "\n\nRun metadata:\n" + "\n".join(lines)


def _transcript_to_text(messages: list[dict]) -> str:
    lines = []
    for m in messages:
        role = m.get("role", "unknown")
        text = m.get("message", "")
        lines.append(f"{role}: {text}")
    return "\n".join(lines)


EXTRACTION_SYSTEM_PROMPT = (
    "You are a template-based report data generator. Generate the variable values "
    "needed to fill the supplied report template. The template may be for any industry "
    "or report type. Do not change its layout.\n\n"
    "For each request, use the supplied variable definitions and source transcript. "
    "Each variable has an exact name and description and a type. Use each description "
    "to determine what its value should contain.\n\n"
    "Output contract:\n"
    "- Return ONLY one valid JSON object. No markdown fences, no commentary.\n"
    "- Keys must exactly match the supplied variable names. Include every key once, "
    "preserve capitalization and dotted names, and add no other keys.\n"
    "- Keep dotted names as flat keys — e.g. {\"company.name\": \"...\"} "
    "NOT {\"company\": {\"name\": \"...\"}}.\n\n"
    "Types and constraints:\n"
    "- text → 1-3 professional, concise sentences for an executive report.\n"
    "- list → a JSON array of 1-3 concise complete sentences (fewer when the transcript "
    "supports fewer).\n"
    "- score / number / range → a JSON number (ratings are 1-5 unless the description says otherwise).\n"
    "- yes_no → true or false only.\n"
    "- Quote / excerpt variables → a contiguous verbatim candidate phrase copied from the "
    "transcript without rewriting, or an empty string when none exists.\n\n"
    "Grounding:\n"
    "- Ground generated facts in the supplied transcript. Do not invent names, figures, "
    "events, outcomes, or quotes. Distinguish what the candidate stated from what the "
    "interviewer suggested. Never turn interviewer suggestions into candidate achievements.\n"
    "- Use the transcript AND the variable description to generate the value.\n"
    "- Every variable must get a unique value — never copy-paste the same sentence, "
    "paraphrase, or quote into two variables. Even when two variables draw on the same "
    "transcript section, write each from a different angle matching its own description, "
    "with different wording and different detail.\n"
    "- Quote / excerpt variables must each use a different contiguous verbatim phrase "
    "from the transcript. Pick different transcript lines or different sub-spans — never "
    "return the exact same quote string twice.\n"
    "- When a requested variable summarizes other requested variables (a rollup or "
    "category score such as C1_Score built from C1a1_Score and C1a2_Score) and the "
    "transcript gives no direct evidence, derive it from the sub-values you generate "
    "in this response (mean, rounded to a sensible precision) instead of leaving it "
    "empty. Never use a made-up score with no supporting sub-values.\n"
    "- Use the Run metadata block for factual fields (dates, durations, dispositions, "
    "chat/turn counts) when the transcript does not state them.\n"
    "- For unavailable information return \"\" for a scalar or [] for a list. "
    "Never use a made-up score to fill an unanswered field.\n\n"
    "Before returning, check that the JSON parses, every requested key is present, "
    "values have the correct types, and generated claims are supported by the source data."
)

GAP_FILL_SYSTEM_PROMPT = (
    "You are completing a partially generated report dataset. Some variables already "
    "have values; the requested variables are still empty and must be filled now.\n\n"
    "Output contract:\n"
    "- Return ONLY one valid JSON object. No markdown fences, no commentary.\n"
    "- Keys must exactly match the requested variable names. Include every requested "
    "key once and add no other keys.\n"
    "- Keep dotted names as flat keys.\n\n"
    "Filling rules:\n"
    "- When a requested variable summarizes variables that already have values (a "
    "rollup or category score such as C1_Score built from C1a1_Score and C1a2_Score), "
    "derive it from those values (mean, rounded to a sensible precision). This is the "
    "preferred way to fill aggregate variables.\n"
    "- Otherwise ground the value in the transcript and the variable description. Do "
    "not invent names, figures, events, outcomes, or quotes.\n"
    "- Every filled variable must be unique — never copy an already-extracted value or "
    "rephrase it with the same words. The context lists taken values: write each new "
    "variable from a different angle, with different wording matching its own description, "
    "even when the transcript source overlaps.\n"
    "- Use the Run metadata block for factual fields (dates, durations, dispositions, "
    "chat/turn counts) when the transcript does not state them.\n"
    "- Quote variables → a contiguous verbatim candidate phrase from the transcript, "
    "or an empty string when none exists.\n"
    "- text → 1-3 professional, concise sentences. list → a JSON array of 1-3 concise "
    "complete sentences. score / number → a JSON number. yes_no → true or false.\n"
    "- For information that is genuinely unavailable, return \"\" for a scalar or [] "
    "for a list. Never use a made-up score.\n\n"
    "Before returning, check that the JSON parses, every requested key is present, "
    "and values have the correct types."
)

CAMPAIGN_EXTRACTION_SYSTEM_PROMPT = (
    "You are a template-based report data generator. Generate the variable values "
    "needed to fill the supplied campaign report template. The template may be for any "
    "industry or report type. Do not change its layout.\n\n"
    "For each request, use the supplied variable definitions and aggregate campaign data. "
    "Each variable has an exact name and description and a type. Use each description "
    "to determine what its value should contain.\n\n"
    "Output contract:\n"
    "- Return ONLY one valid JSON object. No markdown fences, no commentary.\n"
    "- Keys must exactly match the supplied variable names. Include every key once, "
    "preserve capitalization and dotted names, and add no other keys.\n"
    "- Keep dotted names as flat keys.\n\n"
    "Types and constraints:\n"
    "- text → professional, executive-ready paragraph(s) summarizing the data clearly.\n"
    "- list → a JSON array of concise bullet items.\n"
    "- score / range / number → a JSON numeric value.\n"
    "- yes_no → true or false only.\n\n"
    "Grounding:\n"
    "- Ground insights strictly in the supplied campaign metrics and call outcomes. "
    "Do not invent names, figures, events, outcomes, or quotes. Do not make up "
    "non-existent metrics; refer to actual connection rates, disposition counts, and outcomes.\n"
    "- For unavailable information return \"\" for a scalar or [] for a list. "
    "Never use a made-up score to fill a field with no supporting data.\n\n"
    "Before returning, check that the JSON parses, every requested key is present, "
    "values have the correct types, and generated claims are supported by the source data."
)

CAMPAIGN_GAP_FILL_SYSTEM_PROMPT = (
    "You are completing a partially generated campaign report dataset. Some variables "
    "already have values; the requested variables are still empty and must be filled now.\n\n"
    "Output contract:\n"
    "- Return ONLY one valid JSON object. No markdown fences, no commentary.\n"
    "- Keys must exactly match the requested variable names. Include every requested "
    "key once and add no other keys.\n"
    "- Keep dotted names as flat keys.\n\n"
    "Filling rules:\n"
    "- When a requested variable summarizes variables that already have values (a rollup "
    "or aggregate), derive it from those values instead of inventing one.\n"
    "- Otherwise ground the value in the aggregate campaign data and the variable "
    "description. Do not invent metrics, causes, percentages, or outcomes.\n"
    "- text → professional, executive-ready sentences. list → a JSON array of concise "
    "bullet items. score / number → a JSON number. yes_no → true or false.\n"
    "- For information that is genuinely unavailable, return \"\" for a scalar or [] "
    "for a list.\n\n"
    "Before returning, check that the JSON parses and every requested key is present."
)

# Domain-specific variable prompts for campaign qualitative fields.
CAMPAIGN_SPECIFIC_VAR_PROMPTS = {
    "campaign_description": (
        "Generate a concise and professional campaign description in 1–3 sentences. "
        "Explain the purpose of the campaign, target audience, and primary objective. "
        "Do not include performance statistics or invent information. Return text without headings."
    ),
    "campaign_summary": (
        "Generate a concise professional executive summary of the campaign in 2–4 sentences. "
        "Summarize overall campaign execution, total outreach, connection performance, completion or objective results, and follow-up requirements. "
        "Do not invent reasons, percentages, or business conclusions. Do not add a heading."
    ),
    "key_findings": (
        "Generate 3 to 5 concise key findings from campaign results based strictly on available data. "
        "Focus on connection performance, completion rate, call dispositions, objective outcomes, and follow-up patterns. "
        "Format each finding as a short bullet point. Do not add a heading."
    ),
    "recommended_next_actions": (
        "Generate 2 to 5 concise operational next actions based directly on campaign results. "
        "Include processing requested callbacks, retrying unreachable targets, reviewing failed calls, and handling follow-up contacts. "
        "Format each action as a short bullet point. Do not add a heading."
    ),
    "target.next_action": (
        "Generate one concise next action for this campaign target based only on individual call result. "
        "Example: Retry call, Schedule requested callback, Follow up with customer. Return one short sentence or phrase."
    ),
    "contact.follow_up_reason": (
        "Generate a concise reason explaining why this customer requires follow-up in one short sentence."
    ),
    "contact.next_action": (
        "Generate one concise operational action for this follow-up contact based on recorded outcome."
    ),
}


def _accumulate_usage(usage_accumulator: Optional[dict], response_obj: Any) -> None:
    if usage_accumulator is None or not response_obj:
        return
    usage = getattr(response_obj, "usage", None)
    if not usage:
        return
    usage_accumulator["prompt_tokens"] = usage_accumulator.get("prompt_tokens", 0) + (
        getattr(usage, "prompt_tokens", 0) or 0
    )
    usage_accumulator["completion_tokens"] = usage_accumulator.get("completion_tokens", 0) + (
        getattr(usage, "completion_tokens", 0) or 0
    )
    usage_accumulator["total_tokens"] = usage_accumulator.get("total_tokens", 0) + (
        getattr(usage, "total_tokens", 0) or 0
    )
    usage_accumulator["cache_read_input_tokens"] = usage_accumulator.get(
        "cache_read_input_tokens", 0
    ) + cached_prompt_tokens(usage)


async def _complete_json(
    client: AsyncOpenAI,
    model: str,
    messages: list[dict],
    temperature: float,
    usage_accumulator: Optional[dict] = None,
) -> Optional[dict]:
    """One primary call plus one JSON-repair retry. Returns parsed dict or None.

    Raises on quota/rate-limit errors so the caller can abort batching early
    instead of burning quota on further batches. Never changes model/key.
    """
    kwargs: dict[str, Any] = dict(
        model=model,
        messages=messages,
        temperature=temperature,
    )
    try:
        try:
            kwargs["response_format"] = {"type": "json_object"}
            response = await create_chat_completion(client, **kwargs)
        except Exception as e:
            if _is_quota_error(e):
                raise
            kwargs.pop("response_format", None)
            response = await create_chat_completion(client, **kwargs)
    except Exception as e:
        if _is_quota_error(e):
            logger.error(f"Report extraction aborted: LLM quota/rate-limit hit: {e}")
            raise
        logger.error(f"Failed to extract report variables via LLM: {e}")
        return None

    _accumulate_usage(usage_accumulator, response)

    content = response.choices[0].message.content if response.choices else None
    if not content:
        return None
    parsed = parse_llm_json(content)
    if isinstance(parsed, dict) and "raw" not in parsed:
        return parsed

    # Single repair retry: ask only for valid JSON, same keys.
    try:
        repair_messages = [
            *messages,
            {"role": "assistant", "content": content},
            {
                "role": "user",
                "content": (
                    "Your previous reply was not valid JSON. Reply again with ONLY "
                    "the corrected valid JSON object, same keys, no markdown fences, "
                    "no commentary."
                ),
            },
        ]
        repair_kwargs: dict[str, Any] = dict(
            model=model, messages=repair_messages, temperature=0,
        )
        try:
            repair_kwargs["response_format"] = {"type": "json_object"}
            repair_response = await create_chat_completion(client, **repair_kwargs)
        except Exception as e:
            if _is_quota_error(e):
                raise
            repair_kwargs.pop("response_format", None)
            repair_response = await create_chat_completion(client, **repair_kwargs)

        _accumulate_usage(usage_accumulator, repair_response)

        repair_content = (
            repair_response.choices[0].message.content if repair_response.choices else None
        )
        if repair_content:
            repaired = parse_llm_json(repair_content)
            if isinstance(repaired, dict) and "raw" not in repaired:
                return repaired
    except Exception as e:
        if _is_quota_error(e):
            logger.error(f"Report extraction repair aborted: quota hit: {e}")
            raise
        logger.error(f"Report extraction JSON repair failed: {e}")
    logger.error("Report extraction returned unparseable JSON after repair retry")
    return None


async def _complete_batch_values(
    client: AsyncOpenAI,
    model: str,
    batch: List[ReportVariable],
    system_prompt: str,
    build_user_prompt,
    temperature: float,
    allow_split: bool = True,
    usage_accumulator: Optional[dict] = None,
) -> dict[str, Any]:
    """Extract one batch; retry once split in halves if the JSON cannot be parsed.

    Returns name → formatted value for the batch. A batch that fails entirely
    yields no keys, letting callers detect the loss by missing names.
    """
    parsed = await _complete_json(
        client,
        model,
        [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": build_user_prompt(batch)},
        ],
        temperature=temperature,
        usage_accumulator=usage_accumulator,
    )
    if parsed is None:
        if allow_split and len(batch) > 1:
            mid = len(batch) // 2
            logger.warning(
                f"Report extraction batch of {len(batch)} failed JSON parsing; "
                f"retrying split {mid}/{len(batch) - mid}"
            )
            left = await _complete_batch_values(
                client, model, batch[:mid], system_prompt, build_user_prompt,
                temperature, allow_split=False,
                usage_accumulator=usage_accumulator,
            )
            right = await _complete_batch_values(
                client, model, batch[mid:], system_prompt, build_user_prompt,
                temperature, allow_split=False,
                usage_accumulator=usage_accumulator,
            )
            return {**left, **right}
        logger.error(
            "Report extraction failed for variables: "
            + ", ".join(v.name for v in batch)
        )
        return {}

    flat = _flatten_json(parsed)
    return {v.name: _format_report_value(flat.get(v.name, ""), v.type) for v in batch}


async def extract_report_variables_from_transcript(
    transcript_messages: list[dict],
    report_variables: List[ReportVariable],
    llm_config: Optional[dict] = None,
    run_metadata: Optional[dict] = None,
    usage_accumulator: Optional[dict] = None,
) -> dict[str, Any]:
    """Use an LLM to extract report variable values from a conversation transcript.

    Batches run concurrently (bounded by EXTRACT_CONCURRENCY). A batch whose JSON
    cannot be parsed is retried once, split in halves; variables from a batch that
    still fails are simply absent from the returned dict so callers can detect them.

    Returns a dict mapping variable names to their extracted values (strings for text,
    lists for list-type variables). When no LLM config is available, returns an empty dict.
    """
    if not report_variables or not transcript_messages or not llm_config:
        return {}

    transcript_text = _transcript_to_text(transcript_messages)

    def _build_user_prompt(batch: List[ReportVariable]) -> str:
        return (
            "Generate content for each report variable based on the conversation below. "
            "Write professional, concise text suitable for an executive report.\n\n"
            f"Variables to generate:\n{_vars_block(batch)}\n\n"
            f"Transcript:\n{transcript_text}{_metadata_block(run_metadata)}"
        )

    client = AsyncOpenAI(
        api_key=llm_config.get("api_key"),
        base_url=llm_config.get("base_url"),
    )
    model = llm_config.get("model", "gpt-4o-mini")

    batches = [
        report_variables[start : start + REPORT_EXTRACT_BATCH_SIZE]
        for start in range(0, len(report_variables), REPORT_EXTRACT_BATCH_SIZE)
    ]
    semaphore = asyncio.Semaphore(EXTRACT_CONCURRENCY)

    async def _run_batch(batch: List[ReportVariable]) -> dict[str, Any]:
        async with semaphore:
            return await _complete_batch_values(
                client,
                model,
                batch,
                EXTRACTION_SYSTEM_PROMPT,
                _build_user_prompt,
                temperature=0.1,
                usage_accumulator=usage_accumulator,
            )

    merged: dict[str, Any] = {}
    results = await asyncio.gather(
        *(_run_batch(batch) for batch in batches), return_exceptions=True
    )
    for batch, result in zip(batches, results):
        if isinstance(result, asyncio.CancelledError):
            raise result
        if isinstance(result, BaseException):
            if _is_quota_error(result):
                raise result
            logger.error(
                "Report extraction batch failed for variables "
                f"({', '.join(v.name for v in batch)}): {result}"
            )
            continue
        merged.update(result)
    return merged


async def fill_report_variable_gaps(
    empty_variables: List[ReportVariable],
    extracted_values: dict[str, Any],
    transcript_messages: list[dict],
    llm_config: Optional[dict] = None,
    run_metadata: Optional[dict] = None,
    usage_accumulator: Optional[dict] = None,
) -> dict[str, Any]:
    """Second-pass fill for variables that came back empty after first extraction.

    Only the still-empty definitions are requested; already-extracted values are
    supplied as context so the LLM can derive aggregates/rollups (e.g. a category
    score from its sub-scores) instead of inventing them.

    Returns only keys that were requested, so callers can safely merge into
    empty slots without overwriting first-pass results.
    """
    if not empty_variables or not transcript_messages or not llm_config:
        return {}

    transcript_text = _transcript_to_text(transcript_messages)
    known_values = {k: v for k, v in extracted_values.items() if not _is_empty_value(v)}
    requested_names = {v.name for v in empty_variables}

    def _build_user_prompt(batch: List[ReportVariable]) -> str:
        return (
            "Fill the empty report variables based on the conversation below. "
            "Already-extracted values are provided as context — derive aggregate "
            "values from them when a requested variable summarizes others.\n\n"
            "Variables to fill:\n"
            f"{_vars_block(batch)}\n\n"
            f"Already extracted values:\n{json.dumps(known_values, indent=2, default=str)}\n\n"
            f"Transcript:\n{transcript_text}{_metadata_block(run_metadata)}"
        )

    client = AsyncOpenAI(
        api_key=llm_config.get("api_key"),
        base_url=llm_config.get("base_url"),
    )
    model = llm_config.get("model", "gpt-4o-mini")

    merged: dict[str, Any] = {}
    for start in range(0, len(empty_variables), REPORT_EXTRACT_BATCH_SIZE):
        batch = empty_variables[start : start + REPORT_EXTRACT_BATCH_SIZE]
        values = await _complete_batch_values(
            client,
            model,
            batch,
            GAP_FILL_SYSTEM_PROMPT,
            _build_user_prompt,
            temperature=0.1,
            usage_accumulator=usage_accumulator,
        )
        merged.update({k: v for k, v in values.items() if k in requested_names})
    return merged


async def extract_campaign_report_variables(
    campaign_summary_data: dict[str, Any],
    report_variables: List[ReportVariable],
    llm_config: Optional[dict] = None,
) -> dict[str, Any]:
    """Generate campaign-level qualitative variable values from aggregate data.

    Batched with split-half retry and JSON repair (shared machinery). Domain
    specific variable prompts (campaign_summary, key_findings, ...) override
    the generic description when the name matches. Quota errors propagate.
    """
    if not report_variables or not campaign_summary_data or not llm_config:
        return {}

    summary_json = json.dumps(campaign_summary_data, indent=2, default=str)

    def _build_user_prompt(batch: List[ReportVariable]) -> str:
        lines = []
        for var in batch:
            custom = CAMPAIGN_SPECIFIC_VAR_PROMPTS.get(
                var.name, var.description or "Extract key insights based strictly on campaign data."
            )
            lines.append(f"- **{var.name}** ({var.type.value}): {custom}")
        return (
            "Generate content for each campaign report variable based on the aggregate "
            "campaign data below.\n\n"
            f"Variables to generate:\n" + "\n".join(lines) + "\n\n"
            f"Campaign Data:\n{summary_json}"
        )

    client = AsyncOpenAI(
        api_key=llm_config.get("api_key"),
        base_url=llm_config.get("base_url"),
    )
    model = llm_config.get("model", "gpt-4o-mini")

    batches = [
        report_variables[start : start + REPORT_EXTRACT_BATCH_SIZE]
        for start in range(0, len(report_variables), REPORT_EXTRACT_BATCH_SIZE)
    ]
    semaphore = asyncio.Semaphore(EXTRACT_CONCURRENCY)

    async def _run_batch(batch: List[ReportVariable]) -> dict[str, Any]:
        async with semaphore:
            return await _complete_batch_values(
                client,
                model,
                batch,
                CAMPAIGN_EXTRACTION_SYSTEM_PROMPT,
                _build_user_prompt,
                temperature=0.2,
            )

    merged: dict[str, Any] = {}
    results = await asyncio.gather(
        *(_run_batch(batch) for batch in batches), return_exceptions=True
    )
    for batch, result in zip(batches, results):
        if isinstance(result, asyncio.CancelledError):
            raise result
        if isinstance(result, BaseException):
            if _is_quota_error(result):
                raise result
            logger.error(
                "Campaign extraction batch failed for variables "
                f"({', '.join(v.name for v in batch)}): {result}"
            )
            continue
        merged.update(result)
    return merged


async def fill_campaign_variable_gaps(
    empty_variables: List[ReportVariable],
    extracted_values: dict[str, Any],
    campaign_payload: dict[str, Any],
    llm_config: Optional[dict] = None,
) -> dict[str, Any]:
    """Second-pass fill for empty campaign variables, grounded in aggregate data.

    Mirrors fill_report_variable_gaps: only empty keys are requested and
    already-extracted values are supplied so aggregates can be derived.
    """
    if not empty_variables or not campaign_payload or not llm_config:
        return {}

    payload_json = json.dumps(campaign_payload, indent=2, default=str)
    known_values = {k: v for k, v in extracted_values.items() if not _is_empty_value(v)}
    requested_names = {v.name for v in empty_variables}

    def _build_user_prompt(batch: List[ReportVariable]) -> str:
        return (
            "Fill the empty campaign report variables based on the aggregate campaign "
            "data below. Already-extracted values are provided as context — derive "
            "aggregate values from them when a requested variable summarizes others.\n\n"
            "Variables to fill:\n"
            f"{_vars_block(batch)}\n\n"
            f"Already extracted values:\n{json.dumps(known_values, indent=2, default=str)}\n\n"
            f"Campaign Data:\n{payload_json}"
        )

    client = AsyncOpenAI(
        api_key=llm_config.get("api_key"),
        base_url=llm_config.get("base_url"),
    )
    model = llm_config.get("model", "gpt-4o-mini")

    merged: dict[str, Any] = {}
    for start in range(0, len(empty_variables), REPORT_EXTRACT_BATCH_SIZE):
        batch = empty_variables[start : start + REPORT_EXTRACT_BATCH_SIZE]
        values = await _complete_batch_values(
            client,
            model,
            batch,
            CAMPAIGN_GAP_FILL_SYSTEM_PROMPT,
            _build_user_prompt,
            temperature=0.1,
        )
        merged.update({k: v for k, v in values.items() if k in requested_names})
    return merged


__all__ = [
    "REPORT_EXTRACT_BATCH_SIZE",
    "EXTRACT_CONCURRENCY",
    "EXTRACTION_SYSTEM_PROMPT",
    "GAP_FILL_SYSTEM_PROMPT",
    "CAMPAIGN_EXTRACTION_SYSTEM_PROMPT",
    "CAMPAIGN_SPECIFIC_VAR_PROMPTS",
    "extract_report_variables_from_transcript",
    "fill_report_variable_gaps",
    "extract_campaign_report_variables",
    "fill_campaign_variable_gaps",
    "_is_quota_error",
]
