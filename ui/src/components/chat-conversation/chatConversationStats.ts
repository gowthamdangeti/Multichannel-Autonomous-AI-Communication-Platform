import type { ChatMessage } from "@/client/types.gen";

export interface ReplyPoint {
  /** 1-based position among the assistant replies. */
  reply: number;
  /** The model that produced this reply, when the reply stored one. */
  model: string | null;
  latencyMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
}

/** One visitor message and whether the model answered it. */
export interface RequestPoint {
  /** 1-based position among the visitor's messages. */
  request: number;
  successful: boolean;
}

export interface ChatConversationStats {
  visitorMessages: number;
  assistantMessages: number;
  /** Totals cover only replies where the provider reported usage; null when none did. */
  promptTokens: number | null;
  completionTokens: number | null;
  avgLatencyMs: number | null;
  model: string | null;
  replies: ReplyPoint[];
  /** One entry per answered or failed visitor message, oldest first. */
  requests: RequestPoint[];
}

const sum = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) : null);

/** Everything here is read straight from the stored messages; nothing is estimated. */
export function summarizeConversation(
  messages: ChatMessage[],
  lastReplyFailed = false,
): ChatConversationStats {
  const assistant = messages.filter((m) => m.role === "assistant");
  const replies = assistant.map<ReplyPoint>((m, i) => ({
    reply: i + 1,
    model: m.model ?? null,
    latencyMs: m.latency_ms ?? null,
    promptTokens: m.prompt_tokens ?? null,
    completionTokens: m.completion_tokens ?? null,
  }));
  const latencies = replies.flatMap((r) => (r.latencyMs === null ? [] : [r.latencyMs]));
  const latencySum = sum(latencies);
  return {
    visitorMessages: messages.filter((m) => m.role === "user").length,
    assistantMessages: assistant.length,
    promptTokens: sum(replies.flatMap((r) => (r.promptTokens === null ? [] : [r.promptTokens]))),
    completionTokens: sum(replies.flatMap((r) => (r.completionTokens === null ? [] : [r.completionTokens]))),
    avgLatencyMs: latencySum === null ? null : Math.round(latencySum / latencies.length),
    model: [...assistant].reverse().find((m) => m.model)?.model ?? null,
    replies,
    requests: toRequestPoints(messages, lastReplyFailed),
  };
}

/**
 * A failed reply still saves the visitor's message but no assistant message, so
 * a visitor message is answered when the next message is the assistant's. A
 * trailing message with no reply is a failure only when the conversation says
 * the latest reply failed; otherwise it is still in flight and is left out.
 */
function toRequestPoints(messages: ChatMessage[], lastReplyFailed: boolean): RequestPoint[] {
  const points: RequestPoint[] = [];
  messages.forEach((m, i) => {
    if (m.role !== "user") return;
    const next = messages[i + 1];
    if (next) {
      points.push({ request: points.length + 1, successful: next.role === "assistant" });
    } else if (lastReplyFailed) {
      points.push({ request: points.length + 1, successful: false });
    }
  });
  return points;
}
