import type { ModelOverrides } from "@/types/workflow-configurations";

import { GENDER_OPTIONS } from "./constants";
import { getSchemaDropdownOptions, resolveFieldSchema } from "./schemaUtils";
import {
    ALL_SERVICES,
    type FormMode,
    type FormValues,
    type ProviderSchema,
    type ServiceConfigurationDefaults,
    type ServiceRecord,
    type ServiceSegment,
} from "./types";

type SchemaMap = Record<string, ProviderSchema>;
type ConfigBlob = Record<string, unknown> | null | undefined;

export const emptyServiceRecord = <T,>(value: () => T): ServiceRecord<T> => ({
    llm: value(), tts: value(), stt: value(), embeddings: value(), realtime: value(),
});

export interface InitialFormState {
    schemas: ServiceRecord<SchemaMap>;
    defaultValues: FormValues;
    providers: ServiceRecord<string>;
    apiKeys: ServiceRecord<string[]>;
    genderFilters: Record<string, string>;
    customInput: Record<string, boolean>;
    /** Saved config was realtime (only applied when the mode is not forced). */
    isRealtime: boolean;
}

function pickDefaultProvider(preferred: string | undefined, schemaMap: SchemaMap): string {
    if (preferred && schemaMap[preferred]) return preferred;
    return Object.keys(schemaMap)[0] || "";
}

function loadApiKeys(service: ServiceSegment, value: unknown, mode: FormMode, overrides?: ModelOverrides): string[] {
    if (mode === "override") {
        // In override mode, only load API keys from the override itself.
        const overrideVal = overrides?.[service as keyof ModelOverrides];
        const overrideKey = overrideVal && typeof overrideVal === "object"
            ? (overrideVal as Record<string, unknown>).api_key
            : undefined;
        if (!overrideKey) return [""];
        return Array.isArray(overrideKey) ? (overrideKey as string[]) : [overrideKey as string];
    }
    if (Array.isArray(value)) return value.length > 0 ? (value as string[]) : [""];
    return value ? [value as string] : [""];
}

/** Everything the form needs on load, derived from provider schemas + saved config. */
export function buildInitialFormState(
    defaults: ServiceConfigurationDefaults,
    configSource: ConfigBlob,
    mode: FormMode,
    overrides?: ModelOverrides,
): InitialFormState {
    const schemas: ServiceRecord<SchemaMap> = {
        llm: defaults.llm,
        tts: defaults.tts,
        stt: defaults.stt,
        embeddings: defaults.embeddings,
        realtime: (defaults.realtime || {}) as SchemaMap,
    };
    const providers: ServiceRecord<string> = {
        llm: pickDefaultProvider(defaults.default_providers?.llm, defaults.llm),
        tts: pickDefaultProvider(defaults.default_providers?.tts, defaults.tts),
        stt: pickDefaultProvider(defaults.default_providers?.stt, defaults.stt),
        embeddings: pickDefaultProvider(defaults.default_providers?.embeddings, defaults.embeddings),
        realtime: Object.keys(schemas.realtime)[0] || "",
    };
    const defaultValues: FormValues = {};
    const apiKeys = emptyServiceRecord(() => [""]);
    const genders: Partial<ServiceRecord<string>> = {};
    const savedFor = (service: ServiceSegment) => configSource?.[service] as Record<string, unknown> | undefined;

    for (const service of ALL_SERVICES) {
        const saved = savedFor(service);
        if (saved?.provider) {
            for (const [field, value] of Object.entries(saved)) {
                if (field === "api_key") {
                    apiKeys[service] = loadApiKeys(service, value, mode, overrides);
                } else if (field === "gender") {
                    // Restored into the Voice Gender picker, not the form values.
                    if (typeof value === "string" && GENDER_OPTIONS.includes(value)) genders[service] = value;
                } else if (field !== "provider") {
                    defaultValues[`${service}_${field}`] = value as string | number | boolean;
                }
            }
            providers[service] = saved.provider as string;
        }
        const properties = schemas[service]?.[providers[service]]?.properties;
        for (const [field, schema] of Object.entries(properties ?? {})) {
            const key = `${service}_${field}`;
            if (field === "provider" || schema.default === undefined) continue;
            // Saved configs keep their values; only fill fields the save lacks (never the key).
            if (saved?.provider && (field === "api_key" || key in defaultValues)) continue;
            defaultValues[key] = schema.default;
        }
    }

    return {
        schemas,
        defaultValues,
        providers,
        apiKeys,
        genderFilters: { tts: genders.tts || "all", realtime: genders.realtime || "all" },
        customInput: detectCustomInputs(schemas, providers, savedFor),
        isRealtime: Boolean(configSource?.is_realtime),
    };
}

/** Saved values that are not among a field's options were typed in by hand. */
function detectCustomInputs(
    schemas: ServiceRecord<SchemaMap>,
    providers: ServiceRecord<string>,
    savedFor: (service: ServiceSegment) => Record<string, unknown> | undefined,
): Record<string, boolean> {
    const custom: Record<string, boolean> = {};
    for (const service of ALL_SERVICES) {
        const providerSchema = schemas[service]?.[providers[service]];
        if (!providerSchema) continue;
        const saved = savedFor(service);
        for (const field of Object.keys(providerSchema.properties)) {
            const schema = resolveFieldSchema(providerSchema, field);
            if (!schema?.allow_custom_input) continue;
            const savedValue = saved?.[field] as string | undefined;
            const options = getSchemaDropdownOptions(schema, saved?.model as string | undefined);
            if (savedValue && options && !options.includes(savedValue)) custom[`${service}_${field}`] = true;
        }
    }
    return custom;
}

interface BuildServiceConfigArgs {
    service: ServiceSegment;
    data: FormValues;
    provider: string;
    apiKeys: string[];
    mode: FormMode;
    genderFilter?: string;
}

/** One service's config as the backend expects it, from the flat form values. */
export function buildServiceConfig({ service, data, provider, apiKeys, mode, genderFilter }: BuildServiceConfigArgs) {
    const config: Record<string, string | number | string[]> = { provider };
    const keys = apiKeys.map((k) => k.trim()).filter((k) => k.length > 0);
    if (keys.length > 0) config.api_key = mode === "override" ? keys[0] : keys;
    for (const [property, value] of Object.entries(data)) {
        if (!property.startsWith(`${service}_`)) continue;
        const field = property.slice(service.length + 1);
        if (field === "api_key" || field === "provider" || field === "gender") continue;
        // An unset optional field (e.g. temperature) is left out so the backend default applies.
        if (value === undefined || value === null || (typeof value === "number" && Number.isNaN(value))) continue;
        config[field] = value as string | number;
    }
    // Save the chosen Voice Gender with the TTS config so it survives a reload
    // (custom voice IDs carry no gender of their own).
    if (service === "tts" && genderFilter && genderFilter !== "all") config.gender = genderFilter;
    return config;
}

export function hasAnyApiKey(keys: string[]): boolean {
    return keys.some((k) => k.trim().length > 0);
}
