"""Common filter utilities for database queries."""

from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import Float, Integer, Numeric, Text, and_, case, cast, func, select
from sqlalchemy.dialects.postgresql import JSONB

from api.db.models import WorkflowRunModel
from api.services.workflow.token_usage import TTS_CHARS_PER_TOKEN


def get_workflow_run_order_clause(
    sort_by: Optional[str] = None,
    sort_order: str = "desc",
):
    """
    Get the order clause for workflow run queries.

    Args:
        sort_by: Field to sort by ('id', 'callType', 'disposition', 'date',
            'duration', 'tokens', 'status', 'created_at').
        sort_order: 'asc' or 'desc'

    Returns:
        SQLAlchemy order clause
    """
    # Determine sort column
    if sort_by == "id":
        sort_column = WorkflowRunModel.id
    elif sort_by in ("date", "created_at"):
        sort_column = WorkflowRunModel.created_at
    elif sort_by == "callType":
        sort_column = WorkflowRunModel.call_type
    elif sort_by == "disposition":
        sort_column = WorkflowRunModel.gathered_context.cast(JSONB).op("->>")(
            "mapped_call_disposition"
        )
    elif sort_by == "duration":
        sort_column = WorkflowRunModel.usage_info.op("->>")(
            "call_duration_seconds"
        ).cast(Float)
    elif sort_by == "tokens":
        sort_column = _workflow_run_token_sort_expression()
    elif sort_by == "status":
        sort_column = WorkflowRunModel.is_completed
    else:
        # Default to created_at
        sort_column = WorkflowRunModel.created_at

    # Apply sort order
    if sort_order == "asc":
        return sort_column.asc().nullslast()
    else:
        return sort_column.desc().nullslast()


def _workflow_run_token_sort_expression():
    """Per-run Σ LLM total_tokens + Σ ceil(TTS chars / 4), mirroring
    `compute_convozent_tokens` (api/services/workflow/token_usage.py). Token
    counts are derived from `usage_info` at read time, so sorting needs a
    correlated set-returning subquery; run lists are already filtered down to
    one campaign/workflow before this is evaluated."""
    usage = WorkflowRunModel.usage_info.cast(JSONB)

    llm_entries = func.jsonb_each(usage.op("->")("llm")).table_valued(
        "key", "value"
    )
    llm_entry_tokens = case(
        # Entry is a bare number (no per-key breakdown).
        (
            func.jsonb_typeof(llm_entries.c.value) == "number",
            llm_entries.c.value.cast(Numeric),
        ),
        # Entry is an object with a numeric total_tokens.
        (
            func.jsonb_typeof(llm_entries.c.value.op("->")("total_tokens"))
            == "number",
            llm_entries.c.value.op("->>")("total_tokens").cast(Numeric),
        ),
        else_=0,
    )
    llm_sum = (
        select(func.coalesce(func.sum(llm_entry_tokens), 0))
        .select_from(llm_entries)
        .scalar_subquery()
    )

    tts_entries = func.jsonb_each(usage.op("->")("tts")).table_valued(
        "key", "value"
    )
    tts_sum = (
        select(
            func.coalesce(
                func.sum(
                    func.ceil(
                        case(
                            (
                                func.jsonb_typeof(tts_entries.c.value)
                                == "number",
                                tts_entries.c.value.cast(Numeric),
                            ),
                            else_=0,
                        )
                        / TTS_CHARS_PER_TOKEN
                    )
                ),
                0,
            )
        )
        .select_from(tts_entries)
        .scalar_subquery()
    )

    return func.coalesce(llm_sum, 0) + func.coalesce(tts_sum, 0)


# Mapping of attribute names to database fields
ATTRIBUTE_FIELD_MAPPING = {
    "dateRange": "created_at",
    "dispositionCode": "gathered_context.mapped_call_disposition",
    "duration": "usage_info.call_duration_seconds",
    "status": "is_completed",
    "tokenUsage": "cost_info.total_cost_usd",
    "runId": "id",
    "workflowId": "workflow_id",
    "campaignId": "campaign_id",
    "callTags": "gathered_context.call_tags",
    "callerNumber": "initial_context.caller_number",
    "calledNumber": "initial_context.called_number",
}


