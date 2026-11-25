import { DEFAULT_PREVIEW_TEXT } from "./constants";
import type { VoicePreviewCapabilities } from "./types";

/** "ta-IN", "ta_IN" or "TA" -> "ta"; empty, "auto" or "multi" -> "". */
export function toBaseLanguage(language: string | null | undefined): string {
    const base = (language ?? "").trim().replace("_", "-").split("-")[0].toLowerCase();
    return base === "auto" || base === "multi" ? "" : base;
}

/**
 * Default preview sentence in the voice's language. Samples come from the
 * backend (`api/services/voice_preview/sample_text.py`); English is the fallback.
 */
export function getDefaultPreviewText(
    capabilities: VoicePreviewCapabilities | null,
    language: string | null | undefined,
): string {
    const samples = capabilities?.sample_texts ?? {};
    const fallback = samples[capabilities?.default_sample_language ?? "en"] ?? DEFAULT_PREVIEW_TEXT;
    return samples[toBaseLanguage(language)] ?? fallback;
}
