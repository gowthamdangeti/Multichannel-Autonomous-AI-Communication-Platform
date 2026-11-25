import type { ModelOverrides } from "@/types/workflow-configurations";

export type ServiceSegment = "llm" | "tts" | "stt" | "embeddings" | "realtime";

export const ALL_SERVICES: ServiceSegment[] = ["llm", "tts", "stt", "embeddings", "realtime"];

export interface SchemaProperty {
    type?: string;
    default?: string | number | boolean;
    enum?: string[];
    examples?: string[];
    model_options?: Record<string, string[]>;
    allow_custom_input?: boolean;
    $ref?: string;
    /** Optional fields (`X | None` in the backend) arrive as `anyOf: [{type: X}, {type: "null"}]`. */
    anyOf?: { type?: string }[];
    description?: string;
    format?: string;
    multiline?: boolean;
    docs_url?: string;
}

export interface ProviderSchema {
    title?: string;
    description?: string;
    provider_docs_url?: string;
    properties: Record<string, SchemaProperty>;
    required?: string[];
    $defs?: Record<string, SchemaProperty>;
    [key: string]: unknown;
}

/** Flat react-hook-form values keyed `${service}_${field}`. */
export interface FormValues {
    [key: string]: string | number | boolean;
}

export interface ServiceConfigurationDefaults {
    llm: Record<string, ProviderSchema>;
    tts: Record<string, ProviderSchema>;
    stt: Record<string, ProviderSchema>;
    embeddings: Record<string, ProviderSchema>;
    realtime?: Record<string, ProviderSchema>;
    default_providers: Partial<Record<ServiceSegment, string>>;
}

export type ServiceRecord<T> = Record<ServiceSegment, T>;
export type FormMode = "global" | "override";

export interface ServiceConfigurationFormProps {
    mode: FormMode;
    currentOverrides?: ModelOverrides;
    onSave: (configuration: Record<string, unknown>) => Promise<void>;
    onCancel?: () => void;
    /** Label for the submit button. Defaults to "Save Configuration". */
    submitLabel?: string;
    configurationDefaults?: ServiceConfigurationDefaults | null;
    initialConfig?: Record<string, unknown> | null;
    /**
     * When set, locks the realtime/pipeline mode to this value and hides the
     * in-form toggle. The v2 editor uses this to surface realtime
     * ("Speech to Speech") and pipeline (BYOK) as separate top-level tabs.
     * Leave undefined to keep the user-controllable toggle (legacy + overrides).
     */
    forceRealtime?: boolean;
    activeServiceSegment?: ServiceSegment;
    hideServiceTabs?: boolean;
    nextTab?: { label: string; onNavigate: () => void };
    /**
     * Show the voice preview generator under the TTS / speech-to-speech voice
     * picker. Enabled on the model-configuration surfaces only.
     */
    enableVoicePreview?: boolean;
    /** Admin model preset being edited; voice previews restore its saved key. */
    voicePreviewModelConfigurationId?: number;
}
