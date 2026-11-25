import uuid
from datetime import UTC, datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Table,
    Text,
    UniqueConstraint,
    and_,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import declarative_base, relationship

from api.constants import DEFAULT_CAMPAIGN_RETRY_CONFIG

from ..enums import (
    CallType,
    IntegrationAction,
    ToolCategory,
    ToolStatus,
    TriggerState,
    WebhookCredentialType,
    WorkflowRunState,
    WorkflowStatus,
    WorkflowUtilization,
)

Base = declarative_base()


# TODO: remove workflow_defintion after migration, remove nullable workflow_defintion_id from Workflow and Workflowrun


# Organization-scoped reporting hierarchy. Parent relationships are stored per
# organization because a user may belong to multiple organizations.
class TeamModel(Base):
    __tablename__ = "teams"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(120), nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))

    __table_args__ = (UniqueConstraint("organization_id", "name", name="uq_teams_org_name"),)


class OrganizationMembershipModel(Base):
    __tablename__ = "organization_memberships"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    team_id = Column(Integer, ForeignKey("teams.id", ondelete="SET NULL"), nullable=True, index=True)
    parent_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    role = Column(String(32), nullable=False, server_default="member")

    __table_args__ = (
        UniqueConstraint("organization_id", "user_id", name="uq_org_memberships_org_user"),
        Index("ix_org_memberships_parent_org", "organization_id", "parent_user_id"),
    )


class OrganizationMemberRemovalModel(Base):
    """A member an administrator explicitly removed from an organization.

    ``sync_organization_members`` backfills a membership for every user still
    linked to an organization (the ``organization_users`` association or
    ``users.selected_organization_id``). Without this marker the next member
    list call silently recreates the membership that was just deleted, making
    "Remove from Organization" ineffective.

    The row is consulted only by synchronization and is deleted by the explicit
    Add Member workflow, so a removal survives restarts but never blocks an
    authorized re-add. Removing a member neither deletes the user nor clears
    their ``selected_organization_id``.
    """

    __tablename__ = "organization_member_removals"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(
        Integer,
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    removed_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )

    __table_args__ = (
        UniqueConstraint(
            "organization_id", "user_id", name="uq_org_member_removals_org_user"
        ),
    )


# Association table for many-to-many relationship between users and organizations
organization_users_association = Table(
    "organization_users",
    Base.metadata,
    Column("user_id", Integer, ForeignKey("users.id"), primary_key=True),
    Column(
        "organization_id", Integer, ForeignKey("organizations.id"), primary_key=True
    ),
)


# Association table for many-to-many relationship between WhatsApp agents and tools
whatsapp_agent_tools_association = Table(
    "whatsapp_agent_tools",
    Base.metadata,
    Column("agent_id", Integer, ForeignKey("whatsapp_agents.id", ondelete="CASCADE"), primary_key=True),
    Column("tool_id", Integer, ForeignKey("tools.id", ondelete="CASCADE"), primary_key=True),
)


# Association table for many-to-many relationship between WhatsApp agents and knowledge base documents
whatsapp_agent_documents_association = Table(
    "whatsapp_agent_documents",
    Base.metadata,
    Column("agent_id", Integer, ForeignKey("whatsapp_agents.id", ondelete="CASCADE"), primary_key=True),
    Column("document_id", Integer, ForeignKey("knowledge_base_documents.id", ondelete="CASCADE"), primary_key=True),
)


class UserModel(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    provider_id = Column(String, unique=True, index=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    workflows = relationship("WorkflowModel", back_populates="user")
    selected_organization_id = Column(
        Integer, ForeignKey("organizations.id"), nullable=True
    )
    selected_organization = relationship("OrganizationModel", back_populates="users")
    organizations = relationship(
        "OrganizationModel",
        secondary=organization_users_association,
        back_populates="users",
    )
    is_superuser = Column(Boolean, default=False)
    is_2fa_enabled = Column(Boolean, default=False, server_default="false")
    email = Column(String, nullable=True)
    email_verified = Column(
        Boolean, default=False, server_default="false", nullable=False
    )
    password_hash = Column(String, nullable=True)
    first_name = Column(String, nullable=True)
    last_name = Column(String, nullable=True)
    avatar_key = Column(String, nullable=True)
    country = Column(String, nullable=True)
    phone_number = Column(String, nullable=True)

    __table_args__ = (
        Index(
            "ix_users_email_lower",
            func.lower(email),
            unique=True,
            postgresql_where=text("email IS NOT NULL"),
        ),
    )


class UserConfigurationModel(Base):
    """Per-user keyed JSON store, mirroring organization_configurations.

    Keys are defined in UserConfigurationKey. The legacy v1 AI model
    configuration lives under MODEL_CONFIGURATION; last_validated_at is only
    meaningful for that key.
    """

    __tablename__ = "user_configurations"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    key = Column(String, nullable=False)
    configuration = Column(JSON, nullable=False, default=dict)
    last_validated_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        UniqueConstraint("user_id", "key", name="_user_configuration_key_uc"),
    )


# New Organization model
class OrganizationModel(Base):
    __tablename__ = "organizations"

    id = Column(Integer, primary_key=True, index=True)
    provider_id = Column(String, unique=True, index=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))

    # Deprecated: MPS owns quota and credit ledger state.
    quota_type = Column(
        Enum("monthly", "annual", name="quota_type"),
        nullable=False,
        default="monthly",
        server_default=text("'monthly'::quota_type"),
        comment="Deprecated. MPS owns quota and credit ledger state.",
        info={"deprecated": True},
    )
    quota_convozent_tokens = Column(
        Integer,
        nullable=False,
        default=0,
        server_default=text("0"),
        comment="Deprecated. MPS owns quota and credit ledger state.",
        info={"deprecated": True},
    )
    quota_reset_day = Column(
        Integer,
        nullable=False,
        default=1,
        server_default=text("1"),
        comment="Deprecated. MPS owns quota and credit ledger state.",
        info={"deprecated": True},
    )
    quota_start_date = Column(
        DateTime(timezone=True),
        nullable=True,
        comment="Deprecated. MPS owns quota and credit ledger state.",
        info={"deprecated": True},
    )
    quota_enabled = Column(
        Boolean,
        nullable=False,
        default=False,
        server_default=text("false"),
        comment="Deprecated. MPS owns quota and credit ledger state.",
        info={"deprecated": True},
    )

    price_per_second_usd = Column(Float, nullable=True)

    # Relationships
    users = relationship(
        "UserModel",
        secondary=organization_users_association,
        back_populates="organizations",
    )
    integrations = relationship("IntegrationModel", back_populates="organization")
    usage_cycles = relationship(
        "OrganizationUsageCycleModel", back_populates="organization"
    )
    configurations = relationship(
        "OrganizationConfigurationModel", back_populates="organization"
    )
    api_keys = relationship("APIKeyModel", back_populates="organization")


class APIKeyModel(Base):
    __tablename__ = "api_keys"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    name = Column(String, nullable=False)
    key_hash = Column(String, nullable=False, unique=True, index=True)
    key_prefix = Column(String, nullable=False)  # Store first 8 chars for display
    is_active = Column(Boolean, default=True, nullable=False)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    last_used_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    archived_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    organization = relationship("OrganizationModel", back_populates="api_keys")
    created_by_user = relationship("UserModel")

    # Indexes for performance
    __table_args__ = (
        Index("ix_api_keys_organization_id", "organization_id"),
        Index("ix_api_keys_key_hash", "key_hash"),
        Index("ix_api_keys_active", "is_active"),
    )


class OrganizationConfigurationModel(Base):
    __tablename__ = "organization_configurations"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    key = Column(String, nullable=False)
    value = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    # Relationships
    organization = relationship("OrganizationModel", back_populates="configurations")

    # Constraints and indexes
    __table_args__ = (
        UniqueConstraint("organization_id", "key", name="_organization_key_uc"),
        Index("ix_organization_configurations_organization_id", "organization_id"),
    )


class TelephonyConfigurationModel(Base):
    __tablename__ = "telephony_configurations"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    name = Column(String(64), nullable=False)
    provider = Column(String(32), nullable=False)
    credentials = Column(JSON, nullable=False, default=dict)
    is_default_outbound = Column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    organization = relationship("OrganizationModel")
    phone_numbers = relationship(
        "TelephonyPhoneNumberModel",
        back_populates="configuration",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        UniqueConstraint(
            "organization_id", "name", name="uq_telephony_configurations_org_name"
        ),
        Index("ix_telephony_configurations_org", "organization_id"),
        Index(
            "uq_telephony_configurations_default",
            "organization_id",
            unique=True,
            postgresql_where=text("is_default_outbound = true"),
        ),
    )


class TelephonyPhoneNumberModel(Base):
    __tablename__ = "telephony_phone_numbers"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    telephony_configuration_id = Column(
        Integer,
        ForeignKey("telephony_configurations.id", ondelete="CASCADE"),
        nullable=False,
    )
    address = Column(String(255), nullable=False)
    address_normalized = Column(String(255), nullable=False)
    address_type = Column(String(16), nullable=False)
    country_code = Column(String(2), nullable=True)
    label = Column(String(64), nullable=True)
    inbound_workflow_id = Column(
        Integer,
        ForeignKey("workflows.id", ondelete="SET NULL"),
        nullable=True,
    )
    is_active = Column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )
    is_default_caller_id = Column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    extra_metadata = Column(
        JSON, nullable=False, default=dict, server_default=text("'{}'::json")
    )
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    configuration = relationship(
        "TelephonyConfigurationModel", back_populates="phone_numbers"
    )
    inbound_workflow = relationship("WorkflowModel")

    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "address_normalized",
            name="uq_phone_numbers_org_address",
        ),
        Index("ix_phone_numbers_config", "telephony_configuration_id"),
        Index(
            "ix_phone_numbers_workflow",
            "inbound_workflow_id",
            postgresql_where=text("inbound_workflow_id IS NOT NULL"),
        ),
        Index(
            "ix_phone_numbers_inbound_lookup",
            "address_normalized",
            "organization_id",
            postgresql_where=text("is_active = true"),
        ),
        Index(
            "uq_phone_numbers_default_caller",
            "telephony_configuration_id",
            unique=True,
            postgresql_where=text("is_default_caller_id = true"),
        ),
    )


