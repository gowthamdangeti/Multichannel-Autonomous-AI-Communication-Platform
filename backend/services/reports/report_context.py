"""Template context builders for PDF report rendering.

Pure variable logic lives in variable_engine; LLM extraction lives in
extraction. This module only builds Jinja2 contexts (run and campaign)
and re-exports engine/extraction symbols for backward-compatible imports.
"""

from __future__ import annotations

import json
from typing import Any, List, Optional

from api.services.reports.variable_engine import (
    ReportVariable,
    ReportVariableType,
    discover_template_variables,
    resolve_definitions,
    missing_cached_vars,
    _is_empty_value,
    _format_report_value,
    _flatten_json,
    _unflatten_json,
)
from api.services.reports.extraction import (
    REPORT_EXTRACT_BATCH_SIZE,
    EXTRACT_CONCURRENCY,
    EXTRACTION_SYSTEM_PROMPT,
    GAP_FILL_SYSTEM_PROMPT,
    _is_quota_error,
    _vars_block,
    _metadata_block,
    _transcript_to_text,
    _complete_json,
    _complete_batch_values,
    extract_report_variables_from_transcript,
    fill_report_variable_gaps,
    extract_campaign_report_variables,
    fill_campaign_variable_gaps,
)


def _parse_transcript(gathered: dict) -> list[dict]:
    raw = gathered.get("transcript") or gathered.get("messages") or []
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            raw = []
    if isinstance(raw, dict):
        raw = raw.get("messages", raw.get("transcript", []))
    messages = []
    for msg in raw:
        if isinstance(msg, dict):
            role = msg.get("role", msg.get("speaker", "agent"))
            message = msg.get("message", msg.get("content", msg.get("text", str(msg))))
            messages.append({"role": role, "message": message})
    return messages or [{"role": "agent", "message": "No transcript available."}]


def _flatten_qa_results(qa: dict) -> dict:
    if not qa:
        return {}
    node_results = qa.get("node_results", {})
    flat = {}
    for node_key, node_val in node_results.items():
        if isinstance(node_val, dict):
            flat.update(node_val.get("results", node_val))
    node_data = qa.get("node_data", {})
    if isinstance(node_data, dict):
        flat.update(node_data)
    return flat


def _compute_analytics(messages: list[dict], usage: dict | None = None) -> dict:
    agent_msgs = sum(1 for m in messages if m.get("role") == "agent")
    candidate_msgs = sum(1 for m in messages if m.get("role") in ("user", "candidate"))
    total = agent_msgs + candidate_msgs or 1
    return {
        "duration": f"{usage.get('call_duration_seconds', 0)}s" if usage else f"{total * 15}s",
        "total_messages": total,
        "agent_talk_percent": round(agent_msgs / total * 100),
        "candidate_talk_percent": round(candidate_msgs / total * 100),
    }


def _logs_to_messages(logs: dict) -> list[dict]:
    events = logs.get("realtime_feedback_events", [])
    if not events:
        return []
    messages = []
    for event in events:
        event_type = event.get("type")
        payload = event.get("payload", {})
        if event_type == "rtf-user-transcription" and payload.get("final"):
            text = payload.get("text", "").strip()
            if text:
                messages.append({"role": "user", "message": text})
        elif event_type == "rtf-bot-text":
            text = payload.get("text", "").strip()
            if text:
                messages.append({"role": "agent", "message": text})
    return messages


