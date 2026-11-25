/**
 * Constants for voice preview generation.
 *
 * Per-language default samples come from the backend with the preview
 * capabilities (see `sampleText.ts`). This English sentence is only the
 * fallback until they load; it matches the backend's English sample.
 */
export const DEFAULT_PREVIEW_TEXT =
    "Hello, this is a preview of my voice. I can help you schedule " +
    "appointments, answer questions, and follow up with your customers.";

export const MAX_PREVIEW_CHARS = 500;

export const VOICE_PREVIEW_PATH = "/api/v1/voice-previews";
export const VOICE_PREVIEW_CAPABILITIES_PATH = "/api/v1/voice-previews/capabilities";