class WhatsAppNumberModel(Base):
    """A WhatsApp number connected to an org via the OpenWA gateway.

    One row == one OpenWA session. ``status`` mirrors the connection lifecycle
    (created -> qr -> connecting -> connected / disconnected / error). The
    optional inbound-agent binding is added in a later migration.
    """

    __tablename__ = "whatsapp_numbers"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    # Human label shown in the UI (e.g. "Support Line").
    name = Column(String(64), nullable=False)
    # The connected WhatsApp phone number (known once authenticated); nullable
    # until the QR is scanned.
    phone_number = Column(String(32), nullable=True)
    # OpenWA session identifiers. session_name is what we passed to the gateway
    # (alphanumeric + hyphen); session_id is the gateway's returned id.
    openwa_session_name = Column(String(64), nullable=False)
    openwa_session_id = Column(String(128), nullable=True)
    status = Column(
        String(24),
        nullable=False,
        default="created",
        server_default=text("'created'"),
    )
    # The WhatsApp agent that handles conversations on this number (inbound &
    # outbound). Null = no agent attached yet.
    assigned_agent_id = Column(
        Integer,
        ForeignKey("whatsapp_agents.id", ondelete="SET NULL"),
        nullable=True,
    )
    extra_metadata = Column(
        JSON, nullable=False, default=dict, server_default=text("'{}'::json")
    )
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    organization = relationship("OrganizationModel")
    assigned_agent = relationship("WhatsAppAgentModel")

    __table_args__ = (
        UniqueConstraint(
            "organization_id", "name", name="uq_whatsapp_numbers_org_name"
        ),
        UniqueConstraint(
            "openwa_session_name", name="uq_whatsapp_numbers_session_name"
        ),
        Index("ix_whatsapp_numbers_org", "organization_id"),
    )


class WhatsAppAgentModel(Base):
    """A conversational WhatsApp agent.

    A lightweight, text-first agent: a persona/system prompt plus an optional
    greeting. The LLM/keys come from the org's shared AI model configuration
    (``model_config`` may carry a ``platform_model_configuration_id`` to pick an
    admin preset; empty = the org default), so WhatsApp reuses the same model
    settings as the rest of the platform.
    """

    __tablename__ = "whatsapp_agents"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    name = Column(String(64), nullable=False)
    description = Column(String(512), nullable=True)
    # The character/persona preset this agent was built from (e.g.
    # "friendly_recruiter" or "custom"). Display + provenance only; the actual
    # behaviour lives in system_prompt.
    character = Column(String(64), nullable=True)
    # The agent's instructions / persona that steer every reply.
    system_prompt = Column(Text, nullable=False, default="", server_default=text("''"))
    # Optional opening message (used for outbound, and as an inbound auto-greet).
    greeting = Column(Text, nullable=True)
    # Guardrails - safety rules and boundaries the agent must follow.
    guardrails = Column(Text, nullable=True)
    # Reference to the shared model configuration (e.g.
    # {"platform_model_configuration_id": 3}); empty = org default.
    model_config_ref = Column(
        JSON, nullable=False, default=dict, server_default=text("'{}'::json")
    )
    # Active-contact allowlist: empty means every contact is eligible.
    active_contacts = Column(
        JSON, nullable=False, default=list, server_default=text("'[]'::json")
    )
    # Deactivated contacts always take precedence over the active allowlist.
    deactive_contacts = Column(
        JSON, nullable=False, default=list, server_default=text("'[]'::json")
    )
    # ── Media settings ────────────────────────────────────────────────────
    image_settings = Column(JSON, nullable=False, default=dict, server_default=text(
        "'{\"enabled\": true, \"max_files\": 20, \"max_file_size_mb\": 100, "
        "\"allowed_extensions\": [\".jpg\", \".jpeg\", \".png\", \".webp\", "
        "\".gif\", \".svg\", \".heic\"]}'::json"
    ))
    document_settings = Column(JSON, nullable=False, default=dict, server_default=text(
        "'{\"enabled\": true, \"max_files\": 20, \"max_file_size_mb\": 100, "
        "\"allowed_extensions\": [\".pdf\", \".doc\", \".docx\", \".txt\", "
        "\".csv\", \".xlsx\", \".pptx\"]}'::json"
    ))
    audio_settings = Column(JSON, nullable=False, default=dict, server_default=text(
        "'{\"enabled\": true, \"max_files\": 20, \"max_file_size_mb\": 100, "
        "\"allowed_extensions\": [\".mp3\", \".wav\", \".ogg\", \".m4a\", "
        "\".aac\", \".flac\"]}'::json"
    ))
    is_active = Column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    organization = relationship("OrganizationModel")
    tools = relationship(
        "ToolModel",
        secondary=whatsapp_agent_tools_association,
        back_populates="whatsapp_agents",
    )
    documents = relationship(
        "KnowledgeBaseDocumentModel",
        secondary=whatsapp_agent_documents_association,
        back_populates="whatsapp_agents",
    )

    __table_args__ = (
        UniqueConstraint(
            "organization_id", "name", name="uq_whatsapp_agents_org_name"
        ),
        Index("ix_whatsapp_agents_org", "organization_id"),
    )


class WhatsAppConversationModel(Base):
    """One running text conversation between a connected number and a contact.

    ``messages`` is the rolling chat transcript (list of {role, content}); the
    agent's system prompt is applied at call time, not stored here.
    """

    __tablename__ = "whatsapp_conversations"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    number_id = Column(
        Integer,
        ForeignKey("whatsapp_numbers.id", ondelete="CASCADE"),
        nullable=False,
    )
    # The remote party's WhatsApp chat id (e.g. "9198…@c.us").
    contact = Column(String(64), nullable=False)
    messages = Column(
        JSON, nullable=False, default=list, server_default=text("'[]'::json")
    )
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    __table_args__ = (
        UniqueConstraint(
            "number_id", "contact", name="uq_whatsapp_conversations_number_contact"
        ),
        Index("ix_whatsapp_conversations_number", "number_id"),
    )


class ChatAgentModel(Base):
    """An embeddable chat agent.

    Same lightweight, text-first shape as a WhatsApp agent (persona/system prompt
    + optional greeting, LLM/keys from the org's shared model configuration), but
    surfaced as a website chat widget instead of a phone number. ``public_key`` is
    the id embedded in the widget snippet; ``allowed_domains`` gates which origins
    may talk to it; ``appearance`` holds widget styling.
    """

    __tablename__ = "chat_agents"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    name = Column(String(64), nullable=False)
    description = Column(String(512), nullable=True)
    character = Column(String(64), nullable=True)
    system_prompt = Column(Text, nullable=False, default="", server_default=text("''"))
    greeting = Column(Text, nullable=True)
    model_config_ref = Column(
        JSON, nullable=False, default=dict, server_default=text("'{}'::json")
    )
    # Public embed key used in the widget script tag (never a secret DB id).
    public_key = Column(String(64), nullable=False, unique=True, index=True)
    # Whitelisted domains allowed to embed this agent; empty/null = any origin.
    allowed_domains = Column(JSON, nullable=True)
    # Widget styling: {theme, title, subtitle, placeholder, position}.
    appearance = Column(
        JSON, nullable=False, default=dict, server_default=text("'{}'::json")
    )
    is_active = Column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    organization = relationship("OrganizationModel")

    __table_args__ = (
        UniqueConstraint("organization_id", "name", name="uq_chat_agents_org_name"),
        Index("ix_chat_agents_org", "organization_id"),
    )


class ChatConversationModel(Base):
    """One running website-chat conversation (a visitor session).

    ``messages`` is the rolling transcript (list of {role, content}); the agent's
    system prompt is applied at call time, not stored here. ``session_token`` is
    the opaque id the widget holds to continue the conversation.
    """

    __tablename__ = "chat_conversations"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    chat_agent_id = Column(
        Integer,
        ForeignKey("chat_agents.id", ondelete="CASCADE"),
        nullable=False,
    )
    session_token = Column(String(128), nullable=False, unique=True, index=True)
    messages = Column(
        JSON, nullable=False, default=list, server_default=text("'[]'::json")
    )
    origin = Column(String(255), nullable=True)
    # Why the latest assistant reply failed: {reason, message, model, at}. Cleared
    # by the next successful reply; None while the conversation is healthy.
    last_error = Column(JSON, nullable=True)
    # Runtime configuration captured when the session started (model, providers,
    # language) and the latest saved completeness evaluation.
    initial_context = Column(JSON, nullable=True)
    qa_results = Column(JSON, nullable=True)
    # How the visitor's session ended, reported by the widget: "completed" (the
    # visitor pressed Exit / started a new chat) or "disconnected" (the tab was
    # closed or refreshed mid-chat). None while the session has not reported an end.
    end_reason = Column(String(16), nullable=True)
    ended_at = Column(DateTime(timezone=True), nullable=True)
    # Short display title (voice parity); generated once the session ends.
    # None until then; readers fall back via resolve_chat_display_title.
    conversation_title = Column(String(120), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    __table_args__ = (Index("ix_chat_conversations_agent", "chat_agent_id"),)


class IntegrationModel(Base):
    __tablename__ = "integrations"

    id = Column(Integer, primary_key=True, index=True)
    integration_id = Column(
        String, nullable=False, index=True
    )  # External connection ID
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    provider = Column(String, nullable=False)
    created_by = Column(Integer, ForeignKey("users.id"))
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    connection_details = Column(JSON, nullable=False, default=dict)
    action = Column(String, nullable=False, default=IntegrationAction.ALL_CALLS.value)

    # Relationships
    organization = relationship("OrganizationModel", back_populates="integrations")


class WorkflowDefinitionModel(Base):
    __tablename__ = "workflow_definitions"
    id = Column(Integer, primary_key=True, index=True)
    workflow_hash = Column(String, nullable=True)  # Legacy, no longer used
    workflow_json = Column(JSON, nullable=False, default=dict)
    workflow_id = Column(Integer, ForeignKey("workflows.id"), nullable=True)
    is_current = Column(
        Boolean, default=False, nullable=False, server_default=text("false")
    )
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))

    # Versioning columns
    status = Column(
        String,
        nullable=False,
        default="published",
        server_default=text("'published'"),
    )  # draft | published | archived
    version_number = Column(
        Integer, nullable=True
    )  # Sequential per workflow, display only
    published_at = Column(DateTime(timezone=True), nullable=True)

    # Full behavioral snapshot (moved from WorkflowModel to enable versioning)
    workflow_configurations = Column(
        JSON, nullable=False, default=dict, server_default=text("'{}'::json")
    )
    template_context_variables = Column(
        JSON, nullable=False, default=dict, server_default=text("'{}'::json")
    )

    # Table constraints and indexes — unique hash constraint removed (no more dedup)
    __table_args__ = (
        Index("ix_workflow_definitions_workflow_status", "workflow_id", "status"),
    )

    # Relationships
    workflow = relationship(
        "WorkflowModel",
        back_populates="definitions",
        foreign_keys=[workflow_id],
    )
    workflow_runs = relationship("WorkflowRunModel", back_populates="definition")


class FolderModel(Base):
    """A folder for grouping workflows (agents) within an organization.

    Folders are flat (no nesting) and org-scoped. A workflow belongs to at
    most one folder via ``WorkflowModel.folder_id``; a NULL folder_id means
    the workflow is "Uncategorized".
    """

    __tablename__ = "folders"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(
        Integer, ForeignKey("organizations.id"), nullable=False, index=True
    )
    organization = relationship("OrganizationModel")
    name = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))

    workflows = relationship("WorkflowModel", back_populates="folder")

    # Folder names must be unique within an organization.
    __table_args__ = (
        UniqueConstraint("organization_id", "name", name="uq_folder_org_name"),
    )


