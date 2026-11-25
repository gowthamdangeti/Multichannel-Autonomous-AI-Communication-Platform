/**
 * Pure derivation for the run-detail "Token Usage Breakdown" table.
 *
 * Rows are grouped by the CASE that consumed the usage, and inside each case by
 * the service entry (model/voice) that produced it — so a run shows, per case,
 * which LLM/TTS/STT/STS was used, its input/output/cached tokens and cost.
 *
 * Cases are derived from the literal key prefixes the backend writes into
 * `usage_info.llm`:
 *   - `<processor>|||<model>`   (conversation pipeline, live metrics aggregator)
 *   - `QAAnalysis|||<model>`    (api/tasks/run_integrations.py)
 *   - `ReportGeneration|||<model>` (api/tasks/generate_run_report.py)
 *
 * Cases the product exposes but the backend does NOT persist usage for are
 * declared in CASE_DEFINITIONS with `recorded: false` and rendered as such —
 * never as fabricated zeros.
 *
 * Type-only imports, so the logic can be type-checked and smoke-tested in isolation.
 */

import type { LLMPricing, STTPricing, TTSPricing } from '@/lib/modelPricing';

import type { BilledLookup, BilledService } from './providerUsage';

export type UsageType = 'LLM' | 'TTS' | 'STT' | 'STS';

export type UsageCase =
    | 'Conversation'
    | 'Conversation Title'
    | 'Conversation Completeness'
    | 'QA Results'
    | 'Report Generation';

export const CASE_ORDER: readonly UsageCase[] = [
    'Conversation',
    'Conversation Title',
    'Conversation Completeness',
    'QA Results',
    'Report Generation',
];

export interface CaseDefinition {
    case: UsageCase;
    /** False when the pipeline runs the work but never records its usage. */
    recorded: boolean;
    note: string;
}

export const CASE_DEFINITIONS: readonly CaseDefinition[] = [
    {
        case: 'Conversation',
        recorded: true,
        note: 'Live pipeline usage: agent LLM, TTS synthesis and STT transcription, keyed by processor and model.',
    },
    {
        case: 'Conversation Title',
        recorded: true,
        note: 'Recorded only when the title LLM call succeeds; deterministic fallback titles create no usage event.',
    },
    {
        case: 'Conversation Completeness',
        recorded: true,
        note: 'Recorded as Completeness|||<model>; each re-evaluation adds its own entry (Completeness_Reeval, Completeness_Reeval2, ...).',
    },
    {
        case: 'QA Results',
        recorded: true,
        note: 'Recorded as QAAnalysis|||<model> and aggregated by model across QA nodes.',
    },
    {
        case: 'Report Generation',
        recorded: true,
        note: 'Recorded as ReportGeneration|||<model>; each regeneration adds its own entry (ReportGeneration_Regen, ...).',
    },
];

export const STS_NOTE =
    'Speech-to-speech (realtime) usage is not stored in a separate bucket; realtime pipelines report into the same LLM/TTS/STT entries.';

export interface PricingFns {
    llm: (model: string) => LLMPricing;
    tts: (service: string) => TTSPricing;
    stt: (service: string) => STTPricing;
}

export type IssueSeverity = 'error' | 'warn' | 'info';

export interface UsageIssue {
    severity: IssueSeverity;
    code: string;
    detail: string;
}

export interface UsageEntry {
    id: string;
    key: string;
    case: UsageCase;
    service: string;
    model: string;
    type: UsageType;
    promptTokens: number;
    completionTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    /**
     * True when the source actually reported cache fields (even as 0).
     * False means the caller never captured cache usage, so the UI shows
     * "Not recorded" instead of a misleading 0 / "Inactive".
     */
    cacheRecorded: boolean;
    totalUnits: number;
    unitLabel: string;
    costUsd: number;
    /** False when no rule has a rate, so costUsd is not a real 0. */
    priced: boolean;
    /** The provider's own record; when set, the cost above comes from it. */
    billed?: BilledService;
    notes: string[];
}

export interface CaseTotals {
    promptTokens: number;
    completionTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    totalTokens: number;
    ttsChars: number;
    sttSeconds: number;
    costUsd: number;
    unpricedEntries: number;
}

