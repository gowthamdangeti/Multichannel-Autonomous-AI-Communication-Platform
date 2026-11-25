"""Shared report variable engine — pure logic, no I/O.

Single source of truth for everything both run and campaign report
pipelines need that does not touch an LLM or the database:

- variable types (ReportVariable / ReportVariableType)
- template variable discovery + definition resolution
- transcript budget truncation
- deterministic score rollups
- no-blank-value placeholders
- run metadata assembly
- value formatting / JSON flattening helpers

Layering rule: extraction.py (LLM I/O) imports this module; context
builders and pipelines import both. This module imports neither.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, List, Optional

from loguru import logger
from pydantic import BaseModel
from jinja2 import BaseLoader, Environment, nodes
from jinja2.meta import find_undeclared_variables


class ReportVariableType(str, Enum):
    text = "text"
    number = "number"
    yes_no = "yes_no"
    list = "list"
    range = "range"
    score = "score"


class ReportVariable(BaseModel):
    name: str
    type: ReportVariableType
    description: str


# Written into scalar variables that have no content after every fill stage.
NOT_DISCUSSED = "Not discussed"

# Template variables supplied by the campaign context builders themselves —
# never sent to the LLM (they are deterministic metrics / loop locals).
CAMPAIGN_BUILTIN_VARS = frozenset({
    "campaign_id", "campaign_name", "campaign_description", "campaign_status", "campaign_type",
    "agent_name", "provider", "started_at", "completed_at",
    "total_targets", "total_calls", "completed_calls", "failed_calls", "connected_calls",
    "not_connected_calls", "connection_rate", "completion_rate", "total_duration_seconds",
    "total_duration_formatted", "average_call_duration", "total_cost", "retry_calls",
    "objective_completed_count", "follow_up_required_count", "callback_requested_count",
    "call_dispositions", "disposition_breakdown", "runs_by_disposition",
    "customer_results", "target_results", "follow_up_contacts", "runs",
    "top_objections", "top_requested_features", "variable_metrics", "report_variables",
    "report_variable_definitions", "loop", "item", "customer", "run", "target", "contact",
    "disposition", "count",
})

# Rough token budget for transcripts handed to extraction. ~4 chars/token.
MAX_TRANSCRIPT_TOKENS = 12000
CHARS_PER_TOKEN = 4

# Per-message overhead estimate for role prefix/newline in flattened text.
_MESSAGE_OVERHEAD = 12

TRUNCATION_MARKER = "...[transcript truncated]..."

_SCORE_SUFFIX = "_score"

# Bounded fixpoint passes for rollups of rollups (deeper than two levels is noise).
_MAX_ROLLOUT_PASSES = 4


@dataclass
class RunReportVariables:
    """Final variable values plus diagnostics for observability."""

    values: dict[str, Any] = field(default_factory=dict)
    meta: dict[str, Any] = field(default_factory=dict)


# --- template discovery & definition resolution -----------------------------


_JINJA2_BUILTINS = frozenset({
    "range", "dict", "lipsum", "cycler", "joiner", "namespace", "loop",
    "true", "false", "none", "True", "False", "None",
})


def discover_template_variables(template_html: str) -> list[ReportVariable]:
    """Parse Jinja2 template AST to find all undeclared variables.

    Returns a list of ReportVariable with inferred types based on usage
    (list if used as a for-loop iterable, text otherwise).
    """
    env = Environment(loader=BaseLoader())
    try:
        ast = env.parse(template_html)
    except Exception:
        return []
    all_vars = find_undeclared_variables(ast)

    list_vars: set[str] = set()
    for node in ast.find_all(nodes.For):
        iter_node = node.iter
        while isinstance(iter_node, nodes.Filter):
            iter_node = iter_node.node
        if isinstance(iter_node, nodes.Name):
            list_vars.add(iter_node.name)

    discovered = []
    for var_name in sorted(all_vars):
        if var_name.lower() in _JINJA2_BUILTINS:
            continue
        var_type = ReportVariableType.list if var_name in list_vars else ReportVariableType.text
        discovered.append(ReportVariable(name=var_name, type=var_type, description=""))
    return discovered


def resolve_definitions(
    template_html: Optional[str],
    saved_defs: Optional[List[Any]] = None,
    *,
    exclude: Optional[frozenset] = None,
) -> list[ReportVariable]:
    """Merge template-discovered variables with saved definitions.

    Saved definitions win on name collisions (they carry descriptions and
    explicit types). ``exclude`` drops names that belong to the context
    rather than the LLM (e.g. campaign builtin metrics). Returns [] when
    the template declares nothing and nothing is saved.
    """
    discovered = discover_template_variables(template_html) if template_html else []
    excluded = exclude or frozenset()
    defs_by_name: dict[str, ReportVariable] = {
        v.name: v for v in discovered if v.name not in excluded
    }

    for v in saved_defs or []:
        if isinstance(v, ReportVariable):
            if v.name not in excluded:
                defs_by_name[v.name] = v
            continue
        if isinstance(v, dict) and v.get("name") and v["name"] not in excluded:
            try:
                defs_by_name[v["name"]] = ReportVariable(
                    name=v["name"],
                    type=ReportVariableType(v.get("type", "text")),
                    description=v.get("description", ""),
                )
            except Exception as e:
                logger.error(f"Failed to parse report variable definition {v.get('name')!r}: {e}")

    return list(defs_by_name.values())


def missing_cached_vars(
    definitions: List[ReportVariable],
    cached: Optional[dict],
) -> list[ReportVariable]:
    """Definitions whose cached value is absent OR empty.

    Treating cached empties as missing makes regeneration self-heal without
    a force_refresh (an empty string must never count as a filled value).
    """
    cache = cached or {}
    return [v for v in definitions if _is_empty_value(cache.get(v.name))]


# --- value helpers -----------------------------------------------------------


def _is_empty_value(value: Any) -> bool:
    """True when an extracted value carries no information."""
    if value is None:
        return True
    if isinstance(value, list):
        return len(value) == 0
    return str(value).strip() == ""


def _format_report_value(value: Any, var_type: ReportVariableType) -> Any:
    if value is None:
        return [] if var_type == ReportVariableType.list else ""
    if var_type == ReportVariableType.list:
        if isinstance(value, list):
            return value
        if isinstance(value, str):
            try:
                import json

                parsed = json.loads(value)
                if isinstance(parsed, list):
                    return parsed
            except Exception:
                pass
            return [item.strip() for item in value.split(",") if item.strip()]
        return [str(value)]
    s = str(value)
    if var_type == ReportVariableType.yes_no:
        if isinstance(value, bool):
            return "Yes" if value else "No"
        if s.lower() in ("true", "yes", "1"):
            return "Yes"
        if s.lower() in ("false", "no", "0"):
            return "No"
    return s


def _flatten_json(obj: dict, parent_key: str = "") -> dict:
    """Flatten nested JSON dicts into dotted keys, e.g. {'company': {'name': 'Acme'}} → {'company.name': 'Acme'}.
    Lists are preserved as-is (not flattened into strings)."""
    items = {}
    if isinstance(obj, dict):
        for k, v in obj.items():
            new_key = f"{parent_key}.{k}" if parent_key else k
            if isinstance(v, dict):
                items.update(_flatten_json(v, new_key))
            elif isinstance(v, list):
                items[new_key] = v
            else:
                items[new_key] = v
    return items


def _unflatten_json(flat: dict) -> dict:
    """Convert flat dotted keys into nested objects, e.g. {'candidate.name': 'Foo'} → {'candidate': {'name': 'Foo'}}."""
    result = {}
    for key, value in flat.items():
        parts = key.split(".")
        target = result
        for part in parts[:-1]:
            if part not in target:
                target[part] = {}
            target = target[part]
        target[parts[-1]] = value
    return result


# --- transcript budget -------------------------------------------------------


def _message_size(message: dict) -> int:
    return len(str(message.get("message", "") or "")) + _MESSAGE_OVERHEAD


def truncate_to_budget(
    messages: Optional[list[dict]],
    max_tokens: int = MAX_TRANSCRIPT_TOKENS,
) -> tuple[list[dict], bool]:
    """Trim a transcript to a rough character budget without losing both ends.

    Returns (messages, was_truncated). A transcript that fits the budget is
    returned unchanged. Over-budget transcripts keep a head (60% of budget) and
    a tail (40%), with a marker between them so the LLM knows content is missing.
    """
    if not messages:
        return [], False

    budget_chars = max_tokens * CHARS_PER_TOKEN
    total = sum(_message_size(m) for m in messages)
    if total <= budget_chars:
        return list(messages), False

    head_target = int(budget_chars * 0.6)
    tail_target = budget_chars - head_target

    head: list[dict] = []
    head_size = 0
    for message in messages:
        size = _message_size(message)
        if head and head_size + size > head_target:
            break
        head.append(message)
        head_size += size

    tail: list[dict] = []
    tail_size = 0
    for message in reversed(messages[len(head) :]):
        size = _message_size(message)
        if tail and tail_size + size > tail_target:
            break
        tail.insert(0, message)
        tail_size += size

    # A single message larger than the whole budget still keeps one from each end.
    if not head and messages:
        head = [messages[0]]
    if not tail and len(messages) > len(head):
        tail = [messages[-1]]

    if len(head) + len(tail) >= len(messages):
        return list(messages), False

    truncated = [*head, {"role": "system", "message": TRUNCATION_MARKER}, *tail]
    logger.info(
        f"Report extraction transcript trimmed {len(messages)} -> "
        f"{len(head) + len(tail)} messages (budget {max_tokens} tokens)"
    )
    return truncated, True


# --- deterministic score rollups ---------------------------------------------


def _is_score_name(name: str) -> bool:
    return name.lower().endswith(_SCORE_SUFFIX)


def _format_rollup(mean: float) -> str:
    if abs(mean - round(mean)) < 1e-9:
        return str(int(round(mean)))
    return str(round(mean, 2))


def _mean_child_scores(
    parent_name: str,
    values: dict[str, Any],
    definitions: List[ReportVariable],
) -> Optional[float]:
    """Mean of filled child scores of ``parent_name`` (e.g. C1_Score ← C1a1/C1a2).

    Children share the parent prefix, end with the score suffix, and have a
    non-digit character right after the prefix so C1_Score never picks up
    C10_Score. Returns None when no child has a numeric value.
    """
    prefix = parent_name[: -len(_SCORE_SUFFIX)]
    if not prefix:
        # Bare "Score" has no derivable namespace; left to the gap-fill pass.
        return None

    numbers: list[float] = []
    for child in definitions:
        if child.name == parent_name:
            continue
        if not _is_score_name(child.name) or not child.name.startswith(prefix):
            continue
        remainder = child.name[len(prefix) :]
        if not remainder or remainder[0].isdigit():
            continue
        raw = values.get(child.name)
        if _is_empty_value(raw):
            continue
        try:
            numbers.append(float(str(raw).replace(",", "").strip()))
        except (TypeError, ValueError):
            continue

    if not numbers:
        return None
    return sum(numbers) / len(numbers)


def apply_score_rollups(
    values: dict[str, Any],
    definitions: List[ReportVariable],
) -> list[str]:
    """Fill empty ``*_Score`` variables as the mean of their filled child scores.

    Deterministic — never calls an LLM and never overwrites a non-empty value.
    Runs to a bounded fixpoint so nested rollups resolve regardless of order.
    Returns the names derived, in discovery order.
    """
    derived: list[str] = []
    for _ in range(_MAX_ROLLOUT_PASSES):
        progressed = False
        for var in definitions:
            if not _is_score_name(var.name):
                continue
            if not _is_empty_value(values.get(var.name)):
                continue
            mean = _mean_child_scores(var.name, values, definitions)
            if mean is None:
                continue
            values[var.name] = _format_rollup(mean)
            if var.name not in derived:
                derived.append(var.name)
            progressed = True
        if not progressed:
            break
    return derived


def apply_overall_score_fallback(
    values: dict[str, Any],
    definitions: List[ReportVariable],
) -> list[str]:
    """Fill an empty bare ``Score`` with the mean of the competency scores.

    The overall score is normally produced by the LLM (extraction, then
    gap-fill). If both leave it empty while competency scores (parent scores
    such as C1_Score that roll up aspect scores) exist, use their mean so a
    mostly-scored report isn't shown without an overall score. Never
    overwrites a value. Returns the names filled.
    """
    filled: list[str] = []
    competency_names = [
        d.name for d in definitions if _is_parent_score(d.name, definitions)
    ]
    for var in definitions:
        if var.name.lower() != _SCORE_SUFFIX.lstrip("_"):
            continue
        if not _is_empty_value(values.get(var.name)):
            continue
        numbers: list[float] = []
        for name in competency_names:
            raw = values.get(name)
            if _is_empty_value(raw):
                continue
            try:
                numbers.append(float(str(raw).replace(",", "").strip()))
            except (TypeError, ValueError):
                continue
        if numbers:
            values[var.name] = _format_rollup(sum(numbers) / len(numbers))
            filled.append(var.name)
    return filled


# --- generic variable classification & scaled math transforms -----------------

_RUBRIC_STATIC_SUFFIXES = (
    "_anchor",
    "_rubric",
    "_level1",
    "_level2",
    "_level3",
    "_level4",
    "_level5",
    "_guideline",
)

_MATH_SCALE_SUFFIXES = (
    "_5_100round",
    "_100round",
    "_pct",
    "_percentage",
)


def _is_parent_score(name: str, definitions: List[ReportVariable]) -> bool:
    """Check whether name has child scores that share its prefix."""
    if not _is_score_name(name):
        return False
    prefix = name[: -len(_SCORE_SUFFIX)]
    if not prefix:
        return False
    for child in definitions:
        if child.name == name:
            continue
        if child.name.startswith(prefix) and _is_score_name(child.name):
            remainder = child.name[len(prefix) :]
            if remainder and not remainder[0].isdigit():
                return True
    return False


def classify_report_variables(
    definitions: List[ReportVariable],
    run_metadata: Optional[dict[str, Any]] = None,
) -> tuple[list[ReportVariable], list[ReportVariable], dict[str, str]]:
    """Partition report variables into deterministic (locked) vs generative (unlocked).

    Returns (locked_defs, unlocked_defs, category_map).
    - Locked variables are populated deterministically by metadata, static rubric
      rules, math scaling, or score rollups at zero token cost.
    - Unlocked variables require dynamic transcript intelligence and are sent to the LLM.
    """
    meta_keys: set[str] = set()
    if run_metadata:
        for k in run_metadata.keys():
            meta_keys.add(k.lower())
            meta_keys.add(k.lower().replace("_", ""))

    locked: list[ReportVariable] = []
    unlocked: list[ReportVariable] = []
    categories: dict[str, str] = {}

    for var in definitions:
        name_lower = var.name.lower()
        norm_name = name_lower.replace("_", "")

        # 1. Metadata check
        if norm_name in meta_keys or name_lower in meta_keys or norm_name in {
            "calldate", "date", "callduration", "duration", "calldurationseconds",
            "durationseconds", "calldisposition", "disposition", "userturns",
            "assistantturns", "totalmessages", "turncount",
        }:
            locked.append(var)
            categories[var.name] = "metadata"

        # 2. Mathematical scaling / percentages
        elif any(name_lower.endswith(sfx) for sfx in _MATH_SCALE_SUFFIXES):
            locked.append(var)
            categories[var.name] = "math_scale"

        # 3. Parent rollup score
        elif _is_parent_score(var.name, definitions):
            locked.append(var)
            categories[var.name] = "score_rollup"

        # 4. Static rubric anchor / title with literal text (an instructional
        #    description without a quoted label is generated instead)
        elif (
            any(name_lower.endswith(sfx) for sfx in _RUBRIC_STATIC_SUFFIXES)
            or (
                name_lower.endswith(("_title", "_name"))
                and not any(
                    w in (var.description or "").lower()
                    for w in ("extract", "generate", "find", "determine", "from transcript")
                )
            )
        ) and static_rubric_value(var):
            locked.append(var)
            categories[var.name] = "static_rubric"

        # 5. Generative / Unlocked
        else:
            unlocked.append(var)
            categories[var.name] = "unlocked"

    return locked, unlocked, categories


def apply_metadata_values(
    values: dict[str, Any],
    definitions: List[ReportVariable],
    run_metadata: Optional[dict[str, Any]],
) -> list[str]:
    """Resolve metadata variables directly from run_metadata without LLM tokens."""
    if not run_metadata:
        return []

    meta_lookup: dict[str, Any] = {}
    for k, v in run_metadata.items():
        if v not in (None, ""):
            meta_lookup[k.lower()] = v
            meta_lookup[k.lower().replace("_", "")] = v

    applied: list[str] = []
    for var in definitions:
        if not _is_empty_value(values.get(var.name)):
            continue

        name_lower = var.name.lower()
        norm_name = name_lower.replace("_", "")

        val = meta_lookup.get(name_lower) or meta_lookup.get(norm_name)
        if val is None:
            if norm_name in ("date", "calldate"):
                val = meta_lookup.get("call_date") or meta_lookup.get("calldate")
            elif norm_name in ("duration", "durationseconds", "callduration"):
                val = meta_lookup.get("call_duration_seconds") or meta_lookup.get("duration")
            elif norm_name in ("disposition", "calldisposition"):
                val = meta_lookup.get("call_disposition") or meta_lookup.get("disposition")

        if val is not None and not _is_empty_value(val):
            values[var.name] = str(val)
            applied.append(var.name)

    return applied


# Phrases that mark a description as an instruction to the model rather than
# the literal text to show (e.g. 'Short name for aspect 1.1, "Challenge
# diagnosis". Keep the aspect meaning stable ...').
_INSTRUCTION_MARKERS = (
    "extract ",
    "generate ",
    "what is ",
    "from the conversation",
    "from transcript",
    "from the transcript",
    "short name for",
    "brief supporting line",
    "supporting line under",
    "keep the ",
    "do not ",
    "don't ",
    "should ",
    "normally ",
    "this card",
    "focuses on",
    "placeholder",
    "actually discussed",
    "the candidate did not",
)

_QUOTED_LABEL_RE = re.compile(r"[\"“]([^\"”]{2,80})[\"”]")


def _is_instruction(description: str) -> bool:
    lowered = description.lower()
    return any(marker in lowered for marker in _INSTRUCTION_MARKERS)


def static_rubric_value(var: ReportVariable) -> Optional[str]:
    """Literal display text for a static title/name/anchor variable, or None.

    A plain description ("Planning & Decision Making") is the text itself. An
    instructional description is never shown verbatim: a title/name takes the
    quoted label it names ('Short name for aspect 1.1, "Challenge diagnosis"
    ...' -> "Challenge diagnosis"); anything else returns None so the variable
    is extracted from the transcript instead.
    """
    desc = (var.description or "").strip()
    if len(desc) < 5:
        return None
    if not _is_instruction(desc):
        return desc
    if var.name.lower().endswith(("_title", "_name")):
        match = _QUOTED_LABEL_RE.search(desc)
        if match:
            return match.group(1).strip()
    return None


def apply_static_rubrics(
    values: dict[str, Any],
    definitions: List[ReportVariable],
) -> list[str]:
    """Populate static rubric anchors/titles from variable descriptions without LLM tokens.

    Variables whose description is an instruction with no literal label are
    left empty, so the pipeline extracts them from the transcript.
    """
    applied: list[str] = []
    for var in definitions:
        if not _is_empty_value(values.get(var.name)):
            continue

        name_lower = var.name.lower()
        is_anchor = any(name_lower.endswith(sfx) for sfx in _RUBRIC_STATIC_SUFFIXES)
        is_title = name_lower.endswith(("_title", "_name"))
        if not (is_anchor or is_title):
            continue

        text = static_rubric_value(var)
        if text:
            values[var.name] = text
            applied.append(var.name)

    return applied


def apply_scaled_math_transforms(
    values: dict[str, Any],
    definitions: List[ReportVariable],
) -> list[str]:
    """Calculate scaled scores and percentages from base scores deterministically."""
    derived: list[str] = []

    for var in definitions:
        if not _is_empty_value(values.get(var.name)):
            continue

        name_lower = var.name.lower()

        # Scale 1-5 score to 0-100 round (e.g. C1a1_Score_5_100round or C1_Score_5_100round)
        if name_lower.endswith("_5_100round") or name_lower.endswith("_100round"):
            sfx = "_5_100round" if name_lower.endswith("_5_100round") else "_100round"
            base_key = var.name[: -len(sfx)]
            candidates = [base_key, f"{base_key}_Score", f"{base_key}_score"]
            raw_val = None
            for c in candidates:
                cand_val = values.get(c)
                if not _is_empty_value(cand_val):
                    raw_val = cand_val
                    break

            if raw_val is not None:
                try:
                    num = float(str(raw_val).replace(",", "").strip())
                    values[var.name] = str(int(round(num * 20)))
                    derived.append(var.name)
                except (ValueError, TypeError):
                    pass

        # Percentage calculation (e.g. C1_Score_pct or C1_pct)
        elif name_lower.endswith("_pct") or name_lower.endswith("_percentage"):
            sfx = "_pct" if name_lower.endswith("_pct") else "_percentage"
            base_key = var.name[: -len(sfx)]
            candidates = [base_key, f"{base_key}_Score", f"{base_key}_score"]
            raw_val = None
            for c in candidates:
                cand_val = values.get(c)
                if not _is_empty_value(cand_val):
                    raw_val = cand_val
                    break

            if raw_val is not None:
                try:
                    num = float(str(raw_val).replace(",", "").strip())
                    pct = round((num / 5.0) * 100, 1)
                    values[var.name] = str(pct if pct % 1 != 0 else int(pct))
                    derived.append(var.name)
                except (ValueError, TypeError):
                    pass

    return derived


# --- placeholders --------------------------------------------------------------


def apply_placeholders(
    values: dict[str, Any],
    definitions: List[ReportVariable],
) -> list[str]:
    """Ensure every defined variable carries a renderable non-empty value.

    Empty scalars become NOT_DISCUSSED; empty list variables become
    [NOT_DISCUSSED] so template for-loops render one honest bullet instead of
    nothing. Never touches a non-empty value. Returns the names that received
    the placeholder.
    """
    placeholdered: list[str] = []
    for var in definitions:
        current = values.get(var.name)
        if var.type == ReportVariableType.list:
            if not isinstance(current, list):
                if _is_empty_value(current):
                    values[var.name] = [NOT_DISCUSSED]
                    placeholdered.append(var.name)
                else:
                    values[var.name] = [str(current)]
            elif not current:
                values[var.name] = [NOT_DISCUSSED]
                placeholdered.append(var.name)
            continue
        if _is_empty_value(current):
            values[var.name] = NOT_DISCUSSED
            placeholdered.append(var.name)
    return placeholdered


# --- run metadata ---------------------------------------------------------------


def build_run_metadata(
    run: Any,
    transcript_messages: Optional[list[dict]] = None,
) -> dict[str, Any]:
    """Factual run fields offered to extraction prompts for metadata variables.

    Lets variables like Date / duration / disposition / chat counts resolve
    from the run row even when the transcript never mentions them. Chat counts
    are included only when the transcript messages are supplied.
    """
    created_at = getattr(run, "created_at", None)
    usage = getattr(run, "usage_info", None) or {}
    gathered = getattr(run, "gathered_context", None) or {}

    call_date = ""
    if isinstance(created_at, datetime):
        call_date = created_at.date().isoformat()
    elif created_at is not None:
        call_date = str(created_at)[:10]

    metadata: dict[str, Any] = {
        "call_date": call_date,
        "call_duration_seconds": usage.get("call_duration_seconds", ""),
        "call_disposition": gathered.get("mapped_call_disposition", ""),
    }

    if transcript_messages is not None:
        user_turns = sum(
            1
            for m in transcript_messages
            if str(m.get("role", "")).lower() in {"user", "caller", "human"}
        )
        assistant_turns = sum(
            1
            for m in transcript_messages
            if str(m.get("role", "")).lower() in {"agent", "assistant", "bot"}
        )
        metadata["user_turns"] = user_turns
        metadata["assistant_turns"] = assistant_turns
        metadata["total_messages"] = len(transcript_messages)

    return metadata


__all__ = [
    "ReportVariable",
    "ReportVariableType",
    "NOT_DISCUSSED",
    "CAMPAIGN_BUILTIN_VARS",
    "MAX_TRANSCRIPT_TOKENS",
    "CHARS_PER_TOKEN",
    "TRUNCATION_MARKER",
    "RunReportVariables",
    "discover_template_variables",
    "resolve_definitions",
    "missing_cached_vars",
    "_is_empty_value",
    "_format_report_value",
    "_flatten_json",
    "_unflatten_json",
    "truncate_to_budget",
    "apply_score_rollups",
    "classify_report_variables",
    "apply_metadata_values",
    "apply_static_rubrics",
    "apply_scaled_math_transforms",
    "apply_placeholders",
    "build_run_metadata",
]
