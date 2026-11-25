"""Build the completeness input bundle.

Sources:
1. Transcript: user <-> assistant lines from realtime_feedback_events.
2. Gathered context: extracted_variables VALUES actually captured during
   the run, plus nodes_visited / disposition.
3. Agent config (what the agent was supposed to cover): node name/prompt per
   conversational node, extraction_variables names, edge label/condition
   done-predicates.

NOT used: report variables — neither definitions nor values. The LLM
matches transcript + gathered evidence against the agent goals.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from api.services.completeness.prompts import MAX_TRANSCRIPT_CHARS
from api.services.workflow.qa.conversation import (
    build_conversation_structure,
    format_transcript,
)
from api.services.workflow.qa.metrics import compute_call_metrics

_CLOSING_WORDS = (
    "bye", "goodbye", "good bye", "take care", "have a good",
    "have a great", "thanks for", "thank you for", "talk soon",
)

# Kept importable for callers; no longer populated from agent config.
TRANSCRIPT_PHASES: list[dict[str, str]] = []


def _is_filled(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        s = value.strip().lower()
        return bool(s) and s not in {"null", "undefined", "unknown", "none", "n/a", "na", ""}
    if isinstance(value, (list, dict)):
        return len(value) > 0
    return True


def extract_agent_goals(
    workflow_definition: dict | None = None,
    workflow_configurations: dict | None = None,
    gathered_context: dict | None = None,
) -> list[dict[str, Any]]:
    """Goals from agent config + extra gathered keys (report variables excluded).

    - Conversational nodes (skips qa/webhook/trigger): node agenda from
      name + prompt/greeting.
    - extraction_variables names: items to capture.
    - Edge label/condition: done-predicates marking a transition complete.
    - Any gathered extracted key not declared in config is appended so
      captured data is never silently dropped.
    Report variables are intentionally never added.
    """
    goals: list[dict[str, Any]] = []
    seen: set[str] = set()
    definition = workflow_definition or {}

    for node in definition.get("nodes", []) or []:
        data = node.get("data") or {}
        if not isinstance(data, dict):
            continue
        node_name = str(data.get("name") or node.get("id") or "step")
        node_type = str(node.get("type") or "")
        if node_type in {"qa", "webhook", "trigger", "retrigger"}:
            continue
        prompt = str(data.get("prompt") or data.get("greeting") or "").strip()
        if prompt:
            key = f"node:{node.get('id', node_name)}"
            if key not in seen:
                seen.add(key)
                goals.append(
                    {
                        "key": key,
                        "label": f"{node_name}: {prompt[:80]}",
                        "hint": prompt[:500],
                    }
                )
        for var in data.get("extraction_variables") or []:
            if not isinstance(var, dict):
                continue
            name = str(var.get("name") or "").strip()
            if not name or name in seen:
                continue
            seen.add(name)
            goals.append(
                {
                    "key": name,
                    "label": f"Capture {name.replace('_', ' ')} ({node_name})",
                    "hint": str(var.get("prompt") or data.get("extraction_prompt") or ""),
                }
            )

    for edge in definition.get("edges", []) or []:
        data = edge.get("data") or {}
        if not isinstance(data, dict):
            continue
        condition = str(data.get("condition") or "").strip()
        label = str(data.get("label") or "").strip()
        if not condition and not label:
            continue
        key = f"flow:{label or condition}"[:80]
        if key in seen:
            continue
        seen.add(key)
        goals.append({"key": key, "label": label or condition, "hint": condition, "flow": True})

    gathered = gathered_context or {}
    extracted = gathered.get("extracted_variables", {}) or {}
    for name in list(extracted.keys()):
        if not name or name in seen:
            continue
        seen.add(name)
        goals.append({"key": name, "label": name.replace("_", " ")})

    return goals


def _truncate_transcript(transcript: str) -> str:
    if len(transcript) <= MAX_TRANSCRIPT_CHARS:
        return transcript
    head = MAX_TRANSCRIPT_CHARS // 2
    tail = MAX_TRANSCRIPT_CHARS - head - 60
    return transcript[:head] + "\n... [truncated] ...\n" + transcript[-tail:]


def _has_closing(text: str) -> bool:
    lowered = text.lower()
    return any(w in lowered for w in _CLOSING_WORDS)


def build_completeness_input(
    workflow_run,
    workflow_definition: dict | None = None,
    workflow_configurations: dict | None = None,
) -> dict[str, Any]:
    """Bundle: transcript + gathered context only."""
    logs = getattr(workflow_run, "logs", None) or {}
    rtf_events = logs.get("realtime_feedback_events", []) or []
    conversation = build_conversation_structure(rtf_events)
    transcript = _truncate_transcript(format_transcript(conversation))

    usage_info = getattr(workflow_run, "usage_info", None) or {}
    metrics = compute_call_metrics(
        rtf_events, usage_info.get("call_duration_seconds")
    )
    user_turns = sum(1 for c in conversation if c.get("speaker") == "user")
    assistant_turns = sum(1 for c in conversation if c.get("speaker") == "assistant")
    full_text = " ".join(str(c.get("text", "")) for c in conversation)

    gathered = getattr(workflow_run, "gathered_context", None) or {}
    extracted = gathered.get("extracted_variables", {}) or {}
    combined = dict(extracted)

    goals = extract_agent_goals(workflow_definition, workflow_configurations, gathered)
    required_vars = [g for g in goals if not g.get("flow") and not g["key"].startswith("node:")]
    filled = sum(1 for g in required_vars if _is_filled(combined.get(g["key"])))

    return {
        "agent_goals": goals,
        "runtime": {
            "transcript": transcript,
            "user_turns": user_turns,
            "assistant_turns": assistant_turns,
            "metrics": metrics,
            "is_completed": bool(getattr(workflow_run, "is_completed", False)),
            "has_opening": bool(assistant_turns >= 1),
            "has_two_way": bool(user_turns >= 1 and assistant_turns >= 1),
            "has_closure": _has_closing(full_text),
            "gathered": {
                "extracted_variables": extracted,
                "nodes_visited": gathered.get("nodes_visited", []),
                "mapped_call_disposition": gathered.get("mapped_call_disposition")
                or gathered.get("call_disposition"),
                "call_tags": gathered.get("call_tags", []),
            },
            "required_count": len(combined),
            "filled_count": filled,
        },
    }


def build_deterministic_fallback(
    completeness_input: dict[str, Any],
    *,
    verdict: str = "unknown",
    reason: str = "LLM unavailable; score from transcript + gathered context.",
    model: str | None = None,
) -> dict[str, Any]:
    """Fallback when the LLM cannot judge: transcript + gathered context."""
    runtime = completeness_input.get("runtime", {}) or {}
    agent_goals = completeness_input.get("agent_goals", []) or []
    transcript = str(runtime.get("transcript", "") or "")
    user_turns = runtime.get("user_turns", 0) or 0
    assistant_turns = runtime.get("assistant_turns", 0) or 0
    gathered = runtime.get("gathered", {}) or {}
    combined = dict(gathered.get("extracted_variables", {}) or {})

    goals: list[dict[str, Any]] = []
    var_met = 0
    var_total = 0
    for g in agent_goals:
        if g.get("flow") or str(g["key"]).startswith("node:"):
            continue
        var_total += 1
        filled = _is_filled(combined.get(g["key"]))
        if filled:
            var_met += 1
        goals.append(
            {"key": g["key"], "label": g.get("label", g["key"]), "status": "met" if filled else "missed"}
        )

    opening = bool(runtime.get("has_opening", assistant_turns >= 1))
    two_way = bool(runtime.get("has_two_way", user_turns >= 1 and assistant_turns >= 1))
    closure = bool(runtime.get("has_closure", False))
    for g in agent_goals:
        if not (g.get("flow") or str(g["key"]).startswith("node:")):
            continue
        ok = opening and two_way
        goals.append(
            {"key": g["key"], "label": g.get("label", g["key"]), "status": "met" if ok else "missed"}
        )

    if not transcript.strip() or (user_turns == 0 and assistant_turns == 0):
        return {
            "version": "v1",
            "score": 0,
            "verdict": verdict if verdict != "unknown" else "error",
            "goals": goals,
            "missing": [g["label"] for g in goals],
            "reason": reason,
            "model": model,
            "evaluated_at": datetime.now(timezone.utc).isoformat(),
            "status": "ready",
        }

    info_capture = (var_met / var_total) if var_total else 0.5
    transcript_part = 0
    if opening:
        transcript_part += 20
    if two_way:
        transcript_part += 40
    transcript_part += min(25, user_turns * 6)
    if closure and two_way:
        transcript_part += 15
    transcript_frac = transcript_part / 100
    closure_frac = 1.0 if (closure and bool(runtime.get("is_completed"))) else (0.5 if two_way else 0.0)

    score = round(100 * (0.45 * transcript_frac + 0.35 * info_capture + 0.20 * closure_frac))
    if not bool(runtime.get("is_completed")):
        score = min(score, 85)
    score = max(0, min(100, score))
    missing = [g["label"] for g in goals if g["status"] == "missed"]

    if verdict == "unknown":
        if score >= 85:
            verdict = "properly_completed"
        elif score >= 40:
            verdict = "partially_completed"
        else:
            verdict = "not_completed"

    return {
        "version": "v1",
        "score": score,
        "verdict": verdict,
        "goals": goals,
        "missing": missing if verdict != "properly_completed" else [],
        "reason": reason,
        "model": model,
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
        "status": "ready",
    }
