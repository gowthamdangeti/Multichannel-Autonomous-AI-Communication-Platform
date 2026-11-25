"""Request/response schemas for the WhatsApp channel."""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class WhatsAppNumberCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=64, description="Display label")


class WhatsAppNumberResponse(BaseModel):
    id: int
    name: str
    phone_number: Optional[str] = None
    status: str
    openwa_session_name: str
    assigned_agent_id: Optional[int] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class AttachAgentRequest(BaseModel):
    # null detaches any currently-assigned agent.
    agent_id: Optional[int] = None


# ── Media settings shared schemas ────────────────────────────────────────────


class WhatsAppMediaSettings(BaseModel):
    """Per-media-type configuration block."""
    enabled: bool = True
    max_files: int = Field(default=20, ge=0, description="Max files per conversation")
    max_file_size_mb: int = Field(default=100, ge=1, le=500, description="Max file size in MB")
    allowed_extensions: list[str] = Field(default_factory=list, description="Allowed file extensions")
    reply_with_voice: bool = Field(default=False, description="Whether to reply with voice notes for audio inputs")


class WhatsAppAgentMediaSettings(BaseModel):
    """Media settings block stored on the agent."""
    image_settings: WhatsAppMediaSettings = Field(default_factory=WhatsAppMediaSettings)
    document_settings: WhatsAppMediaSettings = Field(default_factory=WhatsAppMediaSettings)
    audio_settings: WhatsAppMediaSettings = Field(default_factory=WhatsAppMediaSettings)


# ── WhatsApp agents ──────────────────────────────────────────────────────────


class WhatsAppCharacter(BaseModel):
    """A selectable default character preset."""

    key: str
    name: str
    gender: str
    description: str
    persona: str
    greeting: str


class WhatsAppAgentCreate(WhatsAppAgentMediaSettings):
    name: str = Field(..., min_length=1, max_length=64)
    description: Optional[str] = Field(None, max_length=512)
    character: Optional[str] = Field(None, max_length=64, description="Character key")
    system_prompt: str = Field("", description="Persona / instructions")
    greeting: Optional[str] = Field(None, description="Opening message")
    guardrails: Optional[str] = Field(None, description="Safety rules and boundaries")
    model_config_ref: dict = Field(default_factory=dict)
    # Empty = respond to everyone, except explicitly deactivated contacts.
    active_contacts: list[str] = Field(default_factory=list)
    deactive_contacts: list[str] = Field(default_factory=list)
    tool_ids: list[int] = Field(default_factory=list, description="Tool IDs to associate")
    document_uuids: list[str] = Field(default_factory=list, description="Document UUIDs to associate")


class WhatsAppAgentUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=64)
    description: Optional[str] = Field(None, max_length=512)
    character: Optional[str] = Field(None, max_length=64)
    system_prompt: Optional[str] = None
    greeting: Optional[str] = None
    guardrails: Optional[str] = None
    model_config_ref: Optional[dict] = None
    active_contacts: Optional[list[str]] = None
    deactive_contacts: Optional[list[str]] = None
    is_active: Optional[bool] = None
    tool_ids: Optional[list[int]] = None
    document_uuids: Optional[list[str]] = None
    image_settings: Optional[WhatsAppMediaSettings] = None
    document_settings: Optional[WhatsAppMediaSettings] = None
    audio_settings: Optional[WhatsAppMediaSettings] = None


class WhatsAppAgentResponse(WhatsAppAgentMediaSettings):
    id: int
    name: str
    description: Optional[str] = None
    character: Optional[str] = None
    system_prompt: str
    greeting: Optional[str] = None
    guardrails: Optional[str] = None
    model_config_ref: dict = Field(default_factory=dict)
    active_contacts: list[str] = Field(default_factory=list)
    deactive_contacts: list[str] = Field(default_factory=list)
    is_active: bool
    tool_ids: list[int] = Field(default_factory=list, description="Associated tool IDs")
    document_uuids: list[str] = Field(default_factory=list, description="Associated document UUIDs")
    total_runs: int = Field(default=0, description="Total conversation runs handled by this agent")
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class WhatsAppQRResponse(BaseModel):
    status: str
    # Data-URL (e.g. "data:image/png;base64,...") when a QR is available.
    qr: Optional[str] = None


class WhatsAppMessage(BaseModel):
    role: str
    content: str


class WhatsAppConversationSummary(BaseModel):
    id: int
    number_id: int
    number_name: Optional[str] = None
    agent_id: Optional[int] = None
    agent_name: Optional[str] = None
    contact: str
    message_count: int
    last_message: Optional[str] = None
    last_role: Optional[str] = None
    updated_at: Optional[datetime] = None


class WhatsAppConversationDetail(WhatsAppConversationSummary):
    messages: list[WhatsAppMessage] = Field(default_factory=list)


class WhatsAppNumberListResponse(BaseModel):
    numbers: list[WhatsAppNumberResponse] = Field(default_factory=list)


class WhatsAppAgentListResponse(BaseModel):
    agents: list[WhatsAppAgentResponse] = Field(default_factory=list)


class WhatsAppConversationListResponse(BaseModel):
    conversations: list[WhatsAppConversationSummary] = Field(default_factory=list)

