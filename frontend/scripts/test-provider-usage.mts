// Billed usage on the run page, using the real records from run 237.
// Run via `npm run test:provider-usage` from ui/ (Node 24+ strips TS types).

import assert from "node:assert/strict";

import type { BilledService, ProviderUsage } from "../src/app/workflow/[workflowId]/run/[runId]/components/providerUsage.ts";
import {
    billedCostFor,
    findBilledService,
    getUsageSourceLabel,
    isAwaitingBilling,
    toBilledInput,
    toBilledOutput,
    toUnreportedLlmNote,
    truncateClientReferenceId,
} from "../src/app/workflow/[workflowId]/run/[runId]/components/providerUsage.ts";
import type { PricingFns } from "../src/app/workflow/[workflowId]/run/[runId]/components/usageBreakdown.ts";
import { buildTokenBreakdown, mergeCanonicalUsage } from "../src/app/workflow/[workflowId]/run/[runId]/components/usageBreakdown.ts";
import { formatExactUsd } from "../src/lib/modelPricing.ts";

const stt: BilledService = {
    service_type: "stt", provider: "soniox", model: "stt-rt-v5", request_count: 1,
    input_seconds: 102.678, output_seconds: 0, cost_usd: "0.0023280000",
    input_text_tokens: 8, input_audio_tokens: 866, output_text_tokens: 141, output_audio_tokens: 0,
    input_text_cost_usd: "0.0000320000", input_audio_cost_usd: "0.0017320000",
    output_text_cost_usd: "0.0005640000", output_audio_cost_usd: "0.0000000000",
};
const tts: BilledService = {
    service_type: "tts", provider: "soniox", model: "tts-rt-v2", request_count: 1,
    input_seconds: 0, output_seconds: 5.888, cost_usd: "0.0011710000",
    input_text_tokens: 24, input_audio_tokens: 0, output_text_tokens: 0, output_audio_tokens: 50,
    input_text_cost_usd: "0.0000960000", input_audio_cost_usd: "0.0000000000",
    output_text_cost_usd: "0.0000000000", output_audio_cost_usd: "0.0010750000",
};
const usage: ProviderUsage = { status: "billed", services: [stt, tts] };
const usageInfo = {
    tts: { "SonioxTTSService#1|||tts-rt-v2": 66 },
    stt: { "SonioxSTTService#1|||stt-rt-v5": 97 },
    call_duration_seconds: 97,
};
const pricing: PricingFns = {
    llm: () => ({ inputPer1M: 0, outputPer1M: 0, priced: false }),
    tts: () => ({ per1MChars: 14.1, priced: true }),
    stt: () => ({ perMinute: 0.002, priced: true }),
};
const speechEntries = (breakdown: ReturnType<typeof buildTokenBreakdown>) => breakdown.groups.flatMap((group) => group.entries);

// The table total equals Soniox's bill, not our estimate.
const billed = buildTokenBreakdown(usageInfo, pricing, (type, model) => findBilledService(usage, type, model));
assert.equal(formatExactUsd(billed.totals.costUsd), "$0.003499");
const sttEntry = speechEntries(billed).find((entry) => entry.type === "STT");
assert.equal(sttEntry?.costUsd, 0.002328);
assert.equal(sttEntry?.totalUnits, 102.678);

// No billed data: the old estimate is unchanged.
const estimated = buildTokenBreakdown(usageInfo, pricing);
assert.equal(formatExactUsd(estimated.totals.costUsd), "$0.004164");
assert.equal(speechEntries(estimated)[0]?.billed, undefined);

// Billed data pays for a row that has no pricing rule.
const unpriced: PricingFns = { ...pricing, stt: () => ({ perMinute: 0, priced: false }) };
const noRule = buildTokenBreakdown(usageInfo, unpriced, (type, model) => findBilledService(usage, type, model));
assert.equal(noRule.totals.unpricedEntries, 0);

// A different model must not borrow another model's bill.
assert.equal(findBilledService(usage, "STT", "stt-rt-v4"), undefined);
assert.equal(findBilledService(usage, "TTS", "stt-rt-v5"), undefined);
assert.equal(billedCostFor(usage, "TTS", "SonioxTTSService#1|||tts-rt-v2"), 0.001171);
assert.equal(billedCostFor(null, "TTS", "SonioxTTSService#1|||tts-rt-v2"), null);

// Token cells match the Soniox log line for line.
assert.deepEqual(
    { tokens: toBilledInput(stt).tokens, label: toBilledInput(stt).label },
    { tokens: 874, label: "tokens" },
);
assert.equal(toBilledOutput(stt).tokens, 141);
assert.equal(toBilledOutput(stt).label, "text");
assert.equal(formatExactUsd(toBilledOutput(tts).costUsd), "$0.001075");
assert.equal(formatExactUsd(toBilledInput(stt).costUsd), "$0.001764");

// Billed events never come through the merge, so usage can't double.
const merged = mergeCanonicalUsage(usageInfo, []);
assert.deepEqual(merged, usageInfo);

// Labels say where each number came from.
const label = (type: "LLM" | "STT" | "TTS", service: string, model: string, isBilled = false, awaitsBilling = false) =>
    getUsageSourceLabel({ type, service, model, billed: isBilled, awaitsBilling });
assert.equal(label("STT", "SonioxSTTService#1", "stt-rt-v5", true), "Provider billed");
assert.equal(label("LLM", "OpenAILLMService#1", "DeepSeek-V4.1-Flash"), "Provider reported");
assert.equal(label("STT", "SonioxSTTService#1", "stt-rt-v5", false, true), "Waiting for provider data");
assert.equal(label("TTS", "CartesiaTTSService#1", "sonic-3"), "Estimated");
assert.equal(label("LLM", "OllamaLLMService#1", "llama3"), "No provider bill");

// Waiting is shown per provider, never for a provider that can't report.
const waiting: ProviderUsage = { status: "pending", services: [], awaiting_providers: ["soniox"] };
assert.equal(isAwaitingBilling(waiting, "SonioxSTTService#1"), true);
assert.equal(isAwaitingBilling(waiting, "SarvamTTSService#0"), false);
assert.equal(isAwaitingBilling(null, "SonioxSTTService#1"), false);

// Replies cut off mid-stream are stated, never shown as a fake zero.
assert.equal(toUnreportedLlmNote(usage), null);
assert.match(toUnreportedLlmNote({ ...usage, unreported_llm_requests: 11 }) ?? "", /^11 LLM replies ended early/);
assert.match(toUnreportedLlmNote({ ...usage, unreported_llm_requests: 1 }) ?? "", /^1 LLM reply ended early/);

// The shortened ID keeps the run number, and short IDs stay whole.
assert.equal(truncateClientReferenceId("convozent-local-run-240"), "convozent…run-240");
assert.equal(truncateClientReferenceId("convozent-production-run-12345"), "convozent…run-12345");
assert.equal(truncateClientReferenceId("short-id"), "short-id");

console.log("provider usage tests passed");
