// Run via `npm run test:chat-agent-format` from ui/ (Node 24+ strips TS types natively).
//
// Shared formatting for the chat-agent and chat-conversation surfaces. The model
// configuration must be the one the agent actually replies with: the selected
// preset, else the default preset the runtime falls back to, else nothing when
// the organization has no configurations at all. A span the data does not carry
// is a dash, never a zero.

import assert from "node:assert/strict";

import { DASH, fmtDuration, modelConfigNameOf } from "../src/components/chat-agent/chatAgentFormat.ts";

// The options endpoint returns the default preset first.
const presets = [
  { id: 1, name: "Kira" },
  { id: 6, name: "English Deepseek" },
];

assert.equal(modelConfigNameOf({ model_config_ref: { platform_model_configuration_id: 6 } }, presets), "English Deepseek");
assert.equal(modelConfigNameOf({ model_config_ref: { platform_model_configuration_id: "6" } }, presets), "English Deepseek");

// Nothing stored: the agent still runs on the default preset.
assert.equal(modelConfigNameOf({ model_config_ref: {} }, presets), "Kira");
assert.equal(modelConfigNameOf({}, presets), "Kira");
assert.equal(modelConfigNameOf({ model_config_ref: null }, presets), "Kira");

// Deleted or deactivated preset: the runtime falls back to the default.
assert.equal(modelConfigNameOf({ model_config_ref: { platform_model_configuration_id: 99 } }, presets), "Kira");

// No configurations exist: there is nothing to show.
assert.equal(modelConfigNameOf({ model_config_ref: {} }, []), null);

assert.equal(fmtDuration(0), "0s");
assert.equal(fmtDuration(12_400), "12s");
assert.equal(fmtDuration(270_000), "4m 30s");
assert.equal(fmtDuration(3_900_000), "1h 5m");
assert.equal(fmtDuration(null), DASH);

console.log("chat agent format: ok");
