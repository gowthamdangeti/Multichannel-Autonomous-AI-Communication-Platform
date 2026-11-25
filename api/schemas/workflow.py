from datetime import datetime
from typing import Any, Dict, List, Literal

from pydantic import BaseModel, Field

from api.enums import CallType


class CompletenessGoal(BaseModel):
    key: str
    label: str
    status: Literal["met", "partial", "missed", "na"] = "missed"
    evidence: str | None = None


class CompletenessResult(BaseModel):
    version: str = "v1"
    score: int = Field(default=0, ge=0, le=100)
    verdict: Literal[
        "properly_completed",
        "partially_completed",
        "not_completed",
        "aborted",
        "voicemail",
        "error",
        "unknown",
    ] = "unknown"
    goals: List[CompletenessGoal] = Field(default_factory=list)
    missing: List[str] = Field(default_factory=list)
    reason: str = ""
    model: str | None = None
    evaluated_at: datetime | None = None
    status: Literal["ready", "pending", "failed"] = "ready"


class WorkflowRunResponseSchema(BaseModel):
    id: int
    workflow_id: int
    name: str
    conversation_title: str | None = None
    mode: str
    created_at: datetime
    is_completed: bool
    transcript_url: str | None
    recording_url: str | None
    user_recording_url: str | None = None
    bot_recording_url: str | None = None
    video_recording_url: str | None = None
    transcript_public_url: str | None = None
    recording_public_url: str | None = None
    user_recording_public_url: str | None = None
    bot_recording_public_url: str | None = None
    video_recording_public_url: str | None = None
    public_access_token: str | None = None
    cost_info: Dict[str, Any] | None
    usage_info: Dict[str, Any] | None = None
    definition_id: int | None  # This is for backward compatibility
    initial_context: dict | None = None
    gathered_context: dict | None = None
    call_type: CallType
    logs: Dict[str, Any] | None = None
    annotations: Dict[str, Any] | None = None
    report_s3_key: str | None = None
    report_generation_status: str | None = None
    report_public_url: str | None = None
    has_report_template: bool = False
    workflow_name: str | None = None
    completeness: CompletenessResult | None = None