def apply_workflow_run_filters(
    base_query,
    filters: Optional[List[Dict[str, Any]]] = None,
):
    """
    Apply filters to a workflow run query.

    Supports filtering by:
    - dateRange: Filter by created_at date range
    - dispositionCode: Filter by gathered_context.mapped_call_disposition
    - duration: Filter by usage_info.call_duration_seconds range
    - status: Filter by is_completed status
    - tokenUsage: Filter by cost_info.total_cost_usd range
    - runId: Filter by workflow run ID (exact match)
    - workflowId: Filter by workflow ID (exact match)
    - callTags: Filter by gathered_context.call_tags (array of strings)
    - callerNumber: Filter by initial_context.caller_number (text search)
    - calledNumber: Filter by initial_context.called_number (text search)

    Args:
        base_query: The base SQLAlchemy query to apply filters to
        filters: List of filter dictionaries with structure:
            {"attribute": "filterName", "type": "filterType", "value": {...}}

            Where type is one of:
            - "dateRange": Date range filter with {"from": ..., "to": ...}
            - "multiSelect": Multi-select filter with {"codes": [...]}
            - "numberRange": Number range filter with {"min": ..., "max": ...}
            - "number": Exact number filter with {"value": number}
            - "text": Text search filter with {"value": string}
            - "radio": Radio/status filter with {"status": ...}
            - "tags": Tags filter with {"codes": [...]}

    Returns:
        The query with filters applied
    """

    if not filters:
        return base_query

    filter_conditions = []

    for filter_item in filters:
        attribute = filter_item.get("attribute")
        filter_type = filter_item.get("type")
        value = filter_item.get("value", {})

        # Resolve field from attribute mapping
        field = ATTRIBUTE_FIELD_MAPPING.get(attribute)
        if not field:
            # Skip unknown attributes
            continue

        # Apply the filter based on provided type
        if field and filter_type:
            if filter_type == "number" and field == "id":
                # Filter by exact workflow run ID
                if value.get("value") is not None:
                    filter_conditions.append(WorkflowRunModel.id == value["value"])

            elif filter_type == "number" and field == "workflow_id":
                # Filter by exact workflow ID
                if value.get("value") is not None:
                    filter_conditions.append(
                        WorkflowRunModel.workflow_id == value["value"]
                    )

            elif filter_type == "multiSelect" and field == "workflow_id":
                # Filter by list of workflow IDs
                codes = value.get("codes", [])
                valid_ids = [int(c) for c in codes if str(c).isdigit()]
                if valid_ids:
                    filter_conditions.append(
                        WorkflowRunModel.workflow_id.in_(valid_ids)
                    )

            elif filter_type == "number" and field == "campaign_id":
                if value.get("value") is not None:
                    filter_conditions.append(
                        WorkflowRunModel.campaign_id == value["value"]
                    )

            elif filter_type == "dateRange" and field == "created_at":
                # Same as attribute-based dateRange
                if value.get("from"):
                    filter_conditions.append(
                        WorkflowRunModel.created_at
                        >= datetime.fromisoformat(value["from"])
                    )
                if value.get("to"):
                    filter_conditions.append(
                        WorkflowRunModel.created_at
                        <= datetime.fromisoformat(value["to"])
                    )

            elif (
                filter_type == "multiSelect"
                and field == "gathered_context.mapped_call_disposition"
            ):
                codes = value.get("codes", [])
                if codes:
                    # Use ->> operator for compatibility with all PostgreSQL versions
                    # (subscript [] only works in PostgreSQL 14+)
                    filter_conditions.append(
                        cast(WorkflowRunModel.gathered_context, JSONB)
                        .op("->>")("mapped_call_disposition")
                        .in_(codes)
                    )

            elif filter_type == "radio" and field == "is_completed":
                status = value.get("status")
                if status == "completed":
                    filter_conditions.append(WorkflowRunModel.is_completed == True)
                elif status == "in_progress":
                    filter_conditions.append(WorkflowRunModel.is_completed == False)

            elif (
                filter_type in ("tags", "multiSelect")
                and field == "gathered_context.call_tags"
            ):
                tags = value.get("codes", [])
                if tags:
                    # The gathered_context column is JSON type (not JSONB)
                    # JSON type doesn't support subscripting, so we must cast to JSONB first
                    # Then extract call_tags and check containment with @>
                    gathered_context_jsonb = cast(
                        WorkflowRunModel.gathered_context, JSONB
                    )
                    # Use -> operator with literal text key to get call_tags as JSONB
                    call_tags = gathered_context_jsonb.op("->")("call_tags")
                    filter_conditions.append(call_tags.op("@>")(func.cast(tags, JSONB)))

            elif filter_type == "text" and field == "initial_context.caller_number":
                phone = value.get("value", "").strip()
                if phone:
                    # Cast ->> result to Text so .contains() emits LIKE,
                    # not the JSONB @> operator (the default for untyped exprs).
                    filter_conditions.append(
                        cast(
                            cast(WorkflowRunModel.initial_context, JSONB).op("->>")(
                                "caller_number"
                            ),
                            Text,
                        ).contains(phone)
                    )

            elif filter_type == "text" and field == "initial_context.called_number":
                phone = value.get("value", "").strip()
                if phone:
                    filter_conditions.append(
                        cast(
                            cast(WorkflowRunModel.initial_context, JSONB).op("->>")(
                                "called_number"
                            ),
                            Text,
                        ).contains(phone)
                    )

            elif filter_type == "numberRange":
                min_val = value.get("min")
                max_val = value.get("max")

                if field == "usage_info.call_duration_seconds":
                    # Use ->> operator for compatibility with all PostgreSQL versions
                    # (subscript [] only works in PostgreSQL 14+)
                    duration_text = cast(WorkflowRunModel.usage_info, JSONB).op("->>")(
                        "call_duration_seconds"
                    )
                    if min_val is not None:
                        filter_conditions.append(
                            cast(duration_text, Integer) >= min_val
                        )
                    if max_val is not None:
                        filter_conditions.append(
                            cast(duration_text, Integer) <= max_val
                        )

                elif field == "cost_info.total_cost_usd":
                    # Use ->> operator for compatibility with all PostgreSQL versions
                    cost_text = cast(WorkflowRunModel.cost_info, JSONB).op("->>")(
                        "total_cost_usd"
                    )
                    if min_val is not None:
                        filter_conditions.append(cast(cost_text, Integer) >= min_val)
                    if max_val is not None:
                        filter_conditions.append(cast(cost_text, Integer) <= max_val)

    if filter_conditions:
        base_query = base_query.where(and_(*filter_conditions))

    return base_query
