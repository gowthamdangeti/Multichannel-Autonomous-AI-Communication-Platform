"""Shapes for the website-chat tab of the overview page.

``*Record`` / ``*Group`` models carry rows from the DB client to the service;
the rest is the response the page reads.
"""

from datetime import datetime

from pydantic import BaseModel


# ─── DB client rows ──────────────────────────────────────────────────────────


class ChatAgentRecord(BaseModel):
    id: int
    name: str
    is_active: bool


class ChatConversationGroup(BaseModel):
    """Conversations that share an agent, start day, website and length band."""

    chat_agent_id: int
    day: str
    origin: str | None
    length_band: str
    conversations: int
    messages: int
    visitor_messages: int
    last_activity_at: datetime | None


class ChatConversationClock(BaseModel):
    """Conversations that started in one UTC hour on one weekday (0 = Monday)."""

    hour: int
    weekday: int
    conversations: int


class ChatPreviousConversations(BaseModel):
    chat_agent_id: int
    conversations: int


class ChatReplyUsage(BaseModel):
    """Usage the provider reported on stored replies; older replies carry none."""

    prompt_tokens: int
    completion_tokens: int
    # Replies = assistant messages stored. The `with_*` counts are the subset
    # that carried the field, so the UI can say what share was measured.
    replies: int
    replies_with_usage: int
    replies_with_latency: int
    fast_replies: int
    conversations_with_usage: int
    avg_latency_ms: int | None


class ChatDailyTokens(BaseModel):
    """Tokens the replies of conversations started that day reported."""

    date: str
    prompt_tokens: int
    completion_tokens: int
    conversations: int


class ChatModelUsage(BaseModel):
    """What one model stack was asked to generate.

    `name` is the stack's preset name recorded when the session started (the
    model name when the session recorded none), as on the voice agent page.
    """

    name: str
    provider: str | None = None
    model: str | None = None
    prompt_tokens: int
    completion_tokens: int
    replies: int
    # Conversations that had at least one reply from this model.
    conversations: int = 0
    # This model's tokens per day the conversation started (gaps are padded by the report).
    daily: list[ChatDailyTokens] = []


class ChatHeavyConversation(BaseModel):
    """A conversation ranked by the tokens its replies reported."""

    id: int
    # Display title: the saved one, else `{agent name}_embed_{id}`.
    title: str = ""
    origin: str | None
    created_at: datetime | None
    messages: int
    total_tokens: int


class ChatPerformanceMetric(BaseModel):
    """One radar axis: `score` is None when nothing on that axis was measured."""

    key: str
    score: int | None
    sample: int


class ChatPerformance(BaseModel):
    overall: int | None
    metrics: list[ChatPerformanceMetric]


# ─── Response ────────────────────────────────────────────────────────────────


class ChatOverviewSummary(BaseModel):
    total_agents: int
    active_agents: int
    agents_with_conversations: int
    conversations: int
    prev_conversations: int | None
    messages: int
    visitor_messages: int
    avg_messages_per_conversation: float
    engaged_rate: float | None


class ChatOverviewDay(BaseModel):
    date: str
    conversations: int
    messages: int


class ChatAgentRow(BaseModel):
    id: int
    name: str
    is_active: bool
    conversations: int
    prev_conversations: int | None
    conversation_share: float
    messages: int
    avg_messages_per_conversation: float
    engaged_rate: float | None
    top_website: str | None
    last_activity_at: datetime | None


class ChatOverviewCount(BaseModel):
    key: str
    count: int


class ChatOverviewHour(BaseModel):
    hour: int
    count: int


class ChatOverviewWeekday(BaseModel):
    day: str
    count: int


class ChatCount(BaseModel):
    name: str
    count: int


class ChatResolution(BaseModel):
    """How the agent's conversations ended and how completely they were resolved."""

    # Mean completeness score over the conversations that have been evaluated.
    avg_score: int | None
    evaluated: int
    conversations: int
    verdicts: list[ChatCount]
    outcomes: list[ChatCount]


class ChatAgentOverviewResponse(BaseModel):
    days: int
    summary: ChatOverviewSummary
    daily: list[ChatOverviewDay]
    agents: list[ChatAgentRow]
    websites: list[ChatOverviewCount]
    lengths: list[ChatOverviewCount]
    hourly: list[ChatOverviewHour]
    weekday: list[ChatOverviewWeekday]


class ChatAgentAnalyticsResponse(ChatAgentOverviewResponse):
    """One agent's overview plus the usage its replies reported."""

    usage: ChatReplyUsage
    daily_tokens: list[ChatDailyTokens]
    by_model: list[ChatModelUsage]
    heaviest: list[ChatHeavyConversation]
    performance: ChatPerformance
    resolution: ChatResolution
