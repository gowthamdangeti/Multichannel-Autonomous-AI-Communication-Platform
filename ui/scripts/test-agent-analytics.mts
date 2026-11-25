// Run via `npm run test:agent-analytics` from ui/ (Node 24+ strips TS types natively).

import assert from "node:assert/strict";

import { formatAverage, formatPercent, formatResponseTime, formatTokenCount, formatTotalDuration } from "../src/components/agent-view/agentAnalyticsFormat.ts";
import { formatHour, OTHER_OUTCOMES, toCacheRows, toOutcomeRows, toOutcomeSeries } from "../src/components/agent-view/agentAnalyticsTrends.ts";
import { toRadarRows, toUnmeasuredLabels } from "../src/components/agent-view/agentPerformance.ts";
import { ALL_STACKS, stackOptions, tokenUsageFigures } from "../src/components/agent-view/agentTokenUsage.ts";

const day = (date: string, prompt: number, cache: number, outcomes: Record<string, number> = {}) => ({
  date,
  conversations: 1,
  avg_duration_seconds: null,
  avg_response_ms: null,
  avg_resolution_score: null,
  cache_read_tokens: cache,
  prompt_tokens: prompt,
  outcomes,
});

assert.equal(formatTokenCount(950), "950");
assert.equal(formatTokenCount(54711), "54.7K");
assert.equal(formatTokenCount(2_500_000), "2.5M");
assert.equal(formatTotalDuration(45), "45s");
assert.equal(formatTotalDuration(5545), "1.5h");
assert.equal(formatResponseTime(null), "—");
assert.equal(formatResponseTime(250), "250ms");
assert.equal(formatResponseTime(4837), "4.8s");
assert.equal(formatPercent(1, 0), "—");
assert.equal(formatAverage(100, 0), "—");

assert.equal(formatHour(0), "12am");
assert.equal(formatHour(9), "9am");
assert.equal(formatHour(12), "12pm");
assert.equal(formatHour(23), "11pm");

// A day without prompt tokens has no rate rather than a misleading 0%.
assert.deepEqual(toCacheRows([day("a", 100, 25), day("b", 0, 0), day("c", 100, 0)]).map((r) => r.cacheRate), [25, null, 0]);

const counts = ["a", "b", "c", "d", "e"].map((name, index) => ({ name, count: 5 - index }));
assert.deepEqual(toOutcomeSeries(counts), ["a", "b", "c", "d", OTHER_OUTCOMES]);
assert.deepEqual(toOutcomeSeries(counts.slice(0, 2)), ["a", "b"]);
assert.deepEqual(toOutcomeSeries([]), []);

const series = ["a", OTHER_OUTCOMES];
assert.deepEqual(toOutcomeRows([day("d1", 0, 0, { a: 2, x: 1, y: 3 }), day("d2", 0, 0)], series), [
  { date: "d1", a: 2, other: 4 },
  { date: "d2", a: 0, other: 0 },
]);

const metrics = [
  { key: "speed", score: 25, sample: 258 },
  { key: "kb_recall", score: null, sample: 0 },
  { key: "tool_accuracy", score: 0, sample: 4 },
];
// A real 0 stays on the radar; only an axis with nothing to measure drops off.
assert.deepEqual(toRadarRows(metrics), [
  { label: "Speed", score: 25, sampleLabel: "258 responses" },
  { label: "Tool Accuracy", score: 0, sampleLabel: "4 tool calls" },
]);
assert.deepEqual(toUnmeasuredLabels(metrics), ["KB Recall"]);

// --- Token Usage Breakdown: model-stack selection -------------------------

const daily = (prompt: number) => ({ date: "2026-11-06", prompt_tokens: prompt, completion_tokens: 0, conversations: 1 });
const analytics = {
  summary: { total_tokens: 300, prompt_tokens: 250, completion_tokens: 50, sessions_with_usage: 3, turns: 12 },
  daily: [daily(250)],
  by_model: [
    { name: "Omni", total_tokens: 300, prompt_tokens: 250, completion_tokens: 50, sessions_with_usage: 3, turns: 12, daily: [daily(250)] },
    { name: "Retired", total_tokens: 0, prompt_tokens: 0, completion_tokens: 0, sessions_with_usage: 0, turns: 0, daily: [daily(0)] },
  ],
};

// A stack with no recorded tokens is not offered as a filter option.
assert.deepEqual(stackOptions(analytics), [{ name: "Omni", totalTokens: 300 }]);
assert.deepEqual(stackOptions(null), []);

const all = tokenUsageFigures(analytics, ALL_STACKS);
assert.deepEqual([all.total, all.prompt, all.completion, all.sessions, all.turns], [300, 250, 50, 3, 12]);
assert.equal(all.daily[0].prompt_tokens, 250);

const omni = tokenUsageFigures(analytics, "Omni");
assert.deepEqual([omni.total, omni.prompt, omni.completion, omni.sessions, omni.turns], [300, 250, 50, 3, 12]);

// A range change can drop the selected stack: fall back to the all-stacks figures.
const gone = tokenUsageFigures(analytics, "Removed stack");
assert.deepEqual([gone.total, gone.prompt, gone.daily[0].prompt_tokens], [300, 250, 250]);

// No analytics at all must not throw or produce NaN.
const empty = tokenUsageFigures(null, ALL_STACKS);
assert.deepEqual([empty.total, empty.prompt, empty.completion, empty.sessions, empty.turns], [0, 0, 0, 0, 0]);
assert.deepEqual(empty.daily, []);

console.log("agent analytics tests passed");
