import type { ChatAgentAnalyticsResponse, ChatDailyTokens } from "@/client/types.gen";

/**
 * Pure derivation for the chat agent's "Token Usage Breakdown" card, the chat
 * counterpart of agentTokenUsage.ts: pick a model stack and the tiles and the
 * daily chart show only that stack's replies.
 */

// Sentinel: shadcn Select forbids an empty-string value, so "all models" needs one.
export const ALL_MODELS = "__all__";

export interface ModelOption {
  name: string;
  totalTokens: number;
}

/** Model stacks that reported tokens, in the API's heaviest-first order. */
export function modelOptions(analytics: ChatAgentAnalyticsResponse | null): ModelOption[] {
  return (analytics?.by_model ?? [])
    .filter((model) => model.prompt_tokens + model.completion_tokens > 0)
    .map((model) => ({ name: model.name, totalTokens: model.prompt_tokens + model.completion_tokens }));
}

export interface ChatTokenUsageFigures {
  total: number;
  prompt: number;
  completion: number;
  conversations: number;
  replies: number;
  daily: ChatDailyTokens[];
}

/** An unknown name (e.g. a range change dropped the model) falls back to all models. */
export function chatTokenUsageFigures(
  analytics: ChatAgentAnalyticsResponse | null,
  selectedName: string,
): ChatTokenUsageFigures {
  const selected = analytics?.by_model.find((model) => model.name === selectedName) ?? null;
  const prompt = selected?.prompt_tokens ?? analytics?.usage.prompt_tokens ?? 0;
  const completion = selected?.completion_tokens ?? analytics?.usage.completion_tokens ?? 0;

  return {
    total: prompt + completion,
    prompt,
    completion,
    conversations: selected?.conversations ?? analytics?.summary.conversations ?? 0,
    replies: selected?.replies ?? analytics?.usage.replies ?? 0,
    daily: selected?.daily ?? analytics?.daily_tokens ?? [],
  };
}
