/**
 * Real usage and cost, as billed by the provider for this run.
 *
 * `provider_usage` comes from `GET .../runs/{id}/usage`. When a row has billed
 * data, these numbers replace our estimates everywhere on the run page. Costs
 * stay as decimal text until display so no rounding creeps in.
 *
 * No imports, so the logic can be tested in isolation.
 */

export type SpeechUsageType = 'STT' | 'TTS';
export type ProviderUsageStatus = 'none' | 'pending' | 'billed' | 'unavailable';

export interface BilledService {
    service_type: string;
    provider: string | null;
    model: string | null;
    request_count: number;
    input_seconds: number;
    output_seconds: number;
    cost_usd: string;
    input_text_tokens: number;
    input_audio_tokens: number;
    output_text_tokens: number;
    output_audio_tokens: number;
    input_text_cost_usd: string;
    input_audio_cost_usd: string;
    output_text_cost_usd: string;
    output_audio_cost_usd: string;
}

export interface ProviderUsage {
    status: ProviderUsageStatus;
    services: BilledService[];
    client_reference_id?: string | null;
    awaiting_providers?: string[];
    unreported_llm_requests?: number;
}

export interface BilledTokenPart {
    tokens: number;
    costUsd: number;
    label: string;
    detail: string;
}

export type BilledLookup = (type: SpeechUsageType, model: string) => BilledService | undefined;

export type UsageSourceLabel =
    | 'Provider billed'
    | 'Provider reported'
    | 'Waiting for provider data'
    | 'Estimated'
    | 'No provider bill';

const REFERENCE_HEAD_CHARS = 9;
const REFERENCE_RUN_MARKER = 'run-';
const LOCAL_SERVICE = /ollama|neutts|indicf5|speaches/i;

export function findBilledService(
    usage: ProviderUsage | null | undefined,
    type: SpeechUsageType,
    model: string,
): BilledService | undefined {
    return usage?.services?.find(
        (service) => service.service_type === type.toLowerCase() && service.model === model,
    );
}

/** Billed cost for a `service|||model` usage key, or null when there is none. */
export function billedCostFor(
    usage: ProviderUsage | null | undefined,
    type: SpeechUsageType,
    usageKey: string,
): number | null {
    const model = usageKey.split('|||')[1] ?? usageKey;
    const service = findBilledService(usage, type, model);
    return service ? Number(service.cost_usd) : null;
}

function toTokenPart(
    audioTokens: number,
    textTokens: number,
    audioCost: string,
    textCost: string,
): BilledTokenPart {
    const mixed = audioTokens > 0 && textTokens > 0;
    return {
        tokens: audioTokens + textTokens,
        costUsd: Number(audioCost) + Number(textCost),
        label: mixed ? 'tokens' : audioTokens > 0 ? 'audio' : 'text',
        detail: `Billed by the provider: ${audioTokens} audio + ${textTokens} text tokens.`,
    };
}

export function toBilledInput(service: BilledService): BilledTokenPart {
    return toTokenPart(
        service.input_audio_tokens,
        service.input_text_tokens,
        service.input_audio_cost_usd,
        service.input_text_cost_usd,
    );
}

export function toBilledOutput(service: BilledService): BilledTokenPart {
    return toTokenPart(
        service.output_audio_tokens,
        service.output_text_tokens,
        service.output_audio_cost_usd,
        service.output_text_cost_usd,
    );
}

/** A note for LLM replies that ended before the provider reported usage. */
export function toUnreportedLlmNote(usage: ProviderUsage | null | undefined): string | null {
    const requests = usage?.unreported_llm_requests ?? 0;
    if (requests <= 0) return null;
    const label = requests === 1 ? '1 LLM reply' : `${requests} LLM replies`;
    return `${label} ended early, so the provider reported no usage for them. The provider may still bill them, so the LLM totals here can be lower than its invoice.`;
}

export function getUsageSourceLabel(input: {
    type: 'LLM' | 'STS' | SpeechUsageType;
    service: string;
    model: string;
    billed: boolean;
    awaitsBilling: boolean;
}): UsageSourceLabel {
    if (LOCAL_SERVICE.test(`${input.service} ${input.model}`)) return 'No provider bill';
    if (input.billed) return 'Provider billed';
    if (input.type === 'LLM' || input.type === 'STS') return 'Provider reported';
    return input.awaitsBilling ? 'Waiting for provider data' : 'Estimated';
}

/** Shortens the middle, so the run number stays readable. */
export function truncateClientReferenceId(referenceId: string): string {
    const runStart = referenceId.lastIndexOf(REFERENCE_RUN_MARKER);
    if (runStart <= REFERENCE_HEAD_CHARS) return referenceId;
    return `${referenceId.slice(0, REFERENCE_HEAD_CHARS)}…${referenceId.slice(runStart)}`;
}

export function isAwaitingBilling(usage: ProviderUsage | null | undefined, service: string): boolean {
    const name = service.toLowerCase();
    return (usage?.awaiting_providers ?? []).some((provider) => name.includes(provider));
}
