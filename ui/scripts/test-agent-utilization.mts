// Run via `npm run test:agent-utilization` from ui/ (Node 24+ strips TS types).

import assert from "node:assert/strict";

import {
  AGENT_UTILIZATION_OPTIONS,
  agentUtilizationOption,
  DEFAULT_AGENT_UTILIZATION,
} from "../src/constants/agentUtilization.ts";

// The three policies the backend accepts, in display order.
assert.deepEqual(
  AGENT_UTILIZATION_OPTIONS.map((option) => option.value),
  ["public", "private", "closed"],
);

// New agents default to organisation-wide visibility.
assert.equal(DEFAULT_AGENT_UTILIZATION, "public");

// Known values resolve to their own option...
for (const option of AGENT_UTILIZATION_OPTIONS) {
  assert.equal(agentUtilizationOption(option.value).value, option.value);
}

// ...and anything else (older payloads, null, undefined) falls back to public
// instead of rendering an empty card.
assert.equal(agentUtilizationOption(undefined).value, "public");
assert.equal(agentUtilizationOption(null).value, "public");
assert.equal(agentUtilizationOption("").value, "public");
assert.equal(agentUtilizationOption("shared").value, "public");

console.log("agent utilization tests passed");
