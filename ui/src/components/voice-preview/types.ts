export type VoicePreviewServiceType = "tts" | "sts";

export type VoicePreviewScope = "global" | "organization";

export interface VoicePreviewCapability {
    supported: boolean;
    preview_provider?: string | null;
    reason?: string | null;
}

export interface VoicePreviewCapabilities {
    providers: Record<string, Record<string, VoicePreviewCapability>>;
    /** Default preview sentence per base language code, from the backend. */
    sample_texts?: Record<string, string>;
    default_sample_language?: string;
}

export interface VoicePreviewResult {
    provider: string;
    voice_id: string;
    model: string;
    service_type: string;
    scope: string;
    preview_url: string;
    content_type: string;
    byte_size: number;
    render_ms?: number | null;
    cached: boolean;
}