class WorkflowModel(Base):
    __tablename__ = "workflows"
    id = Column(Integer, primary_key=True, index=True)
    workflow_uuid = Column(
        String(36),
        unique=True,
        nullable=False,
        index=True,
        default=lambda: str(uuid.uuid4()),
    )
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    user = relationship("UserModel", back_populates="workflows")
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=True)
    organization = relationship("OrganizationModel")
    # Optional folder for grouping in the agents list. NULL = "Uncategorized".
    # ON DELETE SET NULL: deleting a folder un-files its agents, never deletes them.
    folder_id = Column(
        Integer,
        ForeignKey("folders.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    folder = relationship("FolderModel", back_populates="workflows")
    name = Column(String, index=True, nullable=False)
    status = Column(
        Enum(*[status.value for status in WorkflowStatus], name="workflow_status"),
        nullable=False,
        default=WorkflowStatus.ACTIVE.value,
        server_default=text("'active'::workflow_status"),
    )
    # Agent utilisation policy: who in the organization may view/utilise this
    # agent. Stored as a plain string (validated in the application layer) so
    # the Alembic migration and ``Base.metadata.create_all`` agree exactly.
    # Values: ``api.enums.WorkflowUtilization`` — "public" | "private" | "closed".
    utilization_type = Column(
        String(16),
        nullable=False,
        default=WorkflowUtilization.PUBLIC.value,
        server_default=WorkflowUtilization.PUBLIC.value,
        index=True,
    )
    # Explicitly granted members for the PRIVATE policy. The creator always has
    # access; these user ids gain it too. JSON array of ints, empty by default,
    # and only writable by the creator (same guard as utilization_type).
    private_allowed_user_ids = Column(
        JSONB,
        nullable=False,
        default=list,
        server_default=text("'[]'::jsonb"),
    )
    workflow_definition = Column(JSON, nullable=False, default=dict)
    template_context_variables = Column(JSON, nullable=False, default=dict)
    call_disposition_codes = Column(JSON, nullable=False, default=dict)
    workflow_configurations = Column(
        JSON, nullable=False, default=dict, server_default=text("'{}'::json")
    )
    runs = relationship("WorkflowRunModel", back_populates="workflow")
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))

    # Pointer to the currently-live (published) version
    released_definition_id = Column(
        Integer,
        ForeignKey("workflow_definitions.id", use_alter=True),
        nullable=True,
    )
    released_definition = relationship(
        "WorkflowDefinitionModel",
        foreign_keys=[released_definition_id],
        uselist=False,
        viewonly=True,
    )

    # All versions / historical definitions of this workflow
    definitions = relationship(
        "WorkflowDefinitionModel",
        back_populates="workflow",
        foreign_keys="WorkflowDefinitionModel.workflow_id",
    )

    # Relationship to fetch the current (is_current=True) definition
    # Kept for backward compatibility during transition
    current_definition = relationship(
        "WorkflowDefinitionModel",
        primaryjoin=lambda: and_(
            WorkflowDefinitionModel.workflow_id == WorkflowModel.id,
            WorkflowDefinitionModel.is_current.is_(True),
        ),
        uselist=False,
        viewonly=True,
    )

    @property
    def current_definition_id(self):
        """Return ID of the current workflow definition (helper for backwards-compat)."""
        current_def = self.__dict__.get("current_definition")
        if current_def is not None:
            return current_def.id

        # If relationship is not loaded, we cannot safely access definitions without
        # risking an implicit lazy load on a detached instance. Return ``None`` in
        # that scenario so callers can handle the absence explicitly.
        return None


class WorkflowTemplates(Base):
    __tablename__ = "workflow_templates"
    id = Column(Integer, primary_key=True, index=True)
    template_name = Column(String, nullable=False, index=True)
    template_description = Column(String, nullable=False, index=True)
    template_json = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))


class WorkflowRunModel(Base):
    __tablename__ = "workflow_runs"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    workflow_id = Column(Integer, ForeignKey("workflows.id"), nullable=False)
    workflow = relationship("WorkflowModel", back_populates="runs")
    definition_id = Column(
        Integer, ForeignKey("workflow_definitions.id"), nullable=True
    )
    definition = relationship("WorkflowDefinitionModel", back_populates="workflow_runs")
    # Stored as VARCHAR (not a Postgres ENUM) so new telephony providers can
    # be added purely in application code without a database migration.
    # See WorkflowRunMode in api/enums.py for the canonical value set.
    mode = Column(String(64), nullable=False)
    call_type = Column(
        Enum(*[call_type.value for call_type in CallType], name="workflow_call_type"),
        nullable=False,
        default=CallType.OUTBOUND.value,
        server_default=text("'outbound'::workflow_call_type"),
    )
    state = Column(
        Enum(*[state.value for state in WorkflowRunState], name="workflow_run_state"),
        nullable=False,
        default=WorkflowRunState.INITIALIZED.value,
        server_default=text("'initialized'::workflow_run_state"),
    )
    is_completed = Column(Boolean, default=False)
    recording_url = Column(String, nullable=True)
    transcript_url = Column(String, nullable=True)
    extra = Column(
        JSON, nullable=False, default=dict, server_default=text("'{}'::json")
    )
    # Store storage backend as string enum (s3, minio)
    storage_backend = Column(
        Enum("s3", "minio", name="storage_backend"),
        nullable=False,
        default="s3",
        server_default=text("'s3'::storage_backend"),
    )
    usage_info = Column(JSON, nullable=False, default=dict)
    cost_info = Column(JSON, nullable=False, default=dict)
    initial_context = Column(JSON, nullable=False, default=dict)
    gathered_context = Column(JSON, nullable=False, default=dict)
    logs = Column(JSON, nullable=False, default=dict, server_default=text("'{}'::json"))
    annotations = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    campaign_id = Column(Integer, ForeignKey("campaigns.id"), nullable=True)
    campaign = relationship("CampaignModel")
    queued_run_id = Column(Integer, ForeignKey("queued_runs.id"), nullable=True)
    queued_run = relationship("QueuedRunModel", foreign_keys=[queued_run_id])
    public_access_token = Column(String(36), nullable=True)
    report_s3_key = Column(String, nullable=True)
    conversation_title = Column(String(120), nullable=True)
    report_generation_status = Column(String(16), nullable=True, default=None)
    # Last time report_generation_status changed; the report sweep cron uses
    # this to detect runs frozen at pending/processing (worker died mid-job).
    report_status_updated_at = Column(DateTime(timezone=True), nullable=True)
    text_session = relationship(
        "WorkflowRunTextSessionModel",
        back_populates="workflow_run",
        uselist=False,
        cascade="all, delete-orphan",
    )

    # Indexes
    __table_args__ = (
        Index(
            "idx_workflow_runs_public_access_token",
            "public_access_token",
            unique=True,
            postgresql_where=text("public_access_token IS NOT NULL"),
        ),
        Index(
            "idx_workflow_runs_call_id",
            text("(gathered_context->>'call_id')"),
            postgresql_where=text("gathered_context->>'call_id' IS NOT NULL"),
        ),
        Index("idx_workflow_runs_workflow_id", "workflow_id"),
        Index("idx_workflow_runs_campaign_id", "campaign_id"),
    )


class UsageEventModel(Base):
    """One persisted provider-usage event for a workflow run operation."""

    __tablename__ = "workflow_run_usage_events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    workflow_run_id = Column(
        Integer,
        ForeignKey("workflow_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    case = Column(String(64), nullable=False)
    service_type = Column(String(8), nullable=False)
    status = Column(String(16), nullable=False, server_default="recorded")
    operation_id = Column(String(255), nullable=False)
    attempt = Column(Integer, nullable=False, server_default=text("1"))
    provider = Column(String(128), nullable=True)
    model = Column(String(256), nullable=True)
    node_id = Column(String(128), nullable=True)
    input_tokens = Column(Integer, nullable=False, server_default=text("0"))
    output_tokens = Column(Integer, nullable=False, server_default=text("0"))
    total_tokens = Column(Integer, nullable=False, server_default=text("0"))
    cache_read_tokens = Column(Integer, nullable=False, server_default=text("0"))
    cache_write_tokens = Column(Integer, nullable=False, server_default=text("0"))
    input_units = Column(Numeric(18, 6), nullable=False, server_default=text("0"))
    output_units = Column(Numeric(18, 6), nullable=False, server_default=text("0"))
    estimated_cost_usd = Column(Numeric(18, 8), nullable=True)
    usage_source = Column(String(32), nullable=True)
    provider_cost_usd = Column(Numeric(20, 10), nullable=True)
    usage_detail = Column(JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "workflow_run_id",
            "operation_id",
            "attempt",
            name="uq_usage_event_run_operation_attempt",
        ),
        CheckConstraint(
            "case IN ('conversation', 'conversation_title', 'conversation_completeness', 'agenda_outcomes', 'qa_results', 'report_generation')",
            name="ck_usage_event_case",
        ),
        CheckConstraint(
            "service_type IN ('llm', 'stt', 'tts', 'sts')",
            name="ck_usage_event_service_type",
        ),
        CheckConstraint(
            "status IN ('recorded', 'unavailable', 'failed')",
            name="ck_usage_event_status",
        ),
        Index("ix_usage_event_run_case", "workflow_run_id", "case"),
        Index("ix_usage_event_operation_id", "operation_id"),
    )


class WorkflowRunTextSessionModel(Base):
    __tablename__ = "workflow_run_text_sessions"

    workflow_run_id = Column(
        Integer,
        ForeignKey("workflow_runs.id", ondelete="CASCADE"),
        primary_key=True,
    )
    workflow_run = relationship("WorkflowRunModel", back_populates="text_session")
    revision = Column(
        Integer,
        nullable=False,
        default=0,
        server_default=text("0"),
    )
    session_data = Column(
        JSON,
        nullable=False,
        default=dict,
        server_default=text("'{}'::json"),
    )
    checkpoint = Column(
        JSON,
        nullable=False,
        default=dict,
        server_default=text("'{}'::json"),
    )
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    __table_args__ = (Index("ix_workflow_run_text_sessions_updated_at", "updated_at"),)


class OrganizationUsageCycleModel(Base):
    """
    This model is used to track reporting aggregates for an organization for a given
    usage cycle. Quota fields on this model are deprecated; MPS owns quota and
    credit ledger state.
    """

    __tablename__ = "organization_usage_cycles"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    period_start = Column(DateTime(timezone=True), nullable=False)
    period_end = Column(DateTime(timezone=True), nullable=False)
    quota_convozent_tokens = Column(
        Integer,
        nullable=False,
        comment="Deprecated. MPS owns quota and credit ledger state.",
        info={"deprecated": True},
    )
    used_convozent_tokens = Column(Float, nullable=False, default=0)
    total_duration_seconds = Column(
        Integer, nullable=False, default=0, server_default=text("0")
    )
    # New USD tracking fields
    used_amount_usd = Column(Float, nullable=True, default=0)
    quota_amount_usd = Column(
        Float,
        nullable=True,
        comment="Deprecated. MPS owns quota and credit ledger state.",
        info={"deprecated": True},
    )
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    # Relationships
    organization = relationship("OrganizationModel", back_populates="usage_cycles")

    # Constraints and indexes
    __table_args__ = (
        UniqueConstraint(
            "organization_id", "period_start", "period_end", name="unique_org_period"
        ),
        Index("idx_usage_cycles_org_period", "organization_id", "period_end"),
    )


