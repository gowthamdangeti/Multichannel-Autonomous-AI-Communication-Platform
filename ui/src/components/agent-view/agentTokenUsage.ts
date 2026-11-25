import type { AgentAnalyticsResponse, AgentDailyTokens } from "@/client/types.gen";

/**
 * Pure derivation for the agent view's "Token Usage Breakdown" card. Kept out of
 * the component so the stack-filter behavior is testable without a browser.
 */

// Sentinel: shadcn Select forbids an empty-string value, so "all stacks" needs one.
export const ALL_STACKS = "__all__";

export interface StackOption {
  name: string;
  totalTokens: number;
}

/** Stacks with recorded tokens, in the API's total-tokens-descending order. */
export function stackOptions(analytics: AgentAnalyticsResponse | null): StackOption[] {
  return (analytics?.by_model ?? [])
    .filter((stack) => stack.total_tokens > 0)
    .map((stack) => ({ name: stack.name, totalTokens: stack.total_tokens }));
}

/** An unknown name (e.g. a range change dropped the stack) falls back to all-stacks. */
export interface TokenUsageFigures {
  total: number;
  prompt: number;
  completion: number;
  sessions: number;
  turns: number;
  daily: AgentDailyTokens[];
}

export function tokenUsageFigures(
  analytics: AgentAnalyticsResponse | null,
  selectedName: string,
): TokenUsageFigures {
  const selected = analytics?.by_model.find((stack) => stack.name === selectedName) ?? null;
  const summary = analytics?.summary;

  return {
    total: selected?.total_tokens ?? summary?.total_tokens ?? 0,
    prompt: selected?.prompt_tokens ?? summary?.prompt_tokens ?? 0,
    completion: selected?.completion_tokens ?? summary?.completion_tokens ?? 0,
    sessions: selected?.sessions_with_usage ?? summary?.sessions_with_usage ?? 0,
    turns: selected?.turns ?? summary?.turns ?? 0,
    daily: selected?.daily ?? analytics?.daily ?? [],
  };
}
