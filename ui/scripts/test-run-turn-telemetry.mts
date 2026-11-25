// Run via `npm run test:run-turn-telemetry` from ui/ (Node 24+ strips TS types natively).

import assert from "node:assert/strict";

import { extractTurnTelemetry } from "../src/app/workflow/[workflowId]/run/[runId]/components/runTurnTelemetry.ts";

const event = (type: string, turn: number | undefined, payload: Record<string, unknown> = {}) => ({ type, turn, payload });

// Out-of-order events land on the turn they recorded, not the order they arrived.
const turns = extractTurnTelemetry([
  event("rtf-ttfb-metric", 2, { ttfb_seconds: 1 }),
  event("rtf-ttfb-metric", 2, { ttfb_seconds: 2 }),
  event("rtf-latency-measured", 2, { latency_seconds: 5.5 }),
  event("rtf-pipeline-error", 2),
  event("rtf-function-call-end", 2),
  event("rtf-bot-text", 0),
  event("rtf-ttfb-metric", undefined, { ttfb_seconds: 9 }),
]);

assert.deepEqual(turns, [
  {
    turn: "T0",
    turnIndex: 0,
    apiRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    successRate: null,
    llmLatencyMs: null,
    responseLatencyMs: null,
    toolCalls: 0,
  },
  {
    turn: "T2",
    turnIndex: 2,
    apiRequests: 3,
    successfulRequests: 2,
    failedRequests: 1,
    successRate: 67,
    llmLatencyMs: 1500,
    responseLatencyMs: 5500,
    toolCalls: 1,
  },
]);

// A turn with no measurement stays empty: nothing is carried over from the last one.
const gap = extractTurnTelemetry([event("rtf-latency-measured", 1, { latency_seconds: 2 }), event("rtf-bot-text", 2)]);
assert.equal(gap[1].responseLatencyMs, null);

assert.deepEqual(extractTurnTelemetry([]), []);

console.log("run turn telemetry tests passed");