class CampaignModel(Base):
    __tablename__ = "campaigns"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    workflow_id = Column(Integer, ForeignKey("workflows.id"), nullable=False)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    # Nullable during the legacy → multi-config migration window. Backfilled to the
    # org's default config by the migration; will become NOT NULL in a follow-up.
    telephony_configuration_id = Column(
        Integer, ForeignKey("telephony_configurations.id"), nullable=True
    )

    # Source configuration
    source_type = Column(String, nullable=False, default="csv")
    source_id = Column(String, nullable=False)  # CSV file key

    # State management
    state = Column(
        Enum(
            "created",
            "syncing",
            "running",
            "paused",
            "completed",
            "failed",
            name="campaign_state",
        ),
        nullable=False,
        default="created",
    )

    # Progress tracking
    total_rows = Column(Integer, nullable=True)
    processed_rows = Column(Integer, nullable=False, default=0)
    failed_rows = Column(Integer, nullable=False, default=0)

    # Rate limiting and sync configuration
    rate_limit_per_second = Column(Integer, nullable=False, default=1)
    max_retries = Column(Integer, nullable=False, default=0)
    source_sync_status = Column(String, nullable=False, default="pending")
    source_last_synced_at = Column(DateTime(timezone=True), nullable=True)
    source_sync_error = Column(String, nullable=True)
    # True once the CSV source has been snapshotted into editable call targets.
    # A campaign then always runs exactly that reviewed target set.
    call_targets_initialized = Column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )

    # Retry configuration for call failures
    retry_config = Column(
        JSON,
        nullable=False,
        default=DEFAULT_CAMPAIGN_RETRY_CONFIG,
        server_default=text(
            '\'{"enabled": true, "max_retries": 2, "retry_on_busy": true, "retry_on_no_answer": true, "retry_on_voicemail": true, "retry_delay_seconds": 120}\'::jsonb'
        ),
    )

    # Orchestrator tracking fields
    last_batch_scheduled_at = Column(DateTime(timezone=True), nullable=True)
    last_activity_at = Column(DateTime(timezone=True), nullable=True)
    orchestrator_metadata = Column(
        JSON, nullable=False, default=dict, server_default=text("'{}'::json")
    )

    # Append-only timestamped log entries for state transitions, failures,
    # and circuit-breaker events. Surfaced in the UI so operators can see
    # why a campaign moved to paused/failed without digging through logs.
    logs = Column(
        JSON,
        nullable=False,
        default=list,
        server_default=text("'[]'::json"),
    )

    # Timestamps
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    # Relationships
    organization = relationship("OrganizationModel")
    workflow = relationship("WorkflowModel")
    created_by_user = relationship("UserModel")

    # Indexes
    __table_args__ = (
        Index("ix_campaigns_org_id", "organization_id"),
        Index("ix_campaigns_state", "state"),
        Index("ix_campaigns_workflow_id", "workflow_id"),
        Index(
            "ix_campaigns_telephony_config",
            "telephony_configuration_id",
            postgresql_where=text("telephony_configuration_id IS NOT NULL"),
        ),
        # Index for efficient querying of active campaigns
        Index(
            "idx_campaigns_active_status",
            "state",
            postgresql_where=text("state IN ('syncing', 'running', 'paused')"),
        ),
    )


class CampaignCallTargetModel(Base):
    __tablename__ = "campaign_call_targets"

    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(
        Integer, ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False
    )
    phone_number = Column(String(64), nullable=False)
    context_variables = Column(
        JSON, nullable=False, default=dict, server_default=text("'{}'::json")
    )
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    campaign = relationship("CampaignModel")

    __table_args__ = (
        UniqueConstraint("campaign_id", "phone_number", name="uq_campaign_target_phone"),
        Index("ix_campaign_call_targets_campaign_id", "campaign_id"),
    )


class QueuedRunModel(Base):
    __tablename__ = "queued_runs"

    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(
        Integer, ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False
    )
    source_uuid = Column(String, nullable=False)
    context_variables = Column(JSON, nullable=False, default=dict)
    state = Column(
        Enum("queued", "processed", "processing", "failed", name="queued_run_state"),
        nullable=False,
        default="queued",
    )
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    processed_at = Column(DateTime(timezone=True), nullable=True)

    # New retry-related fields
    retry_count = Column(Integer, default=0, nullable=False, server_default=text("0"))
    parent_queued_run_id = Column(Integer, ForeignKey("queued_runs.id"), nullable=True)
    scheduled_for = Column(DateTime(timezone=True), nullable=True)
    retry_reason = Column(String, nullable=True)  # 'busy', 'no_answer', 'voicemail'

    # Relationships
    campaign = relationship("CampaignModel")
    parent_queued_run = relationship("QueuedRunModel", remote_side=[id])

    # Indexes
    __table_args__ = (
        Index("idx_queued_runs_campaign_state", "campaign_id", "state"),
        Index("idx_queued_runs_created", "created_at"),
        Index("idx_queued_runs_source_uuid", "source_uuid"),
        Index(
            "idx_queued_runs_scheduled", "scheduled_for"
        ),  # New index for scheduled retries
        # Optimized index for checking queued runs efficiently
        Index(
            "idx_queued_runs_campaign_state_optimized",
            "campaign_id",
            "state",
            postgresql_where=text("state = 'queued'"),
        ),
        # Optimized index for scheduled retries
        Index(
            "idx_queued_runs_scheduled_optimized",
            "campaign_id",
            "scheduled_for",
            postgresql_where=text("scheduled_for IS NOT NULL"),
        ),
        UniqueConstraint(
            "campaign_id",
            "source_uuid",
            "retry_count",
            name="unique_campaign_source_retry",
        ),
    )


class EmbedTokenModel(Base):
    """Model for storing workflow embed tokens"""

    __tablename__ = "embed_tokens"

    id = Column(Integer, primary_key=True, index=True)
    token = Column(String(255), unique=True, nullable=False, index=True)
    workflow_id = Column(
        Integer,
        ForeignKey("workflows.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    organization_id = Column(
        Integer,
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    allowed_domains = Column(JSON, nullable=True)  # Array of whitelisted domains
    settings = Column(JSON, nullable=True)  # Widget customization settings
    is_active = Column(Boolean, default=True, nullable=False, index=True)
    usage_limit = Column(Integer, nullable=True)  # Optional usage limit
    usage_count = Column(Integer, default=0, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    created_by = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    updated_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    workflow = relationship("WorkflowModel")
    organization = relationship("OrganizationModel")
    creator = relationship("UserModel")
    sessions = relationship(
        "EmbedSessionModel", back_populates="embed_token", cascade="all, delete-orphan"
    )


class EmbedSessionModel(Base):
    """Model for storing temporary embed sessions"""

    __tablename__ = "embed_sessions"

    id = Column(Integer, primary_key=True, index=True)
    session_token = Column(String(255), unique=True, nullable=False, index=True)
    embed_token_id = Column(
        Integer, ForeignKey("embed_tokens.id", ondelete="CASCADE"), nullable=False
    )
    workflow_run_id = Column(
        Integer, ForeignKey("workflow_runs.id", ondelete="CASCADE"), nullable=True
    )
    client_ip = Column(String(45), nullable=True)
    user_agent = Column(String(500), nullable=True)
    origin = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    expires_at = Column(DateTime(timezone=True), nullable=False, index=True)

    # Relationships
    embed_token = relationship("EmbedTokenModel", back_populates="sessions")
    workflow_run = relationship("WorkflowRunModel")


class AgentTriggerModel(Base):
    """Model for storing agent trigger mappings (UUID -> workflow_id).

    This is a minimal lookup table that maps trigger UUIDs to workflows.
    The trigger node in the workflow definition is the source of truth.
    """

    __tablename__ = "agent_triggers"

    id = Column(Integer, primary_key=True, index=True)

    # Globally unique trigger path (UUID format)
    trigger_path = Column(String(36), unique=True, nullable=False, index=True)

    # Link to workflow
    workflow_id = Column(
        Integer, ForeignKey("workflows.id", ondelete="CASCADE"), nullable=False
    )
    organization_id = Column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )

    # State management (active/archived)
    state = Column(
        Enum(*[state.value for state in TriggerState], name="trigger_state"),
        nullable=False,
        default=TriggerState.ACTIVE.value,
        server_default=text("'active'::trigger_state"),
    )

    # Audit
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))

    # Relationships
    workflow = relationship("WorkflowModel")
    organization = relationship("OrganizationModel")

    # Indexes for performance
    __table_args__ = (
        Index("ix_agent_triggers_workflow_id", "workflow_id"),
        Index("ix_agent_triggers_state", "state"),
    )


class ScheduledWorkflowCallModel(Base):
    """Durable one-time outbound call created by a Scheduled Retrigger node."""

    __tablename__ = "scheduled_workflow_calls"

    id = Column(Integer, primary_key=True)
    organization_id = Column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    target_workflow_id = Column(
        Integer, ForeignKey("workflows.id", ondelete="CASCADE"), nullable=False
    )
    trigger_path = Column(String(36), nullable=False)
    phone_number = Column(String(64), nullable=False)
    initial_context = Column(
        JSON, nullable=False, default=dict, server_default=text("'{}'::json")
    )
    telephony_configuration_id = Column(
        Integer,
        ForeignKey("telephony_configurations.id", ondelete="SET NULL"),
        nullable=True,
    )
    scheduled_at = Column(DateTime(timezone=True), nullable=False)
    next_attempt_at = Column(DateTime(timezone=True), nullable=False)
    status = Column(String(32), nullable=False, default="pending", server_default="pending")
    idempotency_key = Column(String(128), nullable=False)
    attempt_count = Column(Integer, nullable=False, default=0, server_default="0")
    max_attempts = Column(Integer, nullable=False, default=3, server_default="3")
    retry_strategy = Column(
        String(16), nullable=False, default="exponential", server_default="exponential"
    )
    retry_interval_seconds = Column(
        Integer, nullable=False, default=60, server_default="60"
    )
    last_error = Column(Text, nullable=True)
    dispatched_workflow_run_id = Column(
        Integer, ForeignKey("workflow_runs.id", ondelete="SET NULL"), nullable=True
    )
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )
    dispatched_at = Column(DateTime(timezone=True), nullable=True)
    lease_expires_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "idempotency_key",
            name="uq_scheduled_workflow_calls_org_idempotency",
        ),
        Index(
            "ix_scheduled_workflow_calls_due",
            "status",
            "next_attempt_at",
        ),
        Index("ix_scheduled_workflow_calls_workflow", "target_workflow_id"),
    )


