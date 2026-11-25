// Tests for the run page pricing rules.
// Run via `npm run test:model-pricing` from ui/ (Node 24+ strips TS types).

import assert from "node:assert/strict";

import {
    formatItemCost,
    formatTotalCost,
    PRICE_UNAVAILABLE,
    resolveLLMPricing,
    resolveSTTPricing,
    resolveTTSPricing,
} from "../src/lib/modelPricing.ts";

type Rule = NonNullable<Parameters<typeof resolveLLMPricing>[1]>[number];
const rule = (service_type: Rule["service_type"], pattern: string, rates: Partial<Rule> = {}): Rule => ({
    service_type,
    label: pattern,
    pattern,
    input_rate: 0,
    output_rate: 0,
    unit_rate: 0,
    sort_order: 0,
    ...rates,
});

const llmRules = [
    rule("llm", "gpt-4o", { input_rate: 2.5, output_rate: 10 }),
    rule("llm", "^gpt-4($|-[0-9])", { input_rate: 30, output_rate: 60 }),
];
const format = (n: number) => `$${n.toFixed(2)}`;

const cases: Array<[string, () => void]> = [
    ["a matching rule gives its rates", () => {
        assert.deepEqual(resolveLLMPricing("GPT-4o", llmRules), { inputPer1M: 2.5, outputPer1M: 10, priced: true });
    }],
    ["gpt-4.1 no longer matches the GPT-4 rule", () => {
        assert.equal(resolveLLMPricing("gpt-4.1", llmRules).priced, false);
    }],
    ["legacy GPT-4 names still match", () => {
        assert.equal(resolveLLMPricing("gpt-4", llmRules).inputPer1M, 30);
        assert.equal(resolveLLMPricing("gpt-4-0613", llmRules).inputPer1M, 30);
    }],
    ["an unknown model is unpriced, never a default rate", () => {
        assert.deepEqual(resolveLLMPricing("new-model", llmRules), { inputPer1M: 0, outputPer1M: 0, priced: false });
    }],
    ["no rules at all (managed org) prices nothing", () => {
        assert.equal(resolveLLMPricing("gpt-4o", []).priced, false);
        assert.equal(resolveTTSPricing("CartesiaTTSService", undefined).priced, false);
        assert.equal(resolveSTTPricing("DeepgramSTTService", []).priced, false);
    }],
    ["TTS and STT rules only match their own service", () => {
        const rules = [rule("tts", "deepgram", { unit_rate: 15 }), rule("stt", "deepgram", { unit_rate: 0.0043 })];
        assert.equal(resolveTTSPricing("DeepgramTTSService", rules).per1MChars, 15);
        assert.equal(resolveSTTPricing("DeepgramSTTService", rules).perMinute, 0.0043);
    }],
    ["an invalid regex is skipped", () => {
        const rules = [rule("llm", "("), rule("llm", "gpt", { input_rate: 1 })];
        assert.equal(resolveLLMPricing("gpt-x", rules).inputPer1M, 1);
    }],
    ["a free priced row shows its cost, an unpriced row does not", () => {
        assert.equal(formatItemCost(format, 0, true), "$0.00");
        assert.equal(formatItemCost(format, 0, false), PRICE_UNAVAILABLE);
    }],
    ["totals flag unpriced rows", () => {
        assert.equal(formatTotalCost(format, 1.5, 0), "$1.50");
        assert.equal(formatTotalCost(format, 1.5, 2), "$1.50 + unpriced");
        assert.equal(formatTotalCost(format, 0, 2), PRICE_UNAVAILABLE);
    }],
];

for (const [name, run] of cases) {
    run();
    console.log(`ok - ${name}`);
}
console.log(`${cases.length} passed`);
