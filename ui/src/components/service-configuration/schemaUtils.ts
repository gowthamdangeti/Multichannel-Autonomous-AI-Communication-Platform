import { buildProviderVoiceOptions } from "@/lib/voiceMetadata";

import { GENDER_OPTIONS } from "./constants";
import type { ProviderSchema, SchemaProperty, ServiceSegment } from "./types";

export function getProviderDisplayName(
    provider: string | undefined,
    providerSchema: ProviderSchema | undefined,
): string | undefined {
    if (!provider) return provider;
    return providerSchema?.title || provider;
}

/** "Provider / model" summary of a global service config, for override toggles. */
export function getGlobalSummary(
    config: Record<string, unknown> | null | undefined,
    providerSchema: ProviderSchema | undefined,
): string {
    if (!config) return "Not configured";
    const provider = config.provider as string | undefined;
    const model = config.model as string | undefined;
    if (!provider) return "Not configured";
    const providerLabel = getProviderDisplayName(provider, providerSchema);
    return model ? `${providerLabel} / ${model}` : providerLabel || provider;
}

/** Dropdown options for a field; model-specific options win when a model is chosen. */
export function getSchemaDropdownOptions(
    schema: SchemaProperty | undefined,
    modelValue?: string,
): string[] | undefined {
    if (schema?.model_options && modelValue && schema.model_options[modelValue]) {
        return schema.model_options[modelValue];
    }
    return schema?.enum || schema?.examples;
}

/**
 * A field's schema with any `$ref` resolved against the provider's `$defs`, and
 * an optional field's `anyOf: [{type}, null]` reduced to its real `type`.
 */
export function resolveFieldSchema(providerSchema: ProviderSchema, field: string): SchemaProperty | undefined {
    const schema = providerSchema.properties[field];
    if (schema?.$ref && providerSchema.$defs) {
        return providerSchema.$defs[schema.$ref.split("/").pop() || ""];
    }
    if (schema && !schema.type && schema.anyOf) {
        const type = schema.anyOf.find((option) => option.type && option.type !== "null")?.type;
        return type ? { ...schema, type } : schema;
    }
    return schema;
}

export function isVoiceField(service: ServiceSegment, field: string): boolean {
    return field === "voice" && (service === "tts" || service === "realtime");
}

export interface ServiceFieldLayout {
    /** Shown next to the provider picker. */
    firstField?: string;
    /** TTS / speech-to-speech: the language decides which voices are offered. */
    showLanguageBeforeVoice: boolean;
    hasVoiceField: boolean;
    remainingFields: string[];
}

/** Order a provider's fields: model first, language early, voice in its own row. */
export function getServiceFieldLayout(service: ServiceSegment, providerSchema: ProviderSchema | undefined): ServiceFieldLayout {
    // "gender" has its own Voice Gender picker, so it is not rendered as a plain field.
    const configFields = providerSchema
        ? Object.keys(providerSchema.properties).filter((f) => f !== "provider" && f !== "api_key" && f !== "gender")
        : [];
    const hasVoiceField = (service === "tts" || service === "realtime") && configFields.includes("voice");
    const nonVoiceFields = hasVoiceField ? configFields.filter((f) => f !== "voice") : configFields;
    const prioritized = nonVoiceFields.indexOf("model") > 0
        ? ["model", ...nonVoiceFields.filter((f) => f !== "model")]
        : nonVoiceFields;
    const rawRemaining = prioritized.slice(1);
    const ordered = rawRemaining.indexOf("language") > 0
        ? ["language", ...rawRemaining.filter((f) => f !== "language")]
        : rawRemaining;
    const showLanguageBeforeVoice = hasVoiceField && ordered.includes("language");
    return {
        firstField: prioritized[0],
        showLanguageBeforeVoice,
        hasVoiceField,
        remainingFields: showLanguageBeforeVoice ? ordered.filter((f) => f !== "language") : ordered,
    };
}

/**
 * Gender filters this provider's voices actually have (e.g. "Neutral" exists
 * only for OpenAI). Falls back to all options when the voice list is unknown.
 */
export function getAvailableGenderOptions(provider: string, providerSchema: ProviderSchema, modelValue?: string): string[] {
    const voiceIds = getSchemaDropdownOptions(resolveFieldSchema(providerSchema, "voice"), modelValue) || [];
    const present = new Set(
        buildProviderVoiceOptions(provider, voiceIds)
            .map((v) => v.gender?.toLowerCase())
            .filter((g): g is string => !!g),
    );
    return present.size > 0 ? GENDER_OPTIONS.filter((g) => present.has(g)) : GENDER_OPTIONS;
}
