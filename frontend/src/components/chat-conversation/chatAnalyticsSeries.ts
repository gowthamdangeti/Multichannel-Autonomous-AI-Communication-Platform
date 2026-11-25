/**
 * The per-reply series and the number formatting the chat analytics charts
 * share. Kept separate from the cards so a card can import it without pulling
 * in the component that renders its siblings.
 *
 * A reply that reported nothing keeps `null` here: the charts plot a gap, they
 * never plot a zero the provider did not send.
 */

import type { ReplyPoint, RequestPoint } from "./chatConversationStats";

export interface ChatReplyChartPoint {
  /** X-axis label: the reply's position in the transcript. */
  turn: string;
  promptTokens: number | null;
  completionTokens: number | null;
  llmLatencyMs: number | null;
}

export function toReplyChartPoints(replies: ReplyPoint[]): ChatReplyChartPoint[] {
  return replies.map((r) => ({
    turn: `#${r.reply}`,
    promptTokens: r.promptTokens,
    completionTokens: r.completionTokens,
    llmLatencyMs: r.latencyMs,
  }));
}

export interface ChatRequestChartPoint {
  turn: string;
  successfulRequests: number;
  failedRequests: number;
  /** Share of requests answered so far, 0-100. */
  successRate: number;
}

export function toRequestChartPoints(requests: RequestPoint[]): ChatRequestChartPoint[] {
  let answered = 0;
  return requests.map((r) => {
    if (r.successful) answered += 1;
    return {
      turn: `#${r.request}`,
      successfulRequests: r.successful ? 1 : 0,
      failedRequests: r.successful ? 0 : 1,
      successRate: Math.round((answered / r.request) * 100),
    };
  });
}

/** Same granularity the voice run page uses, so the two read alike. */
export function formatUSD(amount: number): string {
  if (amount <= 0) return "$0.0000";
  if (amount < 0.0001) return "< $0.0001";
  return `$${amount.toFixed(4)}`;
}

export function formatTokensCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}