class ExternalCredentialModel(Base):
    """Model for storing external authentication credentials.

    Credentials are stored separately from webhook configurations to allow
    reuse across multiple workflows and secure storage of sensitive data.
    """

    __tablename__ = "external_credentials"

    id = Column(Integer, primary_key=True, index=True)

    # Public UUID reference (used in APIs and workflow definitions)
    # This prevents enumeration attacks and hides internal IDs
    credential_uuid = Column(
        String(36),
        unique=True,
        nullable=False,
        index=True,
        default=lambda: str(uuid.uuid4()),
    )

    # Organization scoping
    organization_id = Column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )

    # Credential metadata
    name = Column(String, nullable=False)  # Display name, e.g., "Salesforce API"
    description = Column(String, nullable=True)  # Optional description

    # Credential type - uses enum from api/enums.py
    credential_type = Column(
        Enum(
            *[t.value for t in WebhookCredentialType],
            name="webhook_credential_type",
        ),
        nullable=False,
        default=WebhookCredentialType.NONE.value,
    )

    # Encrypted credential data (JSON)
    # Structure depends on credential_type:
    # - api_key: {"header_name": "X-API-Key", "api_key": "value"}
    # - bearer_token: {"token": "value"}
    # - basic_auth: {"username": "user", "password": "value"}
    # - custom_header: {"header_name": "X-Custom", "header_value": "value"}
    credential_data = Column(JSON, nullable=False, default=dict)

    # Audit fields
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    # Soft delete for safety
    is_active = Column(Boolean, default=True, nullable=False)

    # Relationships
    organization = relationship("OrganizationModel")
    created_by_user = relationship("UserModel")

    # Indexes and constraints
    __table_args__ = (
        Index("ix_webhook_credentials_organization_id", "organization_id"),
        Index("ix_webhook_credentials_uuid", "credential_uuid"),
        UniqueConstraint("organization_id", "name", name="unique_org_credential_name"),
    )


class ToolModel(Base):
    """Model for storing reusable tools that can be invoked during workflows.

    Tools provide a standardized way to integrate external functionality - from
    HTTP API calls to native integrations.
    """

    __tablename__ = "tools"

    id = Column(Integer, primary_key=True, index=True)

    # Public identifier (used in APIs and workflow references)
    tool_uuid = Column(
        String(36),
        unique=True,
        nullable=False,
        index=True,
        default=lambda: str(uuid.uuid4()),
    )

    # Organization scoping
    organization_id = Column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )

    # Tool metadata
    name = Column(String(255), nullable=False)
    description = Column(String, nullable=True)

    # Tool category - uses enum from api/enums.py
    category = Column(
        Enum(
            *[c.value for c in ToolCategory],
            name="tool_category",
        ),
        nullable=False,
        default=ToolCategory.HTTP_API.value,
    )

    # Icon configuration (for UI display)
    icon = Column(String(50), nullable=True)  # Icon identifier
    icon_color = Column(String(7), nullable=True)  # Hex color code

    # Status management
    status = Column(
        Enum(
            *[s.value for s in ToolStatus],
            name="tool_status",
        ),
        nullable=False,
        default=ToolStatus.ACTIVE.value,
        server_default=text("'active'::tool_status"),
    )

    # The tool definition (JSONB) - contains schema_version for compatibility
    # Structure depends on category:
    # - http_api: {"schema_version": 1, "type": "http_api", "config": {...}}
    definition = Column(JSON, nullable=False, default=dict)

    # Audit fields
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    # Relationships
    organization = relationship("OrganizationModel")
    created_by_user = relationship("UserModel")
    whatsapp_agents = relationship(
        "WhatsAppAgentModel",
        secondary=whatsapp_agent_tools_association,
        back_populates="tools",
    )

    # Indexes and constraints
    __table_args__ = (
        Index("ix_tools_organization_id", "organization_id"),
        Index("ix_tools_uuid", "tool_uuid"),
        Index("ix_tools_status", "status"),
        Index("ix_tools_category", "category"),
    )


class KnowledgeBaseDocumentModel(Base):
    """Model for storing document-level metadata in the knowledge base.

    Each document represents a source file (PDF, DOCX, etc.) that has been
    processed and chunked for retrieval.
    """

    __tablename__ = "knowledge_base_documents"

    id = Column(Integer, primary_key=True, index=True)

    # Public identifier for API references
    document_uuid = Column(
        String(36),
        unique=True,
        nullable=False,
        index=True,
        default=lambda: str(uuid.uuid4()),
    )

    # Organization scoping
    organization_id = Column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )

    # Document metadata
    filename = Column(String(500), nullable=False)
    file_size_bytes = Column(Integer, nullable=True)
    file_hash = Column(String(64), nullable=True)  # SHA-256 hash for deduplication
    mime_type = Column(String(100), nullable=True)

    # Retrieval mode: "chunked" (vector search) or "full_document" (return full text)
    retrieval_mode = Column(
        String(20), nullable=False, default="chunked", server_default="chunked"
    )
    full_text = Column(
        Text, nullable=True
    )  # Stored when retrieval_mode is "full_document"

    # Processing metadata
    source_url = Column(String, nullable=True)  # If document was fetched from URL
    total_chunks = Column(Integer, nullable=False, default=0)
    processing_status = Column(
        Enum(
            "pending",
            "processing",
            "completed",
            "failed",
            name="document_processing_status",
        ),
        nullable=False,
        default="pending",
        server_default=text("'pending'::document_processing_status"),
    )
    processing_error = Column(Text, nullable=True)

    # Docling conversion metadata
    docling_metadata = Column(
        JSON, nullable=False, default=dict
    )  # Store docling document metadata

    # Custom metadata (user-defined tags, categories, etc.)
    custom_metadata = Column(JSON, nullable=False, default=dict)

    # Audit fields
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    # Soft delete
    is_active = Column(Boolean, default=True, nullable=False)
    archived_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    organization = relationship("OrganizationModel")
    created_by_user = relationship("UserModel")
    chunks = relationship(
        "KnowledgeBaseChunkModel",
        back_populates="document",
        cascade="all, delete-orphan",
    )
    whatsapp_agents = relationship(
        "WhatsAppAgentModel",
        secondary=whatsapp_agent_documents_association,
        back_populates="documents",
    )

    # Indexes and constraints
    __table_args__ = (
        Index("ix_kb_documents_organization_id", "organization_id"),
        Index("ix_kb_documents_uuid", "document_uuid"),
        Index("ix_kb_documents_status", "processing_status"),
        Index("ix_kb_documents_created_at", "created_at"),
    )


class WorkflowRecordingModel(Base):
    """Model for storing audio recordings scoped to an organization.

    Recordings are used in hybrid prompts where parts of the output are pre-recorded
    audio rather than dynamically generated TTS.
    """

    __tablename__ = "workflow_recordings"

    id = Column(Integer, primary_key=True, index=True)

    # Descriptive ID used in prompts (unique per organization)
    recording_id = Column(String(64), nullable=False, index=True)

    # Scoping
    workflow_id = Column(
        Integer, ForeignKey("workflows.id", ondelete="CASCADE"), nullable=True
    )
    organization_id = Column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )

    # TTS configuration metadata (optional, legacy)
    tts_provider = Column(String, nullable=True)
    tts_model = Column(String, nullable=True)
    tts_voice_id = Column(String, nullable=True)

    # Content
    transcript = Column(Text, nullable=False)

    # Storage
    storage_key = Column(String, nullable=False)
    storage_backend = Column(
        Enum("s3", "minio", name="recording_storage_backend"),
        nullable=False,
        default="s3",
        server_default=text("'s3'::recording_storage_backend"),
    )

    # Extra metadata (file_size_bytes, duration_seconds, original_filename, mime_type, etc.)
    recording_metadata = Column(
        JSON, nullable=False, default=dict, server_default=text("'{}'::json")
    )

    # Audit
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))

    # Soft delete
    is_active = Column(Boolean, default=True, nullable=False)

    # Relationships
    workflow = relationship("WorkflowModel")
    organization = relationship("OrganizationModel")
    created_by_user = relationship("UserModel")

    # Indexes
    __table_args__ = (
        UniqueConstraint(
            "recording_id",
            "organization_id",
            name="uq_workflow_recordings_recording_id_org",
        ),
        Index("ix_workflow_recordings_workflow_id", "workflow_id"),
        Index("ix_workflow_recordings_org_id", "organization_id"),
        Index("ix_workflow_recordings_recording_id", "recording_id"),
    )


class KnowledgeBaseChunkModel(Base):
    """Model for storing document chunks with vector embeddings.

    Each chunk represents a portion of a document that has been:
    1. Extracted and chunked by docling's HybridChunker
    2. Optionally contextualized with surrounding information
    3. Embedded into a vector representation for semantic search
    """

    __tablename__ = "knowledge_base_chunks"

    id = Column(Integer, primary_key=True, index=True)

    # Link to parent document
    document_id = Column(
        Integer,
        ForeignKey("knowledge_base_documents.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Organization scoping (denormalized for efficient querying)
    organization_id = Column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )

    # Chunk content
    chunk_text = Column(Text, nullable=False)  # The actual chunk text
    contextualized_text = Column(
        Text, nullable=True
    )  # Enriched text from chunker.contextualize()

    # Chunk positioning and metadata
    chunk_index = Column(Integer, nullable=False)  # Position in document (0-based)

    # Docling chunk metadata
    chunk_metadata = Column(
        JSON, nullable=False, default=dict
    )  # Store chunk.meta if available

    # Embedding configuration
    embedding_model = Column(
        String(200), nullable=False
    )  # e.g., "sentence-transformers/all-MiniLM-L6-v2"
    embedding_dimension = Column(
        Integer, nullable=False
    )  # e.g., 384 for all-MiniLM-L6-v2

    # Vector embedding (pgvector column)
    # The dimension should match the embedding_dimension field
    # Default: 1536 dimensions for OpenAI text-embedding-3-small
    # SentenceTransformer (384-dim) also supported but stored as 384-dim vectors
    embedding = Column(Vector(1536), nullable=True)

    # Token count (useful for chunking strategy analysis)
    token_count = Column(Integer, nullable=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    # Relationships
    document = relationship("KnowledgeBaseDocumentModel", back_populates="chunks")
    organization = relationship("OrganizationModel")

    # Indexes and constraints
    __table_args__ = (
        Index("ix_kb_chunks_document_id", "document_id"),
        Index("ix_kb_chunks_organization_id", "organization_id"),
        Index("ix_kb_chunks_chunk_index", "chunk_index"),
        Index(
            "ix_kb_chunks_embedding_model", "embedding_model"
        ),  # For filtering by model
        # Vector similarity search index (using IVFFlat or HNSW)
        # IVFFlat is good for datasets with 10k-1M vectors
        # HNSW is better for larger datasets but uses more memory
        Index(
            "ix_kb_chunks_embedding_ivfflat",
            "embedding",
            postgresql_using="ivfflat",
            postgresql_with={"lists": 100},  # Adjust based on dataset size
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
    )


# ---------------------------------------------------------------------------
# Convozent billing models
# ---------------------------------------------------------------------------



class BillingPlanModel(Base):
    """Admin-defined subscription plans (INR via Razorpay, USD via Stripe)."""
    __tablename__ = "billing_plans"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(64), nullable=False)
    description = Column(Text, nullable=True)
    currency = Column(String(8), nullable=False, default="USD")
    price_per_month = Column(Numeric(12, 2), nullable=False)
    included_minutes = Column(Integer, nullable=False, default=100)
    included_messages = Column(Integer, nullable=False, default=1000)
    price_per_extra_minute = Column(Numeric(10, 4), nullable=False, default="0.05")
    price_per_extra_message = Column(Numeric(10, 4), nullable=False, default="0.001")
    stripe_product_id = Column(String(128), nullable=True)
    stripe_price_id = Column(String(128), nullable=True)
    razorpay_plan_id = Column(String(128), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True, server_default=text("true"))
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC), onupdate=lambda: datetime.now(UTC))

    __table_args__ = (
        UniqueConstraint("name", "currency", name="uq_billing_plans_name_currency"),
        Index("ix_billing_plans_currency", "currency"),
        Index("ix_billing_plans_is_active", "is_active"),
    )


