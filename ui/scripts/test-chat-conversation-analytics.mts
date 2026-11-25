// Run via `npm run test:chat-conversation-analytics` from ui/ (Node 24+ strips TS types).
//
// The right-hand column of a chat conversation must never invent a number:
// cost is summed only over replies that reported tokens and matched a pricing
// rule, reply timing averages only the latencies that were reported, and the
// completeness score is clamped to 0-100. Anything missing is null (a dash on
// screen), never zero.

import assert from "node:assert/strict";

import type { ReplyPoint } from "../src/components/chat-conversation/chatConversationStats.ts";
import { summarizeChatAnalytics } from "../src/lib/chatConversationAnalytics.ts";

// The caller binds the organization's rules; here the rates are literal.
const rates =
  (table: Record<string, [number, number]>) =>
  (model: string) => {
    const hit = table[model];
    return hit
      ? { inputPer1M: hit[0], outputPer1M: hit[1], priced: true }
      : { inputPer1M: 0, outputPer1M: 0, priced: false };
  };

const reply = (overrides: Partial<ReplyPoint> = {}): ReplyPoint => ({
  reply: 1,
  model: "gpt-4o-mini",
  latencyMs: null,
  promptTokens: null,
  completionTokens: null,
  ...overrides,
});

const base = {
  durationMs: null,
  recordedDurationSeconds: null,
  updatedAt: null,
  evaluation: null,
};

// A conversation whose replies reported nothing has no aggregate at all.
{
  const summary = summarizeChatAnalytics({ ...base, replies: [reply(), reply({ reply: 2 })] });
  assert.equal(summary.cost, null, "no reported tokens means no cost");
  assert.equal(summary.response, null, "no reported latency means no response time");
  assert.equal(summary.success, null, "no evaluation means no score");
  assert.equal(summary.durationSeconds, null, "no timing source means no duration");
}

// Priced replies sum prompt and completion at the matched model's rates.
{
  const summary = summarizeChatAnalytics({
    ...base,
    replies: [
      reply({ promptTokens: 1_000_000, completionTokens: 1_000_000, latencyMs: 400 }),
      reply({ reply: 2, promptTokens: 500_000, completionTokens: 0, latencyMs: 600 }),
    ],
    rateFor: rates({ "gpt-4o-mini": [3, 15] }),
  });
  // 1M in + 0.5M in at $3/M = $4.50; 1M out at $15/M = $15.
  assert.equal(summary.cost?.totalUsd, 19.5);
  assert.equal(summary.cost?.totalUsd, 19.5);
  assert.equal(summary.cost?.unpricedModels, 0);
  assert.equal(summary.cost?.modelCount, 1, "one model, however many replies");
  assert.deepEqual(summary.response, { totalMs: 1000, avgMs: 500, reported: 2 });
}

// A model with no pricing rule makes the total a lower bound, and says so.
{
  const summary = summarizeChatAnalytics({
    ...base,
    replies: [reply({ promptTokens: 1_000_000, completionTokens: 1_000_000 })],
    rateFor: rates({}),
  });
  assert.equal(summary.cost?.unpricedModels, 1);
  assert.equal(summary.cost?.modelCount, 1);
  assert.equal(summary.cost?.totalUsd, 0);

  const mixed = summarizeChatAnalytics({
    ...base,
    replies: [
      reply({ promptTokens: 1_000_000, completionTokens: 1_000_000 }),
      reply({ reply: 2, model: "mystery-model", promptTokens: 10, completionTokens: 10 }),
    ],
    rateFor: rates({ "gpt-4o-mini": [3, 15] }),
  });
  // The renderer turns (totalUsd, unpricedModels) into "$18.000000 + unpriced".
  assert.equal(mixed.cost?.totalUsd, 18);
  assert.equal(mixed.cost?.unpricedModels, 1);
  assert.equal(mixed.cost?.modelCount, 2);
}

// Replies that reported nothing do not make an unpriced model out of a missing one.
{
  const summary = summarizeChatAnalytics({
    ...base,
    replies: [reply({ model: null, latencyMs: 250 })],
    rateFor: rates({}),
  });
  assert.equal(summary.cost, null);
  assert.deepEqual(summary.response, { totalMs: 250, avgMs: 250, reported: 1 });
}

// The score is clamped and the verdict reads as prose.
{
  const over = summarizeChatAnalytics({ ...base, replies: [], evaluation: { score: 140, verdict: "in_progress" } });
  assert.deepEqual(over.success, { score: 100, verdict: "in progress" });
  const under = summarizeChatAnalytics({ ...base, replies: [], evaluation: { score: -10, verdict: "aborted" } });
  assert.deepEqual(under.success, { score: 0, verdict: "aborted" });
  const unscored = summarizeChatAnalytics({ ...base, replies: [], evaluation: { verdict: "aborted" } });
  assert.equal(unscored.success, null, "a verdict without a score is not a score");
  const half = summarizeChatAnalytics({ ...base, replies: [], evaluation: { score: 47.6 } });
  assert.deepEqual(half.success, { score: 48, verdict: null });
}

// The recorded duration wins; the row span is only the fallback.
{
  const recorded = summarizeChatAnalytics({ ...base, replies: [], recordedDurationSeconds: 34.04, durationMs: 999_000 });
  assert.equal(recorded.durationSeconds, 34.04);
  const fallback = summarizeChatAnalytics({ ...base, replies: [], durationMs: 12_500 });
  assert.equal(fallback.durationSeconds, 12.5);
}

// Idle progress: the session ends 30 minutes after its last message.
{
  const now = Date.parse("2026-11-17T12:00:00Z");
  const fresh = summarizeChatAnalytics({
    ...base,
    replies: [],
    updatedAt: "2026-11-17T12:00:00Z",
    nowMs: now,
  });
  assert.deepEqual(fresh.idle, { pct: 0, remainingMinutes: 30 });

  const halfSpent = summarizeChatAnalytics({
    ...base,
    replies: [],
    updatedAt: "2026-11-17T11:45:00Z",
    nowMs: now,
  });
  assert.deepEqual(halfSpent.idle, { pct: 50, remainingMinutes: 15 });

  const stale = summarizeChatAnalytics({
    ...base,
    replies: [],
    updatedAt: "2026-11-17T09:00:00Z",
    nowMs: now,
  });
  assert.deepEqual(stale.idle, { pct: 100, remainingMinutes: 0 });

  const unknown = summarizeChatAnalytics({ ...base, replies: [] });
  assert.deepEqual(unknown.idle, { pct: 0, remainingMinutes: null });
}

console.log("chat conversation analytics tests passed");