def build_report_context(run, report_variables_defs: Optional[List[ReportVariable]] = None) -> dict:
    gathered = run.gathered_context or {}
    initial = run.initial_context or {}
    usage = run.usage_info or {}
    annotations = run.annotations or {}
    logs = run.logs or {}

    extracted = gathered.get("extracted_variables", {})
    report_variables = gathered.get("report_variables", {})

    combined_vars = {**extracted, **report_variables}

    transcript_messages = _parse_transcript(gathered)
    has_real_transcript = not (
        len(transcript_messages) == 1
        and transcript_messages[0].get("message") == "No transcript available."
    )
    if not has_real_transcript:
        logs_transcript = _logs_to_messages(logs)
        if logs_transcript:
            transcript_messages = logs_transcript

    ai_results = annotations.get("qa", {})
    flat_ai = _flatten_qa_results(ai_results)

    candidate = {
        "name": extracted.get("candidate_name") or extracted.get("name") or "",
        "phone": initial.get("phone_number", ""),
        "experience": extracted.get("experience") or "",
        "location": extracted.get("location") or "",
    }

    job = {
        "position": extracted.get("position") or extracted.get("job_position") or "",
        "department": extracted.get("department") or "",
    }

    analytics = _compute_analytics(transcript_messages, usage)

    report_vars_values: dict[str, Any] = {}
    if report_variables_defs:
        for v in report_variables_defs:
            val = combined_vars.get(v.name)
            if val is not None:
                report_vars_values[v.name] = _format_report_value(val, v.type)
            elif v.type == ReportVariableType.list:
                report_vars_values[v.name] = []
            else:
                report_vars_values[v.name] = ""

    report_vars_defs_list: list[dict] = []
    if report_variables_defs:
        report_vars_defs_list = [
            {"name": v.name, "type": v.type.value, "description": v.description}
            for v in report_variables_defs
        ]

    company_name = initial.get("company_name", "Your Company")

    usage_seconds = usage.get("call_duration_seconds", "")
    cost_val = usage.get("cost", "")
    call_disposition = gathered.get("mapped_call_disposition", "")

    flat_report_vars = _unflatten_json(report_vars_values if report_variables_defs else report_variables)

    context = {
        **initial,
        "company": initial.get("company", initial.get("company_name", "")),
        "company_name": company_name,
        "run_id": run.id,
        "campaign_id": run.campaign_id,
        "agent_id": run.workflow_id,
        "created_at": run.created_at.isoformat() if run.created_at else "",
        "phone_number": initial.get("phone_number", ""),
        "call_disposition": call_disposition,
        "call_duration": usage_seconds,
        "cost": cost_val,
        "extracted_variables": combined_vars,
        "report": {
            "run_id": run.id,
            "campaign_id": run.campaign_id,
            "agent_id": run.workflow_id,
            "created_at": run.created_at.isoformat() if run.created_at else "",
            "generated_at": run.created_at.isoformat() if run.created_at else "",
            "phone_number": initial.get("phone_number", ""),
            "call_disposition": call_disposition,
            "call_duration": usage_seconds,
            "cost": cost_val,
            "extracted_variables": combined_vars,
            "report_variables": report_vars_values,
        },
        "ai": {
            "executive_summary": flat_ai.get("executive_summary", "No AI summary available."),
            "score": flat_ai.get("score", "N/A"),
            "communication": flat_ai.get("communication", "N/A"),
            "communication_notes": flat_ai.get("communication_notes", ""),
            "technical": flat_ai.get("technical", "N/A"),
            "technical_notes": flat_ai.get("technical_notes", ""),
            "confidence": flat_ai.get("confidence", "N/A"),
            "confidence_notes": flat_ai.get("confidence_notes", ""),
            "professionalism": flat_ai.get("professionalism", "N/A"),
            "professionalism_notes": flat_ai.get("professionalism_notes", ""),
            "overall_fit": flat_ai.get("overall_fit", "N/A"),
            "fit_notes": flat_ai.get("fit_notes", "") or flat_ai.get("overall_fit_notes", ""),
            "highlights": flat_ai.get("highlights", []) or [],
            "concerns": flat_ai.get("concerns", []) or [],
            "recommendation": flat_ai.get("recommendation", "Pending Review"),
            "recommendation_reason": flat_ai.get("recommendation_reason", ""),
        },
        "candidate": candidate,
        "job": job,
        "analytics": analytics,
        "transcript": transcript_messages,
        "report_variables": report_vars_values,
        "report_variable_definitions": report_vars_defs_list,
        "initial_context": initial,
        "gathered_context": gathered,
    }

    for key, val in flat_report_vars.items():
        if isinstance(val, dict):
            existing = context.get(key)
            if isinstance(existing, dict):
                existing.update(val)
            else:
                context[key] = val
        elif key not in context:
            context[key] = val

    for key, val in combined_vars.items():
        if key not in context and key not in report_vars_values:
            context[key] = val

    return context