class OrgWalletModel(Base):
    """Prepaid credit wallet per org. Balance deducted per usage, topped up by payments."""
    __tablename__ = "org_wallets"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, unique=True)
    balance = Column(Numeric(14, 4), nullable=False, default="0")
    currency = Column(String(8), nullable=False, default="USD")
    gateway = Column(String(16), nullable=False, default="stripe")         # stripe | razorpay
    exhaustion_policy = Column(String(16), nullable=False, default="pause")  # pause | auto_bill
    stripe_customer_id = Column(String(128), nullable=True)
    stripe_subscription_id = Column(String(128), nullable=True)
    razorpay_customer_id = Column(String(128), nullable=True)
    razorpay_subscription_id = Column(String(128), nullable=True)
    billing_plan_id = Column(Integer, ForeignKey("billing_plans.id"), nullable=True)
    plan_expires_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC), onupdate=lambda: datetime.now(UTC))

    organization = relationship("OrganizationModel", backref="wallet", uselist=False)
    plan = relationship("BillingPlanModel", foreign_keys=[billing_plan_id])

    __table_args__ = (
        Index("ix_org_wallets_org_id", "organization_id"),
        Index("ix_org_wallets_stripe_customer", "stripe_customer_id"),
        Index("ix_org_wallets_razorpay_customer", "razorpay_customer_id"),
        CheckConstraint("balance >= 0", name="ck_org_wallets_balance_nonneg"),
    )


class WalletTransactionModel(Base):
    """Every balance movement: credits (subscription, top-up) and debits (usage)."""
    __tablename__ = "wallet_transactions"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    amount = Column(Numeric(14, 4), nullable=False)
    currency = Column(String(8), nullable=False)
    tx_type = Column(String(32), nullable=False)  # subscription_credit | topup | usage_debit | refund
    description = Column(Text, nullable=True)
    balance_after = Column(Numeric(14, 4), nullable=False)
    payment_intent_id = Column(Integer, nullable=True)
    workflow_run_id = Column(Integer, ForeignKey("workflow_runs.id"), nullable=True)
    metadata_ = Column("metadata", JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))

    __table_args__ = (
        Index("ix_wallet_tx_org_id", "organization_id"),
        Index("ix_wallet_tx_type", "tx_type"),
        Index("ix_wallet_tx_created_at", "created_at"),
        Index(
            "uq_wallet_tx_workflow_run_usage",
            "workflow_run_id",
            unique=True,
            postgresql_where=text("workflow_run_id IS NOT NULL AND tx_type = 'usage_debit'"),
        ),
        CheckConstraint("amount > 0", name="ck_wallet_tx_amount_positive"),
        CheckConstraint("balance_after >= 0", name="ck_wallet_tx_balance_nonneg"),
    )


class PaymentIntentModel(Base):
    """Tracks every Stripe/Razorpay payment attempt."""
    __tablename__ = "payment_intents"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    gateway = Column(String(16), nullable=False)          # stripe | razorpay
    gateway_payment_id = Column(String(256), nullable=True)
    amount = Column(Numeric(14, 2), nullable=False)
    currency = Column(String(8), nullable=False)
    purpose = Column(String(32), nullable=False)          # subscription | topup
    status = Column(String(16), nullable=False, default="pending")  # pending | succeeded | failed | refunded
    minutes_to_credit = Column(Integer, nullable=True)
    metadata_ = Column("metadata", JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC), onupdate=lambda: datetime.now(UTC))

    __table_args__ = (
        Index("ix_payment_intents_org_id", "organization_id"),
        Index("ix_payment_intents_gateway_id", "gateway_payment_id"),
        Index("ix_payment_intents_status", "status"),
        UniqueConstraint(
            "gateway", "gateway_payment_id",
            name="uq_payment_intents_gateway_payment",
        ),
        CheckConstraint("amount > 0", name="ck_payment_intents_amount_positive"),
    )


# ---------------------------------------------------------------------------
# Convozent platform models
# ---------------------------------------------------------------------------


class VoiceCatalogModel(Base):
    """Admin-curated TTS voice entries users can pick from."""
    __tablename__ = "voice_catalog"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(64), nullable=False)
    provider = Column(String(32), nullable=False)
    voice_id = Column(String(128), nullable=False)
    language = Column(String(16), nullable=False, default="en", server_default="en")
    gender = Column(String(16), nullable=True)
    accent = Column(String(64), nullable=True)
    preview_audio_url = Column(String(512), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True, server_default=text("true"))
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    __table_args__ = (
        UniqueConstraint("provider", "voice_id", name="uq_voice_catalog_provider_voice"),
        Index("ix_voice_catalog_provider", "provider"),
        Index("ix_voice_catalog_language", "language"),
        Index("ix_voice_catalog_is_active", "is_active"),
    )


class VoicePreviewModel(Base):
    """Generated TTS preview audio for a (provider, voice, model) combination.

    Rows with ``organization_id IS NULL`` (``scope='global'``) are the
    platform-curated previews every organization can listen to. Rows with an
    ``organization_id`` belong to one tenant and are the result of previewing
    with that tenant's own provider key.
    """

    __tablename__ = "voice_previews"

    id = Column(Integer, primary_key=True, index=True)
    scope = Column(String(16), nullable=False, default="global", server_default="global")
    organization_id = Column(
        Integer,
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    service_type = Column(String(8), nullable=False, default="tts", server_default="tts")
    provider = Column(String(32), nullable=False)
    model = Column(String(128), nullable=False, default="", server_default="")
    voice_id = Column(String(128), nullable=False)
    text_hash = Column(String(64), nullable=False)
    sample_text = Column(String(500), nullable=False, default="", server_default="")
    audio_key = Column(String(512), nullable=False)
    content_type = Column(
        String(64), nullable=False, default="audio/mpeg", server_default="audio/mpeg"
    )
    byte_size = Column(Integer, nullable=False, default=0, server_default=text("0"))
    render_ms = Column(Integer, nullable=True)
    created_by_user_id = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    __table_args__ = (
        # ``postgresql_nulls_not_distinct`` keeps the platform rows (organization_id
        # NULL) deduplicated by (provider, voice, model, text) like tenant rows.
        UniqueConstraint(
            "scope",
            "organization_id",
            "provider",
            "voice_id",
            "model",
            "text_hash",
            name="uq_voice_previews_cache_key",
            postgresql_nulls_not_distinct=True,
        ),
        CheckConstraint(
            "(scope = 'global' AND organization_id IS NULL) OR "
            "(scope = 'organization' AND organization_id IS NOT NULL)",
            name="ck_voice_previews_scope_organization",
        ),
        Index("ix_voice_previews_provider_voice", "provider", "voice_id"),
        Index("ix_voice_previews_scope_organization", "scope", "organization_id"),
    )


class ProviderLanguageCatalogModel(Base):
    """Languages a provider reported through its own API (the live list).

    One row per provider + capability + model. ``model`` is ``""`` when the
    provider gives one list for all its models. When the static list in code
    should be used instead, there is simply no row.

    A refresh that would shrink the list a lot is not applied: it is parked in
    ``pending_codes`` with ``pending_reason`` until an admin approves it.
    """
    __tablename__ = "provider_language_catalog"

    id = Column(Integer, primary_key=True, index=True)
    provider = Column(String(32), nullable=False)
    capability = Column(String(16), nullable=False)
    model = Column(String(128), nullable=False, default="", server_default="")
    codes = Column(JSON, nullable=False, default=list)
    voice_counts = Column(JSON, nullable=True)
    pending_codes = Column(JSON, nullable=True)
    pending_reason = Column(String(256), nullable=True)
    fetched_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    __table_args__ = (
        UniqueConstraint(
            "provider", "capability", "model", name="uq_provider_language_catalog_key"
        ),
        Index("ix_provider_language_catalog_provider", "provider", "capability"),
    )


class OrgPlatformConfigModel(Base):
    """Super-admin–assigned model/provider/key config for an org.

    Users in the org inherit this config and cannot see or change the
    underlying provider or keys.  They may only pick from allowed_voice_ids.
    """
    __tablename__ = "org_platform_config"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(
        Integer,
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    # JSON: { "provider": "google", "model": "gemini-3.1-flash-lite", "api_key": "..." }
    llm_config = Column(JSON, nullable=False, default=dict)
    stt_config = Column(JSON, nullable=False, default=dict)
    tts_config = Column(JSON, nullable=False, default=dict)
    # Typed super-admin per-org override, shaped like OrganizationAIModelConfigurationV2.
    # When present, this takes precedence over the global platform default and the
    # org's own self-serve config at runtime. Supersedes the loose *_config columns
    # above for model resolution.
    model_configuration_v2 = Column(JSON, nullable=True)
    # List of VoiceCatalogModel.id values the org's users may select
    allowed_voice_ids = Column(JSON, nullable=False, default=list)
    # Enabled product channels e.g. ["voice", "widget", "chat"]
    channels_enabled = Column(
        JSON, nullable=False, default=lambda: ["voice", "widget", "chat"]
    )
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    organization = relationship("OrganizationModel", backref="platform_config", uselist=False)

    __table_args__ = (
        Index("ix_org_platform_config_org_id", "organization_id"),
    )


class OrgSubscriptionModel(Base):
    """Billing plan per org. Schema-only; billing logic added later."""
    __tablename__ = "org_subscriptions"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(
        Integer,
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    plan_name = Column(String(64), nullable=False, default="starter")
    # trialing | active | past_due | cancelled
    status = Column(String(32), nullable=False, default="trialing")
    included_minutes = Column(Integer, nullable=False, default=100)
    included_messages = Column(Integer, nullable=False, default=1000)
    price_per_extra_minute = Column(Numeric(10, 4), nullable=False, default=0.05)
    price_per_extra_message = Column(Numeric(10, 4), nullable=False, default=0.001)
    current_period_start = Column(DateTime(timezone=True), nullable=True)
    current_period_end = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    organization = relationship("OrganizationModel", backref="subscription", uselist=False)

    __table_args__ = (
        Index("ix_org_subscriptions_org_id", "organization_id"),
        Index("ix_org_subscriptions_status", "status"),
    )


class PlatformConfigModel(Base):
    """Singleton platform-wide config keyed by name (mirrors organization_configurations).

    Holds the super-admin global default under key MODEL_CONFIGURATION_V2: the
    model/provider/key/voice every org inherits when it has no per-org override
    or self-serve config. Value is shaped like OrganizationAIModelConfigurationV2.
    """
    __tablename__ = "platform_configurations"

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String, nullable=False, unique=True)
    value = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    __table_args__ = (
        UniqueConstraint("key", name="uq_platform_configurations_key"),
    )


class PlatformModelConfigurationModel(Base):
    """A named, admin-curated model configuration preset.

    The super admin creates several of these (e.g. "English Sarvam India"). Org
    users pick one by display name when creating an agent; they never see the
    providers or keys. `config` is shaped like OrganizationAIModelConfigurationV2
    and carries the language inside its STT/TTS sections.
    """
    __tablename__ = "platform_model_configurations"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(128), nullable=False)
    description = Column(String(512), nullable=True)
    config = Column(JSON, nullable=False, default=dict)
    is_active = Column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )
    is_default = Column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    sort_order = Column(Integer, nullable=False, default=0, server_default=text("0"))
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    __table_args__ = (
        Index("ix_platform_model_configurations_is_active", "is_active"),
    )