export interface CaseGroup {
    case: UsageCase;
    recorded: boolean;
    note: string;
    entries: UsageEntry[];
    totals: CaseTotals;
}

export interface TokenBreakdown {
    groups: CaseGroup[];
    totals: CaseTotals;
    issues: UsageIssue[];
}

export interface UsageInfoLike {
    llm?: Record<string, unknown> | null;
    tts?: Record<string, unknown> | null;
    stt?: Record<string, unknown> | null;
    call_duration_seconds?: number | null;
}

export type QaAnnotations = Record<string, unknown> | null | undefined;

export interface QaSummary {
    nodes: number;
    avgScore: number | null;
    tags: number;
    errors: number;
}

const TYPE_RANK: Record<UsageType, number> = { LLM: 0, STS: 1, TTS: 2, STT: 3 };

// ============================================================================
// Numeric + key hygiene
// ============================================================================

/** Parses to a finite, non-negative number; anything else collapses to 0. */
function finite(value: unknown): { value: number; bad: boolean } {
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) return { value: 0, bad: true };
        return { value: Math.max(0, value), bad: false };
    }
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return { value: 0, bad: true };
        return { value: Math.max(0, parsed), bad: false };
    }
    return { value: 0, bad: value !== undefined && value !== null };
}

// ============================================================================
// Canonical (usage_events) + legacy (usage_info) merge
// ============================================================================

const COMPLETENESS_CASE = 'conversation_completeness';
const LEGACY_COMPLETENESS_KEY = /^(completeness|conversation_completeness)/i;

function hasTokens(entry: Record<string, unknown>): boolean {
    return (
        finite(entry.total_tokens).value > 0 ||
        finite(entry.input_tokens).value > 0 ||
        finite(entry.output_tokens).value > 0
    );
}

/**
 * usage_events stores cache columns as NOT NULL DEFAULT 0, so a 0 there can't
 * tell "no cache hit" from "never captured". A positive value is real; for a
 * 0 we defer to the legacy usage_info entry under the same key, which holds
 * null/absent when the caller never captured cache usage.
 */
function cacheField(canonicalValue: unknown, legacyValue: unknown): unknown {
    if (finite(canonicalValue).value > 0) return canonicalValue;
    return legacyValue === undefined ? null : legacyValue;
}

function llmValue(entry: Record<string, unknown>, legacy?: unknown) {
    const prior = (legacy && typeof legacy === 'object' ? legacy : {}) as Record<string, unknown>;
    return {
        prompt_tokens: entry.input_tokens ?? 0,
        completion_tokens: entry.output_tokens ?? 0,
        total_tokens: entry.total_tokens ?? 0,
        cache_read_input_tokens: cacheField(entry.cache_read_tokens, prior.cache_read_input_tokens),
        cache_creation_input_tokens: cacheField(entry.cache_write_tokens, prior.cache_creation_input_tokens),
    };
}

/**
 * Overlays canonical usage events onto the legacy `usage_info` map.
 *
 * Completeness gets one key per evaluation, named exactly like the backend's
 * legacy mirror (Completeness, Completeness_Reeval, Completeness_Reeval2, ...).
 * Previously every attempt mapped to one `conversation_completeness` key, so
 * re-evaluations overwrote each other and duplicated the legacy rows.
 */
