"""Request/response schemas for embeddable chat agents."""

from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


class ChatCharacter(BaseModel):
    """A selectable default character preset (shared with WhatsApp agents)."""

    key: str
    name: str
    gender: str
    description: str
    persona: str
    greeting: str


class ChatAppearance(BaseModel):
    """Widget styling knobs."""

    theme: Literal["dark", "light"] = "dark"
    title: str = "Chat with us"
    subtitle: str = ""
    placeholder: str = "Type a message…"
    position: str = "bottom-right"
    # Text beside the launcher icon (e.g. "Chat with us"); empty keeps the round icon-only button.
    button_title: str = Field("", max_length=30)
    # Background of the launcher button only, "#RRGGBB"; empty keeps the theme's colour.
    brand_color: str = Field("", pattern=r"^(#[0-9a-fA-F]{6})?$")


class ChatAgentCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)
    description: Optional[str] = Field(None, max_length=512)
    character: Optional[str] = Field(None, max_length=64, description="Character key")
    system_prompt: str = Field("", description="Persona / instructions")
    greeting: Optional[str] = Field(None, description="Opening message")
    model_config_ref: dict = Field(default_factory=dict)
    tool_ids: list[int] = Field(default_factory=list, description="Tool IDs to associate")
    document_uuids: list[str] = Field(default_factory=list, description="Knowledge base document UUIDs")
    # Empty = any origin may embed; otherwise only these domains.
    allowed_domains: list[str] = Field(default_factory=list)
    appearance: ChatAppearance = Field(default_factory=ChatAppearance)


class ChatAgentUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=64)
    description: Optional[str] = Field(None, max_length=512)
    character: Optional[str] = Field(None, max_length=64)
    system_prompt: Optional[str] = None
    greeting: Optional[str] = None
    model_config_ref: Optional[dict] = None
    tool_ids: Optional[list[int]] = None
    document_uuids: Optional[list[str]] = None
    allowed_domains: Optional[list[str]] = None
    appearance: Optional[ChatAppearance] = None
    is_active: Optional[bool] = None


class ChatAgentResponse(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    character: Optional[str] = None
    system_prompt: str
    greeting: Optional[str] = None
    model_config_ref: dict = Field(default_factory=dict)
    tool_ids: list[int] = Field(default_factory=list, description="Associated tool IDs")
    document_uuids: list[str] = Field(default_factory=list, description="Associated document UUIDs")
    public_key: str
    allowed_domains: list[str] = Field(default_factory=list)
    appearance: dict = Field(default_factory=dict)
    is_active: bool
    total_runs: int = 0
    embed_script: str = ""
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class ChatMessage(BaseModel):
    role: str
    content: str
    # Reported by the provider on assistant replies; absent on older ones.
    model: Optional[str] = None
    latency_ms: Optional[int] = None
    prompt_tokens: Optional[int] = None
    completion_tokens: Optional[int] = None
    # The visitor's rating of this reply: "like" | "dislike".
    feedback: Optional[str] = None
    # Replaced by a retry: hidden from the dialogue, its usage still counted.
    superseded: Optional[bool] = None

    model_config = {"protected_namespaces": ()}


class ChatConversationError(BaseModel):
    """Why the latest assistant reply failed."""

    reason: str
    message: str
    model: Optional[str] = None
    at: Optional[datetime] = None

    model_config = {"protected_namespaces": ()}


class ChatConversationSummary(BaseModel):
    id: int
    # Display title: the saved one, else `{agent name}_embed` (never blank).
    title: str = ""
    chat_agent_id: int
    agent_name: Optional[str] = None
    origin: Optional[str] = None
    message_count: int
    last_message: Optional[str] = None
    last_role: Optional[str] = None
    status: Literal["error", "in_progress", "completed", "disconnected"] = (
        "completed"
    )
    # Set while the latest reply failed; cleared by the next successful reply.
    error: Optional[ChatConversationError] = None
    # Summed over replies where the provider reported usage; null when none did.
    prompt_tokens: Optional[int] = None
    completion_tokens: Optional[int] = None
    total_tokens: Optional[int] = None
    # First message to last message.
    duration_seconds: Optional[float] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class ChatConversationDetail(ChatConversationSummary):
    # Runtime configuration recorded at session start.
    initial_context: dict = Field(default_factory=dict)
    # What the session produced, read from the stored transcript.
    gathered_context: dict = Field(default_factory=dict)
    # Latest saved completeness evaluation; empty until one has run.
    qa_results: dict = Field(default_factory=dict)
    messages: list[ChatMessage] = Field(default_factory=list)