class EnterpriseLeadModel(Base):
    """Enterprise / strategy-call lead captured in-house for data residency.

    Pre-signup and anonymous: no organization_id. Identity is the work email
    in the payload. Only superusers can list/read/update. Written via the
    public POST /api/v1/leads/enterprise endpoint (no auth, rate-limited
    at the route layer) so on-prem deployments never need the external
    user_onboarding service.
    """

    __tablename__ = "enterprise_leads"

    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )
    name = Column(String(256), nullable=False)
    company = Column(String(256), nullable=False)
    job_title = Column(String(256), nullable=False)
    work_email = Column(String(320), nullable=False)
    phone = Column(String(64), nullable=False)
    volume = Column(String(32), nullable=False, default="not-sure")
    deployment = Column(String(32), nullable=False, default="yes")
    agent_goal = Column(Text, nullable=True)
    source = Column(String(64), nullable=False, default="landing_contact")
    origin = Column(String(32), nullable=False, default="oss_app")
    country = Column(String(128), nullable=True)
    # new | contacted | qualified | closed
    status = Column(String(32), nullable=False, default="new", server_default=text("'new'"))
    contacted_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    contacted_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("ix_enterprise_leads_created_at", "created_at"),
        Index("ix_enterprise_leads_status", "status"),
        Index("ix_enterprise_leads_work_email", "work_email"),
        Index("ix_enterprise_leads_source", "source"),
    )


class OrgOnboardingProfileModel(Base):
    """Post-signup onboarding answers, one row per organization.

    Filled from the Welcome-to-Convozent popup. Org-scoped: owners read
    their own row via /organizations/onboarding-profile, superusers read
    any org via /admin/orgs/{id}/onboarding.
    """

    __tablename__ = "org_onboarding_profiles"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(
        Integer,
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    email = Column(String(320), nullable=True)
    persona = Column(String(64), nullable=True)
    onprem_need = Column(String(32), nullable=True)
    migrating_from = Column(String(64), nullable=True)
    migrating_other_provider = Column(String(256), nullable=True)
    switch_reason = Column(Text, nullable=True)
    how_heard = Column(String(64), nullable=True)
    volume = Column(String(32), nullable=True)
    country = Column(String(128), nullable=True)
    origin = Column(String(32), nullable=False, default="oss_app")
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    organization = relationship("OrganizationModel", backref="onboarding_profile", uselist=False)

    __table_args__ = (
        Index("ix_org_onboarding_profiles_org_id", "organization_id"),
        Index("ix_org_onboarding_profiles_email", "email"),
    )


class ProviderModelCatalogModel(Base):
    """Models a provider reported through its own API (the live list).

    No row means the list in code is used. A model the provider stops listing
    is marked ``deprecated``, never deleted, so saved agents keep working.
    """

    __tablename__ = "provider_model_catalog"

    id = Column(Integer, primary_key=True)
    provider = Column(String(32), nullable=False)
    capability = Column(String(16), nullable=False)
    model_id = Column(String(256), nullable=False)
    display_name = Column(String(256), nullable=True)
    status = Column(String(16), nullable=False, default="active", server_default="active")
    first_seen_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    last_seen_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "provider", "capability", "model_id", name="uq_provider_model_catalog_key"
        ),
        CheckConstraint(
            "capability IN ('llm', 'tts', 'stt', 'realtime')", name="ck_provider_model_capability"
        ),
        CheckConstraint("status IN ('active', 'deprecated')", name="ck_provider_model_status"),
        Index("ix_provider_model_catalog_provider", "provider", "capability"),
    )


class ModelPriceVersionModel(Base):
    """One dated price for a provider + model + billing component.

    Rows are never edited: a new price closes the old row, so an earlier call
    keeps the price it ran at. A changed price waits as ``pending`` for an admin.
    """

    __tablename__ = "model_price_versions"

    id = Column(Integer, primary_key=True)
    provider = Column(String(32), nullable=False)
    capability = Column(String(16), nullable=False)
    model_id = Column(String(256), nullable=False)
    component = Column(String(32), nullable=False)
    rate = Column(Numeric(20, 10), nullable=False)
    unit_quantity = Column(Integer, nullable=False)
    currency = Column(String(3), nullable=False, default="USD", server_default="USD")
    tier = Column(String(64), nullable=True)
    source = Column(String(16), nullable=False)
    source_url = Column(String(512), nullable=True)
    note = Column(String(256), nullable=True)
    review_status = Column(
        String(16), nullable=False, default="approved", server_default="approved"
    )
    reviewed_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    effective_from = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    effective_to = Column(DateTime(timezone=True), nullable=True)
    verified_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        CheckConstraint("capability IN ('llm', 'tts', 'stt', 'realtime')", name="ck_price_capability"),
        CheckConstraint("source IN ('admin', 'provider_api', 'official', 'feed')", name="ck_price_source"),
        CheckConstraint("review_status IN ('approved', 'pending', 'rejected')", name="ck_price_review_status"),
        CheckConstraint("rate >= 0", name="ck_price_rate_not_negative"),
        CheckConstraint("unit_quantity > 0", name="ck_price_unit_positive"),
        Index("ix_model_price_lookup", "provider", "capability", "model_id", "review_status"),
        Index(
            "uq_model_price_active",
            "provider", "capability", "model_id", "component", "source",
            unique=True,
            postgresql_where=text("review_status = 'approved' AND effective_to IS NULL"),
        ),
        Index(
            "uq_model_price_pending",
            "provider", "capability", "model_id", "component", "source",
            unique=True,
            postgresql_where=text("review_status = 'pending'"),
        ),
    )


class ModelPricingRuleModel(Base):
    """Admin-managed pricing rules for LLM, TTS and STT providers.

    Each rule has a regex pattern tested against the lowercased model/provider
    name.  Rules are evaluated top-to-bottom by sort_order; the first match
    wins.  Family-level patterns (e.g. ``gemini.*flash``) automatically cover
    future model versions with no code change.
    """

    __tablename__ = "model_pricing_rules"

    id = Column(Integer, primary_key=True, index=True)
    service_type = Column(
        String(8), nullable=False, comment="llm | tts | stt"
    )
    label = Column(
        String(128), nullable=False,
        comment="Human-readable name, e.g. 'Gemini Flash family'",
    )
    pattern = Column(
        String(256), nullable=False,
        comment="Regex tested against lowercased model name",
    )
    input_rate = Column(
        Numeric(12, 6), nullable=False, default=0,
        comment="LLM: USD per 1M input tokens; TTS: USD per 1M chars; STT: unused",
    )
    output_rate = Column(
        Numeric(12, 6), nullable=False, default=0,
        comment="LLM: USD per 1M output tokens; TTS/STT: unused",
    )
    unit_rate = Column(
        Numeric(12, 6), nullable=False, default=0,
        comment="TTS: per-1M-chars (alias); STT: per-minute; LLM: unused",
    )
    sort_order = Column(
        Integer, nullable=False, default=0, server_default=text("0"),
        comment="Lower = higher priority; first matching rule wins",
    )
    is_active = Column(
        Boolean, nullable=False, default=True, server_default=text("true"),
    )
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    __table_args__ = (
        CheckConstraint("service_type IN ('llm', 'tts', 'stt')", name="ck_pricing_service_type"),
        Index("ix_model_pricing_rules_service_type", "service_type"),
        Index("ix_model_pricing_rules_sort_order", "sort_order"),
    )


# ==============================================================================
# EMAIL AGENT & INBOX AUTOMATION MODELS
# ==============================================================================


class GmailAccountModel(Base):
    """Connected Gmail OAuth account for an organization."""

    __tablename__ = "gmail_accounts"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    email = Column(String(320), nullable=False)
    refresh_token_encrypted = Column(Text, nullable=False)
    access_token_encrypted = Column(Text, nullable=True)
    access_token_expires_at = Column(DateTime(timezone=True), nullable=True)
    history_id = Column(String(32), nullable=True)
    status = Column(
        String(24), nullable=False, default="connected", server_default=text("'connected'")
    )
    extra_metadata = Column(
        JSON, nullable=False, default=dict, server_default=text("'{}'::json")
    )
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    organization = relationship("OrganizationModel")
    email_messages = relationship("EmailMessageModel", back_populates="gmail_account", cascade="all, delete-orphan")
    email_agents = relationship("EmailAgentModel", back_populates="gmail_account")

    __table_args__ = (
        UniqueConstraint("organization_id", "email", name="uq_gmail_accounts_org_email"),
        Index("ix_gmail_accounts_org", "organization_id"),
        Index("ix_gmail_accounts_id", "id"),
    )


