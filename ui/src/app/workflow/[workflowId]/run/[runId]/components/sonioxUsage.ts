/**
 * Soniox bills by token, but `usage_info` only stores STT seconds and TTS
 * characters. This module converts those units into Soniox's billing split.
 *
 * Rates and ratios: https://soniox.com/pricing. The STT rates and the
 * 120 ms audio token match a real `stt-rt-v5` usage record. TTS has not been
 * checked against a usage record yet.
 *
 * Only STT input audio tokens are exact. Everything else is estimated from
 * Soniox's published per-hour averages, so `exact: false` parts must be shown
 * as estimates.
 *
 * No imports, so the logic can be type-checked and smoke-tested in isolation.
 */

const USD_PER_1M = {
    sttInputAudio: 2,
    sttOutputText: 4,
    ttsInputText: 4,
    ttsOutputAudio: 21.5,
} as const;

const AUDIO_TOKEN_MS = 120;
const STT_OUTPUT_TEXT_TOKENS_PER_HOUR = 15_000;
const TTS_INPUT_TOKENS_PER_CHAR = 0.3;
const TTS_CHARS_PER_HOUR = 50_000;
const TTS_AUDIO_TOKENS_PER_HOUR = 30_000;

const SECONDS_PER_HOUR = 3_600;
const TTS_AUDIO_TOKENS_PER_CHAR = TTS_AUDIO_TOKENS_PER_HOUR / TTS_CHARS_PER_HOUR;

export interface SpeechTokenPart {
    tokens: number;
    costUsd: number;
    label: 'audio' | 'text';
    exact: boolean;
}

export interface SpeechTokenSplit {
    input: SpeechTokenPart;
    output: SpeechTokenPart;
}

function costOf(tokens: number, usdPer1M: number): number {
    return (tokens / 1_000_000) * usdPer1M;
}

export function isSonioxService(name: string): boolean {
    return /soniox/i.test(name);
}

export function sonioxSttSplit(seconds: number): SpeechTokenSplit {
    const inputTokens = (seconds * 1000) / AUDIO_TOKEN_MS;
    const outputTokens = (seconds / SECONDS_PER_HOUR) * STT_OUTPUT_TEXT_TOKENS_PER_HOUR;
    return {
        input: {
            tokens: Math.floor(inputTokens),
            costUsd: costOf(inputTokens, USD_PER_1M.sttInputAudio),
            label: 'audio',
            exact: true,
        },
        output: {
            tokens: Math.round(outputTokens),
            costUsd: costOf(outputTokens, USD_PER_1M.sttOutputText),
            label: 'text',
            exact: false,
        },
    };
}

export function sonioxTtsSplit(characters: number): SpeechTokenSplit {
    const inputTokens = characters * TTS_INPUT_TOKENS_PER_CHAR;
    const outputTokens = characters * TTS_AUDIO_TOKENS_PER_CHAR;
    return {
        input: {
            tokens: Math.round(inputTokens),
            costUsd: costOf(inputTokens, USD_PER_1M.ttsInputText),
            label: 'text',
            exact: false,
        },
        output: {
            tokens: Math.round(outputTokens),
            costUsd: costOf(outputTokens, USD_PER_1M.ttsOutputAudio),
            label: 'audio',
            exact: false,
        },
    };
}
