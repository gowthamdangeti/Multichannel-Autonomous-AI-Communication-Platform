from datetime import datetime

from pydantic import BaseModel


class AgentAnalyticsSummary(BaseModel):
    sessions: int
    sessions_with_usage: int
    total_duration_seconds: float
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    cache_read_tokens: int
    turns: int
    tool_calls: int
    avg_response_ms: int | None
    avg_resolution_score: int | None


class AgentDailyTokens(BaseModel):
    date: str
    prompt_tokens: int
    completion_tokens: int
    conversations: int


class AgentDailyTrend(BaseModel):
    date: str
    conversations: int
    avg_duration_seconds: int | None
    avg_response_ms: int | None
    avg_resolution_score: int | None
    cache_read_tokens: int
    prompt_tokens: int
    outcomes: dict[str, int]


class AgentHourCount(BaseModel):
    hour: int
    conversations: int


class AgentWeekdayCount(BaseModel):
    day: str
    conversations: int


class AgentModelUsage(BaseModel):
    name: str
    provider: str | None
    model: str | None
    total_tokens: int
    prompt_tokens: int
    completion_tokens: int
    cache_read_tokens: int
    share: float
    conversations: int
    sessions_with_usage: int
    turns: int
    daily: list[AgentDailyTokens]


class AgentNodeUsage(BaseModel):
    name: str
    turns: int
    share: float
    avg_response_ms: int | None
    tool_calls: int


class AgentHeavyConversation(BaseModel):
    run_id: int
    title: str
    created_at: datetime
    disposition: str | None
    total_tokens: int


class AgentCount(BaseModel):
    name: str
    count: int


class AgentPerformanceMetric(BaseModel):
    key: str
    score: int | None
    sample: int


class AgentPerformance(BaseModel):
    overall: int | None
    metrics: list[AgentPerformanceMetric]


class AgentAnalyticsResponse(BaseModel):
    days: int
    is_truncated: bool
    summary: AgentAnalyticsSummary
    daily: list[AgentDailyTokens]
    trends: list[AgentDailyTrend]
    hourly: list[AgentHourCount]
    weekdays: list[AgentWeekdayCount]
    by_model: list[AgentModelUsage]
    by_node: list[AgentNodeUsage]
    heaviest: list[AgentHeavyConversation]
    outcomes: list[AgentCount]
    verdicts: list[AgentCount]
    performance: AgentPerformance
