// Tests for the language fallback rules used by LanguagePicker.
// Run via `npm run test:language-fallback` from ui/ (Node 24+ strips TS types).

import assert from "node:assert/strict";

import { closestSupported, languagesDiffer } from "../src/lib/languageFallback.ts";

type Lang = { code: string; base_language: string; is_auto_detect?: boolean; name: string };
const lang = (code: string, auto = false): Lang => ({
    code,
    base_language: code.split(/[-_]/)[0].toLowerCase(),
    is_auto_detect: auto,
    name: code,
});
// The helper only reads code / base_language / is_auto_detect.
const catalog = (codes: string[], def: string | null, auto?: string) =>
    ({
        default: def,
        languages: [...(auto ? [lang(auto, true)] : []), ...codes.map((c) => lang(c))],
    }) as unknown as Parameters<typeof closestSupported>[0];

const cases: Array<[string, () => void]> = [
    ["same language in another region, preferring the default", () => {
        const c = catalog(["en-AU", "en-US", "hi-IN"], "en-US");
        assert.equal(closestSupported(c, "en-IN")?.code, "en-US");
    }],
    ["regional code maps to the plain language", () => {
        assert.equal(closestSupported(catalog(["en", "hi"], "en"), "hi-IN")?.code, "hi");
    }],
    ["unrelated language falls back to the default", () => {
        assert.equal(closestSupported(catalog(["en"], "en"), "ta-IN")?.code, "en");
    }],
    ["auto-detect maps to the model's auto-detect code", () => {
        assert.equal(closestSupported(catalog(["en"], "en", "multi"), "auto")?.code, "multi");
    }],
    ["auto-detect without auto support falls back to the default", () => {
        assert.equal(closestSupported(catalog(["en", "hi"], "en"), "auto")?.code, "en");
    }],
    ["no default: first selectable language", () => {
        assert.equal(closestSupported(catalog(["fr", "de"], null), "ja")?.code, "fr");
    }],
    ["empty catalog gives null", () => {
        assert.equal(closestSupported(catalog([], null), "en"), null);
    }],
    ["mismatch: different languages", () => assert.equal(languagesDiffer("hi-IN", "en-US"), true)],
    ["mismatch: regions of one language are fine", () => assert.equal(languagesDiffer("en-IN", "en"), false)],
    ["mismatch: auto-detect never warns", () => assert.equal(languagesDiffer("multi", "hi"), false)],
    ["mismatch: empty never warns", () => assert.equal(languagesDiffer("", "hi"), false)],
];

let failed = 0;
for (const [name, run] of cases) {
    try {
        run();
        console.log(`ok   ${name}`);
    } catch (err) {
        failed += 1;
        console.error(`FAIL ${name}\n     ${(err as Error).message}`);
    }
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed ? 1 : 0);
