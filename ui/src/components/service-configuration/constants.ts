import type { FormMode, ServiceSegment } from "./types";

export interface ServiceTab {
    key: ServiceSegment;
    label: string;
}

const STANDARD_TABS: ServiceTab[] = [
    { key: "stt", label: "Speech to Text (STT)" },
    { key: "llm", label: "LLM" },
    { key: "tts", label: "Voice" },
    { key: "embeddings", label: "Embedding" },
];

const REALTIME_TABS: ServiceTab[] = [
    { key: "realtime", label: "Realtime Model" },
    { key: "llm", label: "LLM" },
    { key: "embeddings", label: "Embedding" },
];

const OVERRIDE_STANDARD_TABS: ServiceTab[] = [
    { key: "stt", label: "Speech to Text (STT)" },
    { key: "llm", label: "LLM" },
    { key: "tts", label: "Voice" },
];

const OVERRIDE_REALTIME_TABS: ServiceTab[] = [
    { key: "realtime", label: "Realtime Model" },
    { key: "llm", label: "LLM" },
];

export function getVisibleTabs(mode: FormMode, isRealtime: boolean): ServiceTab[] {
    if (mode === "override") return isRealtime ? OVERRIDE_REALTIME_TABS : OVERRIDE_STANDARD_TABS;
    return isRealtime ? REALTIME_TABS : STANDARD_TABS;
}

/** Display names for Sarvam voices. */
export const VOICE_DISPLAY_NAMES: Record<string, string> = {
    anushka: "Anushka (Female)",
    manisha: "Manisha (Female)",
    vidya: "Vidya (Female)",
    arya: "Arya (Female)",
    abhilash: "Abhilash (Male)",
    karun: "Karun (Male)",
    hitesh: "Hitesh (Male)",
};

export const GENDER_OPTIONS = ["female", "male", "neutral"];