class OutlookAccountModel(Base):
    """Connected Microsoft Graph / Outlook OAuth account for an organization."""

    __tablename__ = "outlook_accounts"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    email = Column(String(320), nullable=False)
    refresh_token_encrypted = Column(Text, nullable=False)
    access_token_encrypted = Column(Text, nullable=True)
    access_token_expires_at = Column(DateTime(timezone=True), nullable=True)
    delta_link = Column(Text, nullable=True)
    status = Column(
        String(24), nullable=False, default="connected", server_default=text("'connected'")
    )
    extra_metadata = Column(
        JSON, nullable=False, default=dict, server_default=text("'{}'::json")
    )
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    organization = relationship("OrganizationModel")
    email_messages = relationship("EmailMessageModel", back_populates="outlook_account", cascade="all, delete-orphan")
    email_agents = relationship("EmailAgentModel", back_populates="outlook_account")

    __table_args__ = (
        UniqueConstraint("organization_id", "email", name="uq_outlook_accounts_org_email"),
        Index("ix_outlook_accounts_org", "organization_id"),
        Index("ix_outlook_accounts_id", "id"),
    )


class EmailAgentModel(Base):
    """Email Agent managing inbound and outbound auto-responses."""

    __tablename__ = "email_agents"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name = Column(String(64), nullable=False)
    description = Column(String(512), nullable=True)
    system_prompt = Column(Text, nullable=False, default="", server_default=text("''"))
    gmail_account_id = Column(
        Integer, ForeignKey("gmail_accounts.id", ondelete="SET NULL"), nullable=True
    )
    outlook_account_id = Column(
        Integer, ForeignKey("outlook_accounts.id", ondelete="SET NULL"), nullable=True
    )
    model_config_ref = Column(
        JSON, nullable=False, default=dict, server_default=text("'{}'::json")
    )
    is_active = Column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )
    auto_reply_enabled = Column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    organization = relationship("OrganizationModel")
    gmail_account = relationship("GmailAccountModel", back_populates="email_agents")
    outlook_account = relationship("OutlookAccountModel", back_populates="email_agents")
    ai_runs = relationship("EmailAIRunModel", back_populates="email_agent")

    __table_args__ = (
        UniqueConstraint("organization_id", "name", name="uq_email_agents_org_name"),
        Index("ix_email_agents_org", "organization_id"),
        Index("ix_email_agents_account", "gmail_account_id"),
        Index("ix_email_agents_outlook_account", "outlook_account_id"),
        Index("ix_email_agents_id", "id"),
    )


class EmailMessageModel(Base):
    """Provider-normalized email message record."""

    __tablename__ = "email_messages"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    gmail_account_id = Column(
        Integer, ForeignKey("gmail_accounts.id", ondelete="CASCADE"), nullable=True
    )
    outlook_account_id = Column(
        Integer, ForeignKey("outlook_accounts.id", ondelete="CASCADE"), nullable=True
    )
    provider = Column(
        String(16), nullable=False, default="gmail", server_default=text("'gmail'")
    )
    gmail_message_id = Column(String(32), nullable=False)
    gmail_thread_id = Column(String(32), nullable=True)
    subject = Column(String(1024), nullable=True)
    sender = Column(String(320), nullable=True)
    snippet = Column(String(2048), nullable=True)
    body_text = Column(Text, nullable=True)
    body_html = Column(Text, nullable=True)
    gmail_labels = Column(
        JSON, nullable=False, default=list, server_default=text("'[]'::json")
    )
    headers = Column(
        JSON, nullable=False, default=dict, server_default=text("'{}'::json")
    )
    internal_date = Column(DateTime(timezone=True), nullable=True)
    ai_category = Column(String(48), nullable=True, index=True)
    ai_priority = Column(String(16), nullable=True)
    is_read = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    is_archived = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))

    organization = relationship("OrganizationModel")
    gmail_account = relationship("GmailAccountModel", back_populates="email_messages")
    outlook_account = relationship("OutlookAccountModel", back_populates="email_messages")
    ai_runs = relationship("EmailAIRunModel", back_populates="email_message", cascade="all, delete-orphan")
    attachments = relationship("EmailAttachmentModel", back_populates="email_message", cascade="all, delete-orphan")
    followup = relationship("EmailFollowUpModel", back_populates="email_message", uselist=False, cascade="all, delete-orphan")
    rule_executions = relationship("EmailRuleExecutionModel", back_populates="email_message", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("organization_id", "gmail_account_id", "gmail_message_id", name="uq_email_messages_gmail_account_message"),
        UniqueConstraint("organization_id", "outlook_account_id", "gmail_message_id", name="uq_email_messages_outlook_account_message"),
        Index("ix_email_messages_account_date", "gmail_account_id", "internal_date"),
        Index("ix_email_messages_outlook_account_date", "outlook_account_id", "internal_date"),
        Index("ix_email_messages_id", "id"),
    )


class EmailAIRunModel(Base):
    """Historical execution record of AI summarization, classification, and drafting for an email."""

    __tablename__ = "email_ai_runs"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    email_message_id = Column(
        Integer, ForeignKey("email_messages.id", ondelete="CASCADE"), nullable=False, index=True
    )
    email_agent_id = Column(
        Integer, ForeignKey("email_agents.id", ondelete="SET NULL"), nullable=True
    )
    summary = Column(Text, nullable=True)
    draft_reply = Column(Text, nullable=True)
    key_points = Column(
        JSON, nullable=True, default=list, server_default=text("'[]'::json")
    )
    suggested_action = Column(Text, nullable=True)
    model = Column(String(128), nullable=True)
    status = Column(
        String(24), nullable=False, default="completed", server_default=text("'completed'")
    )
    error = Column(Text, nullable=True)
    gmail_draft_id = Column(String(32), nullable=True)
    gmail_sent_message_id = Column(String(32), nullable=True)
    auto_send_status = Column(
        String(16), nullable=False, default="none", server_default=text("'none'")
    )
    sent_at = Column(DateTime(timezone=True), nullable=True)
    send_error = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))

    organization = relationship("OrganizationModel")
    email_message = relationship("EmailMessageModel", back_populates="ai_runs")
    email_agent = relationship("EmailAgentModel", back_populates="ai_runs")

    __table_args__ = (
        UniqueConstraint("email_message_id", "email_agent_id", name="uq_email_ai_runs_message_agent"),
        Index("ix_email_ai_runs_id", "id"),
        Index("ix_email_ai_runs_message", "email_message_id"),
    )


class EmailRuleModel(Base):
    """User-configured automation rule with natural-language prompt and conditions."""

    __tablename__ = "email_rules"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name = Column(String(128), nullable=False)
    description = Column(String(512), nullable=True)
    natural_language_prompt = Column(Text, nullable=True)
    is_active = Column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )
    priority = Column(
        Integer, nullable=False, default=0, server_default=text("0")
    )
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    organization = relationship("OrganizationModel")
    conditions = relationship("EmailRuleConditionModel", back_populates="rule", cascade="all, delete-orphan")
    actions = relationship("EmailRuleActionModel", back_populates="rule", cascade="all, delete-orphan")
    executions = relationship("EmailRuleExecutionModel", back_populates="rule", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_email_rules_org", "organization_id"),
        Index("ix_email_rules_priority", "priority"),
    )


class EmailRuleConditionModel(Base):
    """Predicate condition for an automation rule."""

    __tablename__ = "email_rule_conditions"

    id = Column(Integer, primary_key=True, index=True)
    rule_id = Column(
        Integer, ForeignKey("email_rules.id", ondelete="CASCADE"), nullable=False, index=True
    )
    field = Column(String(64), nullable=False)
    operator = Column(String(32), nullable=False)
    value = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))

    rule = relationship("EmailRuleModel", back_populates="conditions")


class EmailRuleActionModel(Base):
    """Action executed when rule conditions match."""

    __tablename__ = "email_rule_actions"

    id = Column(Integer, primary_key=True, index=True)
    rule_id = Column(
        Integer, ForeignKey("email_rules.id", ondelete="CASCADE"), nullable=False, index=True
    )
    action_type = Column(String(64), nullable=False)
    parameters = Column(
        JSON, nullable=False, default=dict, server_default=text("'{}'::json")
    )
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))

    rule = relationship("EmailRuleModel", back_populates="actions")


class EmailRuleExecutionModel(Base):
    """Audit log of rule evaluations and executed actions."""

    __tablename__ = "email_rule_executions"

    id = Column(Integer, primary_key=True, index=True)
    rule_id = Column(
        Integer, ForeignKey("email_rules.id", ondelete="CASCADE"), nullable=False, index=True
    )
    message_id = Column(
        Integer, ForeignKey("email_messages.id", ondelete="CASCADE"), nullable=False, index=True
    )
    organization_id = Column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    status = Column(
        String(24), nullable=False, default="success", server_default=text("'success'")
    )
    details = Column(
        JSON, nullable=False, default=dict, server_default=text("'{}'::json")
    )
    executed_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))

    rule = relationship("EmailRuleModel", back_populates="executions")
    email_message = relationship("EmailMessageModel", back_populates="rule_executions")
    organization = relationship("OrganizationModel")

    __table_args__ = (
        Index("ix_email_rule_executions_org_date", "organization_id", "executed_at"),
    )


class EmailFollowUpModel(Base):
    """Reply Zero follow-up tracker: conversations needing reply or awaiting response."""

    __tablename__ = "email_followups"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    email_message_id = Column(
        Integer, ForeignKey("email_messages.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    thread_id = Column(String(64), nullable=True, index=True)
    status = Column(
        String(32), nullable=False, default="needs_reply", server_default=text("'needs_reply'")
    )
    due_date = Column(DateTime(timezone=True), nullable=True)
    last_contact_at = Column(DateTime(timezone=True), nullable=True)
    suggested_followup = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    organization = relationship("OrganizationModel")
    email_message = relationship("EmailMessageModel", back_populates="followup")

    __table_args__ = (
        Index("ix_email_followups_org_status", "organization_id", "status"),
    )


class EmailAttachmentModel(Base):
    """Attachment metadata and storage record for Smart Filing."""

    __tablename__ = "email_attachments"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    email_message_id = Column(
        Integer, ForeignKey("email_messages.id", ondelete="CASCADE"), nullable=False, index=True
    )
    filename = Column(String(256), nullable=False)
    content_type = Column(String(128), nullable=True)
    file_size = Column(Integer, nullable=False, default=0, server_default=text("0"))
    storage_path = Column(String(512), nullable=False)
    file_hash = Column(String(64), nullable=True)
    is_uploaded = Column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))

    organization = relationship("OrganizationModel")
    email_message = relationship("EmailMessageModel", back_populates="attachments")

    __table_args__ = (
        Index("ix_email_attachments_org", "organization_id"),
        Index("ix_email_attachments_msg", "email_message_id"),
    )


class EmailDigestModel(Base):
    """Scheduled periodic email digest summary."""

    __tablename__ = "email_digests"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    frequency = Column(
        String(24), nullable=False, default="daily", server_default=text("'daily'")
    )
    status = Column(
        String(24), nullable=False, default="generated", server_default=text("'generated'")
    )
    content_summary = Column(Text, nullable=False)
    stats = Column(
        JSON, nullable=False, default=dict, server_default=text("'{}'::json")
    )
    generated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))

    organization = relationship("OrganizationModel")

    __table_args__ = (
        Index("ix_email_digests_org_freq", "organization_id", "frequency"),
    )