def build_campaign_report_context(
    campaign: Any,
    runs: list[Any],
    queued_runs: Optional[list[Any]] = None,
    provider_name: Optional[str] = None,
    report_variables_defs: Optional[List[ReportVariable]] = None,
    llm_generated_variables: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Build production-ready aggregate report context for a campaign.

    Dynamically aggregates telephony metrics, disposition distributions,
    configured report variables, and individual run contexts built via
    `build_report_context` without static or domain-specific hardcoding.
    """
    total_targets = len(queued_runs) if queued_runs else (getattr(campaign, "total_queued_count", None) or len(runs))
    total_calls = len(runs)

    completed_calls = sum(1 for r in runs if getattr(r, "state", None) == "completed")
    failed_calls = sum(1 for r in runs if getattr(r, "state", None) == "failed")

    durations: list[int] = []
    total_cost: float = 0.0
    connected_calls = 0

    for r in runs:
        usage = getattr(r, "usage_info", None) or {}
        dur = usage.get("call_duration_seconds", 0) or 0
        cost = usage.get("cost", 0) or 0
        try:
            total_cost += float(cost)
        except (ValueError, TypeError):
            pass
        if dur > 0 or getattr(r, "state", None) == "completed":
            connected_calls += 1
            if dur > 0:
                durations.append(int(dur))

    not_connected_calls = max(0, total_calls - connected_calls)
    connection_rate = round((connected_calls / total_calls * 100), 1) if total_calls > 0 else 0.0
    completion_rate = round((completed_calls / total_calls * 100), 1) if total_calls > 0 else 0.0

    avg_duration_sec = round(sum(durations) / len(durations)) if durations else 0
    total_duration_sec = sum(durations)
    average_call_duration = f"{avg_duration_sec}s"

    # Dynamic tracking of report variables
    numeric_var_values: dict[str, list[float]] = {}
    yes_no_var_values: dict[str, dict[str, int]] = {}
    categorical_var_values: dict[str, dict[str, int]] = {}

    if report_variables_defs:
        for var_def in report_variables_defs:
            if var_def.type in (ReportVariableType.number, ReportVariableType.score, ReportVariableType.range):
                numeric_var_values[var_def.name] = []
            elif var_def.type == ReportVariableType.yes_no:
                yes_no_var_values[var_def.name] = {"yes": 0, "no": 0}
            else:
                categorical_var_values[var_def.name] = {}

    customer_results: list[dict[str, Any]] = []
    call_dispositions: dict[str, int] = {}
    runs_by_disposition: dict[str, list[dict[str, Any]]] = {}

    for run in runs:
        run_ctx = build_report_context(run, report_variables_defs=report_variables_defs)
        initial = run_ctx.get("initial_context", {}) or {}
        rep_vars = run_ctx.get("report_variables", {}) or {}
        disposition = run_ctx.get("call_disposition") or (run.state.capitalize() if getattr(run, "state", None) else "Completed")

        call_dispositions[disposition] = call_dispositions.get(disposition, 0) + 1

        # Track configured report variables metrics
        if report_variables_defs:
            for var_def in report_variables_defs:
                val = rep_vars.get(var_def.name)
                if val is not None:
                    if var_def.name in numeric_var_values:
                        try:
                            clean_val = float(str(val).replace(",", "").strip())
                            numeric_var_values[var_def.name].append(clean_val)
                        except (ValueError, TypeError):
                            pass
                    elif var_def.name in yes_no_var_values:
                        s = str(val).strip().lower()
                        if s in ("yes", "true", "1"):
                            yes_no_var_values[var_def.name]["yes"] += 1
                        elif s in ("no", "false", "0"):
                            yes_no_var_values[var_def.name]["no"] += 1
                    elif var_def.name in categorical_var_values:
                        s = str(val).strip()
                        if s:
                            cat_counts = categorical_var_values[var_def.name]
                            cat_counts[s] = cat_counts.get(s, 0) + 1

        # Customer record dictionary contains the complete run_ctx
        customer_item: dict[str, Any] = {
            **run_ctx,
            "run_id": getattr(run, "id", None),
            "state": getattr(run, "state", "completed"),
            "call_disposition": disposition,
            "disposition": disposition,
            "duration": run_ctx.get("call_duration"),
            "cost": run_ctx.get("cost"),
        }

        # Normalize common contact fields if present in initial_context
        for name_field in ("customer_name", "full_name", "\ufefffull_name", "name"):
            if initial.get(name_field):
                customer_item["customer_name"] = initial[name_field]
                customer_item["name"] = initial[name_field]
                break

        for phone_field in ("phone_number", "phone"):
            if initial.get(phone_field):
                customer_item["phone_number"] = initial[phone_field]
                break

        customer_results.append(customer_item)

        if disposition not in runs_by_disposition:
            runs_by_disposition[disposition] = []
        runs_by_disposition[disposition].append(customer_item)

    # Compute variable aggregates
    variable_metrics: dict[str, Any] = {}
    if report_variables_defs:
        for var_def in report_variables_defs:
            vname = var_def.name
            if vname in numeric_var_values:
                nums = numeric_var_values[vname]
                variable_metrics[vname] = {
                    "count": len(nums),
                    "sum": round(sum(nums), 2) if nums else 0,
                    "average": round(sum(nums) / len(nums), 2) if nums else 0,
                    "min": min(nums) if nums else 0,
                    "max": max(nums) if nums else 0,
                }
            elif vname in yes_no_var_values:
                yn = yes_no_var_values[vname]
                tot = yn["yes"] + yn["no"]
                variable_metrics[vname] = {
                    "yes_count": yn["yes"],
                    "no_count": yn["no"],
                    "yes_rate": round(yn["yes"] / tot * 100, 1) if tot > 0 else 0.0,
                }
            elif vname in categorical_var_values:
                variable_metrics[vname] = {
                    "distribution": categorical_var_values[vname],
                    "unique_count": len(categorical_var_values[vname]),
                }

    started_dt = getattr(campaign, "started_at", None)
    started_str = started_dt.strftime("%Y-%m-%d %H:%M UTC") if started_dt else "N/A"
    completed_dt = getattr(campaign, "completed_at", None)
    completed_str = completed_dt.strftime("%Y-%m-%d %H:%M UTC") if completed_dt else None

    campaign_name = getattr(campaign, "name", "Campaign")
    campaign_state = getattr(campaign, "state", "active")
    campaign_status = campaign_state.capitalize() if campaign_state else "Active"

    disposition_breakdown = [
        {
            "disposition": disp,
            "count": count,
            "percentage": round(count / total_calls * 100, 1) if total_calls > 0 else 0.0,
        }
        for disp, count in call_dispositions.items()
    ]

    campaign_desc = (
        getattr(campaign, "description", None)
        or (getattr(campaign, "orchestrator_metadata", {}) or {}).get("description")
        or ""
    )
    campaign_type_val = (
        (getattr(campaign, "orchestrator_metadata", {}) or {}).get("campaign_type")
        or getattr(campaign, "source_type", "Outbound").capitalize()
    )

    follow_up_contacts: list[dict[str, Any]] = []
    for c in customer_results:
        c["target_results"] = c
        if c.get("follow_up_required") or c.get("callback_requested"):
            follow_up_contacts.append({
                "customer_name": c.get("customer_name") or c.get("name") or "Contact",
                "phone_number": c.get("phone_number") or c.get("phone") or "N/A",
                "follow_up_reason": c.get("follow_up_reason") or "Follow-up requested",
                "callback_at": c.get("callback_at") or "Pending",
                "next_action": c.get("next_action") or "None",
            })

    context = {
        "campaign_id": getattr(campaign, "id", None),
        "campaign_name": campaign_name,
        "campaign_description": campaign_desc,
        "campaign_status": campaign_status,
        "campaign_type": campaign_type_val,
        "started_at": started_str,
        "completed_at": completed_str,
        "agent_name": campaign_name,
        "provider": provider_name or "Telephony Provider",
        "total_targets": total_targets,
        "total_calls": total_calls,
        "completed_calls": completed_calls,
        "failed_calls": failed_calls,
        "connected_calls": connected_calls,
        "not_connected_calls": not_connected_calls,
        "connection_rate": connection_rate,
        "completion_rate": completion_rate,
        "total_duration_seconds": total_duration_sec,
        "average_call_duration": average_call_duration,
        "total_cost": round(total_cost, 2),
        "retry_calls": sum(1 for r in runs if getattr(r, "retry_count", 0) > 0),
        "objective_completed_count": completed_calls,
        "follow_up_required_count": len(follow_up_contacts),
        "callback_requested_count": sum(1 for c in customer_results if c.get("callback_requested")),
        "call_dispositions": call_dispositions,
        "disposition_breakdown": disposition_breakdown,
        "runs_by_disposition": runs_by_disposition,
        "customer_results": customer_results,
        "target_results": customer_results,
        "follow_up_contacts": follow_up_contacts,
        "runs": customer_results,
        "variable_metrics": variable_metrics,
        "report_variables": variable_metrics,
        "report_variable_definitions": [
            {"name": v.name, "type": v.type.value, "description": v.description}
            for v in (report_variables_defs or [])
        ],
    }

    if llm_generated_variables:
        for k, v in llm_generated_variables.items():
            context[k] = v
            if isinstance(context.get("report_variables"), dict):
                context["report_variables"][k] = v

    return context


__all__ = [
    "ReportVariable",
    "ReportVariableType",
    "discover_template_variables",
    "resolve_definitions",
    "missing_cached_vars",
    "build_report_context",
    "build_campaign_report_context",
    "extract_report_variables_from_transcript",
    "fill_report_variable_gaps",
    "extract_campaign_report_variables",
    "fill_campaign_variable_gaps",
    "REPORT_EXTRACT_BATCH_SIZE",
    "EXTRACT_CONCURRENCY",
    "EXTRACTION_SYSTEM_PROMPT",
    "GAP_FILL_SYSTEM_PROMPT",
    "_is_quota_error",
    "_vars_block",
    "_metadata_block",
    "_transcript_to_text",
    "_complete_json",
    "_complete_batch_values",
    "_parse_transcript",
    "_flatten_qa_results",
    "_compute_analytics",
    "_logs_to_messages",
    "_is_empty_value",
    "_format_report_value",
    "_flatten_json",
    "_unflatten_json",
]
