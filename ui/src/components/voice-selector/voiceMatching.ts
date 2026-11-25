import type { VoiceInfo } from "@/client/types.gen";
import { resolveVoiceGender } from "@/lib/voiceMetadata";

/** Base language codes of Indian languages ("en-IN" is English, not one of them). */
const INDIAN_LANGUAGE_CODES = ["hi", "ta", "te", "kn", "bn", "gu", "mr", "ml", "pa", "or", "od", "as", "ur", "sa"];

/** Providers whose voices speak every language they support. */
const MULTILINGUAL_PROVIDERS = ["elevenlabs", "openai", "cartesia", "autonomous_ai_os", "camb", "minimax", "soniox", "rime"];

export const GENDER_FILTER_VALUES = ["female", "male", "neutral"];

export function isIndianLanguageCode(code?: string | null): boolean {
    if (!code) return false;
    return INDIAN_LANGUAGE_CODES.includes(code.toLowerCase().split("-")[0]);
}

export function isMultilingualProvider(provider?: string | null): boolean {
    if (!provider) return false;
    const lower = provider.toLowerCase();
    return lower.includes("realtime") || MULTILINGUAL_PROVIDERS.includes(lower);
}

/**
 * Whether `voice` can speak `languageCode`. Same rules as
 * voice_matches_language() in api/services/configuration/provider_catalog.py.
 */
export function isVoiceMatchingLanguage(voice: VoiceInfo, languageCode: string, provider: string): boolean {
    const target = languageCode.toLowerCase();
    const providerLower = provider.toLowerCase();

    // Multilingual providers/voices, and voices with no known language, match anything.
    if (isMultilingualProvider(providerLower) || !voice.language || voice.language.toLowerCase() === "multi") {
        return true;
    }
    const targetBase = target.split("-")[0];
    if (["multi", "auto", "unknown"].includes(targetBase)) return true;

    // Sarvam voices speak every Indian language. Other providers' Indian voices
    // (IndicF5, Azure, Google) are tied to one language, so they fall through.
    if (providerLower === "sarvam" && isIndianLanguageCode(target)) return true;

    return voice.language.toLowerCase().split("-")[0] === targetBase;
}

/** Lower-cased gender of a voice, inferred from its id/name when not provided. */
export function getVoiceGender(voice: Pick<VoiceInfo, "voice_id" | "name" | "gender"> | undefined, voiceId: string, provider: string): string | undefined {
    return (voice?.gender || resolveVoiceGender(voiceId, voice?.name, provider))?.toLowerCase();
}

/** "Female" / "Male" / "" — the label shown next to a voice name. */
export function formatVoiceGender(voice: VoiceInfo, provider: string): string {
    const raw = voice.gender || resolveVoiceGender(voice.voice_id, voice.name, provider);
    if (!raw) return "";
    return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

/** Fill in a missing gender so filtering and labels work for every voice. */
export function withResolvedGender(voices: VoiceInfo[], provider: string): VoiceInfo[] {
    return voices.map((v) => ({
        ...v,
        gender: v.gender || resolveVoiceGender(v.voice_id, v.name, provider),
    }));
}
