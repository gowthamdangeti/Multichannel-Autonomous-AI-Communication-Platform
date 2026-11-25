"""Run the completeness judgement: deterministic fast-path + LLM judge.

Checklist = agent config (node agendas, capture items, edge done-conditions)
plus any extra gathered keys. Evidence = user <-> assistant transcript +
gathered extracted values as cross-check. Report variables are excluded.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from loguru import logger
from pipecat.processors.aggregators.llm_context import LLMContext

from api.services.completeness.builder import (
    build_completeness_input,
    build_deterministic_fallback,
)
from api.services.completeness.prompts import COMPLETENESS_SYSTEM_PROMPT, COMPLETENESS_VERSION
from api.services.gen_ai.inference_usage import run_inference_with_usage
from api.services.gen_ai.json_parser import parse_llm_json
from api.services.workflow.qa.llm_config import resolve_user_llm_config
from api.services.workflow.qa.tracing import (
    add_qa_span_to_trace,
    setup_langfuse_parent_context,
)

_ALLOWED_VERDICTS = {
    "properly_completed",
    "partially_completed",
    "not_completed",
    "aborted",
    "voicemail",
    "error",
}
_ALLOWED_GOAL_STATUS = {"met", "partial", "missed", "na"}


def _looks_like_voicemail(transcript: str, gathered: dict[str, Any] | None = None) -> bool:
    """Voicemail hint from transcript words + gathered tags/disposition."""
    lowered = (transcript or "").lower()
    if any(
        hint in lowered
        for hint in ("voicemail", "leave a message", "after the beep", "mailbox is full", "not available, please")
    ):
        return True
    gathered = gathered or {}
    tags = gathered.get("call_tags", []) or []
    disp = str(gathered.get("mapped_call_disposition") or gathered.get("call_disposition") or "").lower()
    hay = " ".join([str(t).lower() for t in tags] + [disp])
    return "voicemail" in hay or "no-answer" in hay or "noanswer" in hay


def _looks_like_error(logs: dict[str, Any]) -> bool:
    """Error hint from transcript pipeline events only (no gathered context)."""
    for event in logs.get("realtime_feedback_events", []) or []:
        if "pipeline-error" in str(event.get("type", "")).lower():
            return True
        payload = event.get("payload") or {}
        if isinstance(payload, dict) and payload.get("error"):
            return True
    return False


def _clamp_result(parsed: dict[str, Any], completeness_input: dict[str, Any], model: str | None) -> dict[str, Any]:
    runtime = completeness_input.get("runtime", {}) or {}
    agent_goals = completeness_input.get("agent_goals", []) or []
    known = {g["key"]: g for g in agent_goals if isinstance(g, dict) and g.get("key")}

    try:
        score = int(parsed.get("score", 0))
    except (TypeError, ValueError):
        score = 0
    score = max(0, min(100, score))

    verdict = str(parsed.get("verdict", "unknown")).strip().lower()
    if verdict not in _ALLOWED_VERDICTS:
        verdict = "partially_completed" if 40 <= score < 85 else ("properly_completed" if score >= 85 else "not_completed")

    goals: list[dict[str, Any]] = []
    raw_goals = parsed.get("goals", []) or []
    if isinstance(raw_goals, list):
        for g in raw_goals:
            if not isinstance(g, dict):
                continue
            key = str(g.get("key") or g.get("label") or "").strip() or "goal"
            status = str(g.get("status", "missed")).strip().lower()
            if status not in _ALLOWED_GOAL_STATUS:
                status = "missed"
            label = str(g.get("label") or known.get(key, {}).get("label") or key)
            evidence = g.get("evidence")
            goals.append(
                {"key": key, "label": label, "status": status, "evidence": str(evidence)[:500] if evidence else None}
            )
    # Ensure every agent-configured goal appears at least once.
    # Cross-check variable goals against gathered values when the LLM skipped them.
    existing_keys = {g["key"] for g in goals}
    gathered = runtime.get("gathered", {}) or {}
    combined = dict(gathered.get("extracted_variables", {}) or {})
    for g in agent_goals:
        if not isinstance(g, dict) or not g.get("key") or g["key"] in existing_keys:
            continue
        if g.get("flow") or str(g["key"]).startswith("node:"):
            goals.append({"key": g["key"], "label": g.get("label", g["key"]), "status": "na"})
            continue
        val = combined.get(g["key"])
        filled = (
            val is not None
            and str(val).strip().lower() not in {"", "null", "none", "unknown", "n/a", "na"}
        )
        goals.append(
            {"key": g["key"], "label": g.get("label", g["key"]), "status": "met" if filled else "missed"}
        )

    missing = parsed.get("missing", []) or []
    if not isinstance(missing, list):
        missing = []
    missing = [str(m)[:200] for m in missing if str(m).strip()]
    if not missing:
        missing = [g["label"] for g in goals if g["status"] == "missed"]

    reason = str(parsed.get("reason", "") or "")[:280]
    if not reason:
        reason = f"{verdict.replace('_', ' ')}: {score}% complete (transcript + gathered)."

    # Closure guardrail: goals met but no proper close caps at 85 handled by prompt;
    # enforce here as well when runtime says not completed.
    if not runtime.get("is_completed") and verdict == "properly_completed":
        verdict = "partially_completed"
        score = min(score, 85)

    return {
        "version": COMPLETENESS_VERSION,
        "score": score,
        "verdict": verdict,
        "goals": goals,
        "missing": missing,
        "reason": reason,
        "model": model,
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
        "status": "ready",
    }


async def evaluate_completeness(
    workflow_run,
    workflow_definition: dict | None,
    workflow_configurations: dict | None = None,
) -> dict[str, Any]:
    """Evaluate conversation completeness for a run.

    Never raises: returns a ready/failed dict that is safe to persist
    under annotations.completeness.
    """
    logs = getattr(workflow_run, "logs", None) or {}
    rtf_events = logs.get("realtime_feedback_events", []) or []

    completeness_input = build_completeness_input(workflow_run, workflow_definition, workflow_configurations)
    runtime0 = completeness_input.get("runtime", {}) or {}
    transcript = runtime0.get("transcript", "") if isinstance(runtime0, dict) else ""
    gathered0 = runtime0.get("gathered", {}) or {}

    # Deterministic fast paths — transcript + gathered tags, no LLM cost.
    if not rtf_events or not (transcript or "").strip():
        return build_deterministic_fallback(
            completeness_input, verdict="error", reason="No transcript captured for this conversation."
        )
    if _looks_like_error(logs):
        return build_deterministic_fallback(
            completeness_input, verdict="error", reason="Call ended with a pipeline/telephone error."
        )
    if _looks_like_voicemail(transcript, gathered0):
        return build_deterministic_fallback(
            completeness_input, verdict="voicemail", reason="Voicemail detected; conversation did not take place."
        )
    user_turns = completeness_input.get("runtime", {}).get("user_turns", 0) or 0
    if user_turns < 1:
        return build_deterministic_fallback(
            completeness_input, verdict="aborted", reason="No user participation; conversation aborted."
        )

    # LLM judge via the org's configured model (works even without a QA node).
    try:
        provider, model, api_key, service_kwargs = await resolve_user_llm_config(workflow_run)
    except Exception as e:
        logger.warning(f"Completeness LLM config failed for run {getattr(workflow_run, 'id', '?')}: {e}")
        return build_deterministic_fallback(completeness_input)

    if not api_key:
        logger.info("No LLM API key for completeness; using deterministic fallback")
        return build_deterministic_fallback(completeness_input)

    runtime = completeness_input.get("runtime", {}) or {}
    agent_goals = completeness_input.get("agent_goals", []) or []
    gathered = runtime.get("gathered", {}) or {}
    user_payload = (
        "## AGENT_GOALS (node agendas, capture items, edge done-conditions)\n"
        f"{agent_goals}\n"
        "## CAPTURED (gathered context)\n"
        f"{gathered}\n"
        f"Turns: user={runtime.get('user_turns')} assistant={runtime.get('assistant_turns')} "
        f"is_completed={runtime.get('is_completed')}\n"
        "## TRANSCRIPT (user <-> assistant)\n"
        f"{runtime.get('transcript', '')}"
    )

    try:
        from api.services.pipecat.service_factory import create_llm_service_from_provider

        llm = create_llm_service_from_provider(provider, model, api_key, **service_kwargs)
        context = LLMContext()
        context.set_messages([{"role": "user", "content": user_payload}])
        # Keeps the provider's real usage (tokens + cache); run_inference()
        # returned text only, which forced the len//4 estimate below.
        raw_response, real_usage = await run_inference_with_usage(
            llm, context, system_instruction=COMPLETENESS_SYSTEM_PROMPT
        )
    except Exception as e:
        logger.warning(f"Completeness LLM call failed for run {getattr(workflow_run, 'id', '?')}: {e}")
        fallback = build_deterministic_fallback(completeness_input, model=model)
        fallback["status"] = "failed"
        return fallback

    try:
        parent_ctx = setup_langfuse_parent_context(workflow_run)
        add_qa_span_to_trace(
            parent_ctx,
            model,
            [{"role": "user", "content": user_payload}],
            raw_response,
            "completeness-v1",
            COMPLETENESS_SYSTEM_PROMPT,
        )
    except Exception:
        pass

    if real_usage:
        _token_usage = real_usage
    else:
        # Provider without an OpenAI-compatible client (or no usage returned):
        # estimate, and say so, so the breakdown never presents it as real.
        est_prompt = max(1, len(user_payload) // 4)
        est_completion = max(1, len(raw_response or "") // 4)
        _token_usage = {
            "prompt_tokens": est_prompt,
            "completion_tokens": est_completion,
            "total_tokens": est_prompt + est_completion,
            "estimated": True,
        }

    try:
        parsed = parse_llm_json(raw_response or "")
        if not isinstance(parsed, dict) or "score" not in parsed:
            raise ValueError("LLM did not return a score")
        result = _clamp_result(parsed, completeness_input, model)
        result["token_usage"] = _token_usage
        return result
    except Exception as e:
        logger.warning(f"Completeness parse failed, using fallback: {e}")
        fallback = build_deterministic_fallback(completeness_input, model=model)
        fallback["status"] = "failed"
        fallback["reason"] = "LLM response was not valid JSON; score from transcript + gathered context."
        fallback["token_usage"] = _token_usage
        return fallback