export function mergeCanonicalUsage(
    legacy: UsageInfoLike | null | undefined,
    canonicalEntries: Record<string, unknown>[],
): UsageInfoLike {
    const base = legacy ?? {};
    if (canonicalEntries.length === 0) return base;
    const merged = {
        llm: { ...(base.llm ?? {}) },
        tts: { ...(base.tts ?? {}) },
        stt: { ...(base.stt ?? {}) },
        call_duration_seconds: base.call_duration_seconds,
    } as { llm: Record<string, unknown>; tts: Record<string, unknown>; stt: Record<string, unknown>; call_duration_seconds?: number | null };

    // Completeness: canonical attempts with real usage, in attempt order.
    // Zero-token events (failed / no-LLM evaluations) are not rows.
    const completeness = canonicalEntries
        .filter((e) => String(e.case ?? '') === COMPLETENESS_CASE)
        .filter((e) => ['llm', 'sts'].includes(String(e.service_type ?? 'llm')) && hasTokens(e))
        .sort((a, b) => Number(a.attempt ?? 1) - Number(b.attempt ?? 1));
    const legacyCompletenessKeys = Object.keys(merged.llm).filter((k) =>
        LEGACY_COMPLETENESS_KEY.test(k.split('|||')[0] ?? ''),
    );
    // Use whichever source knows more evaluations: older evaluations may exist
    // only in usage_info (before usage events), newer ones in both.
    if (completeness.length > 0 && completeness.length >= legacyCompletenessKeys.length) {
        legacyCompletenessKeys.forEach((k) => delete merged.llm[k]);
        completeness.forEach((entry, index) => {
            const suffix = index === 0 ? '' : `_Reeval${index === 1 ? '' : index}`;
            const model = String(entry.model ?? entry.provider ?? 'unknown');
            const key = `Completeness${suffix}|||${model}`;
            merged.llm[key] = llmValue(entry, (base.llm ?? {})[key]);
        });
    }

    for (const entry of canonicalEntries) {
        const caseName = String(entry.case ?? 'conversation');
        if (caseName === COMPLETENESS_CASE) continue; // handled above
        const serviceType = String(entry.service_type ?? 'llm');
        const model = String(entry.model ?? entry.provider ?? 'unknown');
        const attempt = Number(entry.attempt ?? 1);
        // For report_generation, each attempt (regeneration) gets a unique key
        // so the Token Usage Breakdown shows a separate row per attempt.
        const attemptSuffix = caseName === 'report_generation' && attempt > 1
            ? `_Regen${attempt > 2 ? attempt - 1 : ''}`
            : '';
        const serviceKey = caseName === 'report_generation'
            ? `ReportGeneration${attemptSuffix}`
            : caseName;
        const usageKey = `${serviceKey}|||${model}`;
        if (serviceType === 'llm' || serviceType === 'sts') {
            // On the first canonical attempt for a case, clear any legacy keys for
            // that case (e.g. ReportGeneration|||<model> written by old task code).
            // Skip cleanup for attempt > 1 so sibling regen keys survive.
            if (attempt <= 1) {
                Object.keys(merged.llm).forEach((k) => {
                    const [kService] = k.split('|||');
                    const normK = kService.toLowerCase().replace(/_/g, '');
                    const normCase = caseName.toLowerCase().replace(/_/g, '');
                    if (normK === normCase && !kService.toLowerCase().includes('_regen')) {
                        delete merged.llm[k];
                    }
                });
            }
            merged.llm[usageKey] = llmValue(entry, (base.llm ?? {})[usageKey]);
        } else if (serviceType === 'tts') {
            merged.tts[usageKey] = entry.output_units ?? 0;
        } else {
            merged.stt[usageKey] = entry.output_units ?? 0;
        }
    }
    return merged;
}

/** `QAAnalysis|||gpt-4.1` -> { service: 'QAAnalysis', model: 'gpt-4.1' } */
export function splitUsageKey(key: string): {
    service: string;
    model: string;
    wellFormed: boolean;
} {
    const parts = String(key ?? '').split('|||');
    const service = (parts[0] ?? '').trim();
    const model = (parts[1] ?? '').trim();
    return {
        service: service || String(key ?? ''),
        model: model || 'default',
        wellFormed: parts.length >= 2 && service !== '' && model !== '',
    };
}

/** Strips pipecat's `LLMService#3` style suffixes so keys group cleanly. */
export function normalizeService(service: string): string {
    const cleaned = service.replace(/Service#\d+/gi, '').replace(/#\d+/g, '').trim();
    return cleaned || service;
}

/**
 * Maps a usage key to its case using the literal prefixes the backend writes.
 * A loose substring match would mislabel unrelated processor keys.
 */
export function classifyCase(service: string): UsageCase {
    if (/^reportgeneration|^report_generation/i.test(service)) return 'Report Generation';
    if (/^qaanalysis|^qa_results/i.test(service)) return 'QA Results';
    if (/^conversation_title/i.test(service)) return 'Conversation Title';
    if (/^conversation_completeness|^completeness/i.test(service)) return 'Conversation Completeness';
    return 'Conversation';
}

export function classifyType(
    service: string,
    model: string,
    bucket: 'llm' | 'tts' | 'stt',
): UsageType {
    if (/realtime|speech[-_ ]?to[-_ ]?speech|\bsts\b/i.test(`${service} ${model}`)) return 'STS';
    return bucket === 'llm' ? 'LLM' : bucket === 'tts' ? 'TTS' : 'STT';
}

export function summarizeQaResults(annotations: QaAnnotations): QaSummary {
    const qa = (annotations ?? {}) as Record<string, unknown>;
    const summary: QaSummary = { nodes: 0, avgScore: null, tags: 0, errors: 0 };
    const scores: number[] = [];
    const tags = new Set<string>();

    for (const [key, raw] of Object.entries(qa)) {
        if (!key.startsWith('qa_') || !raw || typeof raw !== 'object') continue;
        const entry = raw as Record<string, unknown>;
        summary.nodes += 1;
        if (typeof entry.error === 'string' && entry.error) summary.errors += 1;
        const score = finite(entry.score);
        if (!score.bad && entry.score !== null && entry.score !== undefined) scores.push(score.value);
        if (Array.isArray(entry.tags)) {
            for (const tag of entry.tags) {
                if (typeof tag === 'string' && tag) tags.add(tag);
            }
        }
    }
    summary.tags = tags.size;
    summary.avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
    return summary;
}

// ============================================================================
// Breakdown
// ============================================================================

function emptyTotals(): CaseTotals {
    return {
        promptTokens: 0,
        completionTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalTokens: 0,
        ttsChars: 0,
        sttSeconds: 0,
        costUsd: 0,
        unpricedEntries: 0,
    };
}

interface Cursor {
    case: UsageCase;
    service: string;
    model: string;
    type: UsageType;
    notes: string[];
}

function resolveCursor(
    key: string,
    bucket: 'llm' | 'tts' | 'stt',
    issues: UsageIssue[],
): Cursor {
    const { service, model, wellFormed } = splitUsageKey(key);
    const normalized = normalizeService(service);
    const notes: string[] = [];
    if (!wellFormed) {
        notes.push('malformed key');
        issues.push({
            severity: 'warn',
            code: 'malformed_key',
            detail: `Key "${key}" is not shaped as <service>|||<model>; grouped as-is.`,
        });
    }
    return {
        case: classifyCase(service),
        service: normalized,
        model,
        type: classifyType(normalized, model, bucket),
        notes,
    };
}

export function buildTokenBreakdown(
    usageInfo: UsageInfoLike | null | undefined,
    pricing: PricingFns,
    findBilled?: BilledLookup,
): TokenBreakdown {
    const byCase = new Map<UsageCase, UsageEntry[]>();
    const issues: UsageIssue[] = [];

    const llmUsage = (usageInfo?.llm ?? {}) as Record<string, unknown>;
    const ttsUsage = (usageInfo?.tts ?? {}) as Record<string, unknown>;
    const sttUsage = (usageInfo?.stt ?? {}) as Record<string, unknown>;

    for (const [key, raw] of Object.entries(llmUsage)) {
        const cursor = resolveCursor(key, 'llm', issues);
        const entry = (raw ?? {}) as Record<string, unknown>;

        const prompt = finite(entry.prompt_tokens);
        const completion = finite(entry.completion_tokens);
        const cacheRead = finite(entry.cache_read_input_tokens);
        const cacheCreation = finite(entry.cache_creation_input_tokens);
        const cacheRecorded =
            (entry.cache_read_input_tokens !== undefined && entry.cache_read_input_tokens !== null) ||
            (entry.cache_creation_input_tokens !== undefined && entry.cache_creation_input_tokens !== null);
        const declaredTotal = finite(entry.total_tokens);
        const notes = [...cursor.notes];
        if (entry.estimated === true) {
            notes.push('estimated: provider returned no token usage');
        }

        if (prompt.bad || completion.bad || declaredTotal.bad) {
            notes.push('non-finite value');
            issues.push({
                severity: 'warn',
                code: 'non_finite',
                detail: `Key "${key}" contained a non-finite token value; treated as 0.`,
            });
        }

        const computedTotal = prompt.value + completion.value;
        let totalTokens = declaredTotal.value;
        if (totalTokens <= 0 && computedTotal > 0) {
            totalTokens = computedTotal;
            notes.push('total derived from in/out');
        }
        if (declaredTotal.value > 0 && declaredTotal.value < computedTotal) {
            totalTokens = computedTotal;
            notes.push('declared total < in/out, using in/out');
            issues.push({
                severity: 'warn',
                code: 'inconsistent_total',
                detail: `Key "${key}" declared total_tokens below prompt+completion; recomputed.`,
            });
        }

        const rate = pricing.llm(cursor.model);
        const costUsd =
            (prompt.value / 1_000_000) * rate.inputPer1M +
            (completion.value / 1_000_000) * rate.outputPer1M;

        const entries = byCase.get(cursor.case) ?? [];
        // Completeness is not a singleton: every re-evaluation is a separate
        // LLM call with its own cost, so each key stays its own row.
        const isSingletonCase = cursor.case === 'Conversation Title';

        const existingIdx = entries.findIndex(
            (e) =>
                e.type === cursor.type &&
                (isSingletonCase || e.model.toLowerCase() === cursor.model.toLowerCase()),
        );

        const newEntry: UsageEntry = {
            id: `${cursor.case}:${cursor.type}:${key}`,
            key,
            case: cursor.case,
            service: cursor.service,
            model: cursor.model,
            type: cursor.type,
            promptTokens: prompt.value,
            completionTokens: completion.value,
            cacheReadTokens: cacheRead.value,
            cacheCreationTokens: cacheCreation.value,
            cacheRecorded,
            totalUnits: totalTokens,
            unitLabel: 'tokens',
            costUsd,
            priced: rate.priced,
            notes,
        };

        if (existingIdx >= 0 && isSingletonCase) {
            entries[existingIdx] = newEntry;
        } else {
            entries.push(newEntry);
        }
        byCase.set(cursor.case, entries);
    }

    for (const [key, raw] of Object.entries(ttsUsage)) {
        const cursor = resolveCursor(key, 'tts', issues);
        const chars = finite(raw);
        const notes = [...cursor.notes];
        if (chars.bad) {
            notes.push('non-finite value');
            issues.push({
                severity: 'warn',
                code: 'non_finite',
                detail: `TTS key "${key}" contained a non-finite character count; treated as 0.`,
            });
        }
        const rate = pricing.tts(cursor.service || cursor.model);
        const billed = findBilled?.('TTS', cursor.model);

        const entries = byCase.get(cursor.case) ?? [];
        entries.push({
            id: `${cursor.case}:${cursor.type}:${key}`,
            key,
            case: cursor.case,
            service: cursor.service,
            model: cursor.model,
            type: cursor.type,
            promptTokens: 0,
            completionTokens: 0,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            cacheRecorded: false,
            totalUnits: chars.value,
            unitLabel: 'chars',
            costUsd: billed ? Number(billed.cost_usd) : (chars.value / 1_000_000) * rate.per1MChars,
            priced: rate.priced || Boolean(billed),
            billed,
            notes,
        });
        byCase.set(cursor.case, entries);
    }

    for (const [key, raw] of Object.entries(sttUsage)) {
        const cursor = resolveCursor(key, 'stt', issues);
        const seconds = finite(raw);
        const notes = [...cursor.notes];
        if (seconds.bad) {
            notes.push('non-finite value');
            issues.push({
                severity: 'warn',
                code: 'non_finite',
                detail: `STT key "${key}" contained a non-finite duration; treated as 0.`,
            });
        }
        const rate = pricing.stt(cursor.service || cursor.model);
        const billed = findBilled?.('STT', cursor.model);

        const entries = byCase.get(cursor.case) ?? [];
        entries.push({
            id: `${cursor.case}:${cursor.type}:${key}`,
            key,
            case: cursor.case,
            service: cursor.service,
            model: cursor.model,
            type: cursor.type,
            promptTokens: 0,
            completionTokens: 0,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            cacheRecorded: false,
            totalUnits: billed ? billed.input_seconds : seconds.value,
            unitLabel: 'sec',
            costUsd: billed ? Number(billed.cost_usd) : (seconds.value / 60) * rate.perMinute,
            priced: rate.priced || Boolean(billed),
            billed,
            notes,
        });
        byCase.set(cursor.case, entries);
    }

    const groups: CaseGroup[] = [];
    const totals = emptyTotals();

    for (const definition of CASE_DEFINITIONS) {
        const entries = byCase.get(definition.case) ?? [];
        entries.sort((a, b) => TYPE_RANK[a.type] - TYPE_RANK[b.type] || b.costUsd - a.costUsd);

        const caseTotals = emptyTotals();
        for (const entry of entries) {
            caseTotals.promptTokens += entry.promptTokens;
            caseTotals.completionTokens += entry.completionTokens;
            caseTotals.cacheReadTokens += entry.cacheReadTokens;
            caseTotals.cacheCreationTokens += entry.cacheCreationTokens;
            if (entry.type === 'LLM' || entry.type === 'STS') {
                caseTotals.totalTokens += entry.totalUnits;
            }
            if (entry.type === 'TTS') caseTotals.ttsChars += entry.totalUnits;
            if (entry.type === 'STT') caseTotals.sttSeconds += entry.totalUnits;
            caseTotals.costUsd += entry.costUsd;
            if (!entry.priced) caseTotals.unpricedEntries += 1;
        }

        if (!definition.recorded && entries.length > 0) {
            issues.push({
                severity: 'info',
                code: 'case_unexpected_usage',
                detail: `${definition.case} was expected to be unrecorded but ${entries.length} usage entr${entries.length === 1 ? 'y' : 'ies'} were found.`,
            });
        }
        if (definition.recorded && entries.length === 0) {
            issues.push({
                severity: 'info',
                code: 'case_without_usage',
                detail: `${definition.case} has no recorded usage for this run.`,
            });
        }

        groups.push({
            case: definition.case,
            recorded: definition.recorded,
            note: definition.note,
            entries,
            totals: caseTotals,
        });

        totals.promptTokens += caseTotals.promptTokens;
        totals.completionTokens += caseTotals.completionTokens;
        totals.cacheReadTokens += caseTotals.cacheReadTokens;
        totals.cacheCreationTokens += caseTotals.cacheCreationTokens;
        totals.totalTokens += caseTotals.totalTokens;
        totals.ttsChars += caseTotals.ttsChars;
        totals.sttSeconds += caseTotals.sttSeconds;
        totals.costUsd += caseTotals.costUsd;
        totals.unpricedEntries += caseTotals.unpricedEntries;
    }

    return { groups, totals, issues };
}

// ============================================================================
// Validation
// ============================================================================

export interface ValidationInputs {
    /** `cost_info.autonomous_ai_os_token_usage` — Σ LLM total_tokens + ceil(tts_chars/4). */
    autonomous_ai_osTokenUsage?: number | null;
}

export function validateBreakdown(
    breakdown: TokenBreakdown,
    inputs: ValidationInputs = {},
): UsageIssue[] {
    const issues: UsageIssue[] = [...breakdown.issues];

    const autonomous_ai_os = finite(inputs.autonomous_ai_osTokenUsage).value;
    if (autonomous_ai_os > 0) {
        const ttsEquivalent = breakdown.groups
            .flatMap((group) => group.entries)
            .filter((entry) => entry.type === 'TTS' || entry.type === 'STS')
            .reduce((a, entry) => (entry.unitLabel === 'chars' ? a + Math.ceil(entry.totalUnits / 4) : a), 0);
        const expectedLlmTokens = autonomous_ai_os - ttsEquivalent;
        const delta = Math.abs(expectedLlmTokens - breakdown.totals.totalTokens);
        if (delta > 0.01) {
            issues.push({
                severity: 'warn',
                code: 'autonomous_ai_os_mismatch',
                detail:
                    `Table sums to ${breakdown.totals.totalTokens.toLocaleString()} LLM tokens but ` +
                    `cost_info implies ${expectedLlmTokens.toLocaleString()} ` +
                    `(Δ ${delta.toLocaleString()}).`,
            });
        }
    }

    if (breakdown.totals.costUsd > 0) {
        const claimed = breakdown.groups.reduce((a, group) => a + group.totals.costUsd, 0);
        if (Math.abs(claimed - breakdown.totals.costUsd) > 1e-9) {
            issues.push({
                severity: 'error',
                code: 'case_totals_drift',
                detail: 'Case subtotals do not add up to the run total.',
            });
        }
    }

    return issues;
}

export const TTS_CHARS_PER_TOKEN = 4;
