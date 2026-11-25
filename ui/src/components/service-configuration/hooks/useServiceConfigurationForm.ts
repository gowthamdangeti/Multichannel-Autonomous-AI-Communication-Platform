"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";

import { getDefaultConfigurationsApiV1UserConfigurationsDefaultsGet } from "@/client/sdk.gen";
import { useUserConfig } from "@/context/UserConfigContext";
import logger from "@/lib/logger";
import type { ModelOverrides } from "@/types/workflow-configurations";

import { buildInitialFormState, buildServiceConfig, emptyServiceRecord, hasAnyApiKey } from "../formState";
import type {
    FormValues,
    ProviderSchema,
    ServiceConfigurationDefaults,
    ServiceConfigurationFormProps,
    ServiceRecord,
    ServiceSegment,
} from "../types";

const OVERRIDABLE: (keyof ModelOverrides)[] = ["llm", "tts", "stt", "realtime"];

/** Preview sentences saved with the configuration (`voice_preview_texts`). */
function readSavedPreviewTexts(config: Record<string, unknown> | null): Record<string, string | null> {
    const saved = config?.voice_preview_texts;
    if (!saved || typeof saved !== "object") return {};
    return Object.fromEntries(
        Object.entries(saved as Record<string, unknown>).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0,
        ),
    );
}

/** Typed preview sentences to save; untouched services (null) are left out. */
function toSavedPreviewTexts(texts: Record<string, string | null>): Record<string, string> | undefined {
    const entries = Object.entries(texts).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0,
    );
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/** Saved config to edit: the base config, with workflow overrides laid on top. */
function useConfigSource({ mode, currentOverrides, initialConfig }: ServiceConfigurationFormProps) {
    const { userConfig } = useUserConfig();
    const configSource = useMemo(() => {
        const base = (initialConfig ?? userConfig) as Record<string, unknown> | null;
        if (mode === "global" || !currentOverrides) return base;
        const merged = { ...base };
        for (const svc of OVERRIDABLE) {
            const overrideVal = currentOverrides[svc];
            if (overrideVal && typeof overrideVal === "object") {
                merged[svc] = { ...(base?.[svc] as Record<string, unknown> | undefined), ...overrideVal };
            }
        }
        if (currentOverrides.is_realtime !== undefined) merged.is_realtime = currentOverrides.is_realtime;
        return merged;
    }, [mode, userConfig, currentOverrides, initialConfig]);
    return { configSource, userConfig: userConfig as Record<string, unknown> | null };
}

/** All state and actions of the service configuration form. */
export function useServiceConfigurationForm(props: ServiceConfigurationFormProps) {
    const { mode, currentOverrides, onSave, configurationDefaults, forceRealtime } = props;
    const form = useForm<FormValues>();
    const { reset, getValues, setValue, watch } = form;
    const { configSource, userConfig } = useConfigSource(props);

    const [apiError, setApiError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [isRealtime, setIsRealtime] = useState(forceRealtime ?? false);
    const [schemas, setSchemas] = useState<ServiceRecord<Record<string, ProviderSchema>>>(emptyServiceRecord(() => ({})));
    const [providers, setProviders] = useState<ServiceRecord<string>>(emptyServiceRecord(() => ""));
    const [apiKeys, setApiKeys] = useState<ServiceRecord<string[]>>(emptyServiceRecord(() => [""]));
    const [customInput, setCustomInput] = useState<Record<string, boolean>>({});
    const [genderFilters, setGenderFilters] = useState<Record<string, string>>({ tts: "all", realtime: "all" });
    // Voice preview sentence per service; lives here so it survives the preview
    // panel unmounting when the user switches form sections, and is saved with
    // the configuration so it shows again on reopen. null = default sample.
    const [previewTexts, setPreviewTexts] = useState<Record<string, string | null>>({});
    const [enabledOverrides, setEnabledOverrides] = useState<Record<string, boolean>>({
        llm: false, tts: false, stt: false, realtime: false,
    });

    useEffect(() => {
        const load = async () => {
            let defaults = configurationDefaults;
            if (!defaults) {
                const response = await getDefaultConfigurationsApiV1UserConfigurationsDefaultsGet();
                if (!response.data) {
                    logger.error("Failed to fetch configurations");
                    return;
                }
                defaults = response.data as ServiceConfigurationDefaults;
            }
            const state = buildInitialFormState(defaults, configSource, mode, currentOverrides);
            setSchemas(state.schemas);
            // Restore the realtime toggle unless the parent locks the mode.
            if (forceRealtime === undefined && state.isRealtime) setIsRealtime(true);
            if (mode === "override") {
                setEnabledOverrides({
                    llm: !!currentOverrides?.llm,
                    tts: !!currentOverrides?.tts,
                    stt: !!currentOverrides?.stt,
                    realtime: !!currentOverrides?.realtime,
                });
            }
            reset(state.defaultValues);
            setGenderFilters(state.genderFilters);
            setApiKeys(state.apiKeys);
            setProviders(state.providers);
            setCustomInput(state.customInput);
            if (mode === "global") setPreviewTexts(readSavedPreviewTexts(configSource));
        };
        void load();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when the source changes
    }, [reset, configSource, configurationDefaults]);

    // Reset the voice when the TTS model changes and the voice is not offered for it.
    const ttsModel = watch("tts_model");
    useEffect(() => {
        const modelOptions = schemas.tts?.[providers.tts]?.properties?.voice?.model_options;
        if (!modelOptions || !ttsModel) return;
        const validVoices = modelOptions[ttsModel as string];
        const currentVoice = getValues("tts_voice") as string;
        if (validVoices && currentVoice && !validVoices.includes(currentVoice) && !customInput.tts_voice) {
            setValue("tts_voice", validVoices[0], { shouldDirty: true });
        }
    }, [ttsModel, providers.tts, setValue, getValues, schemas, customInput.tts_voice]);

    const changeProvider = (service: ServiceSegment, providerName: string) => {
        if (!providerName) return;
        const preserved: FormValues = {};
        for (const [key, value] of Object.entries(getValues())) {
            if (!key.startsWith(`${service}_`)) preserved[key] = value;
        }
        for (const [field, schema] of Object.entries(schemas[service]?.[providerName]?.properties ?? {})) {
            if (field !== "provider" && schema.default !== undefined) preserved[`${service}_${field}`] = schema.default;
        }
        preserved[`${service}_provider`] = providerName;
        reset(preserved);
        setProviders((prev) => ({ ...prev, [service]: providerName }));
        setApiKeys((prev) => ({ ...prev, [service]: [""] }));
        setGenderFilters((prev) => ({ ...prev, [service]: "all" }));
        setCustomInput((prev) =>
            Object.fromEntries(Object.entries(prev).filter(([key]) => !key.startsWith(`${service}_`))),
        );
    };

    const configFor = useCallback(
        (service: ServiceSegment, data: FormValues) =>
            buildServiceConfig({
                service,
                data,
                provider: providers[service],
                apiKeys: apiKeys[service],
                mode,
                genderFilter: genderFilters.tts,
            }),
        [providers, apiKeys, mode, genderFilters.tts],
    );

    const buildPayload = (data: FormValues): Record<string, unknown> => {
        if (mode === "override") {
            const overrides: Record<string, unknown> = {};
            for (const svc of (isRealtime ? ["realtime", "llm"] : ["llm", "tts", "stt"]) as ServiceSegment[]) {
                if (enabledOverrides[svc]) overrides[svc] = configFor(svc, data);
            }
            // Include is_realtime only if it differs from the global config.
            if (isRealtime !== !!userConfig?.is_realtime) overrides.is_realtime = isRealtime;
            return { model_overrides: Object.keys(overrides).length > 0 ? overrides : undefined };
        }
        const payload: Record<string, unknown> = {
            llm: configFor("llm", data),
            tts: configFor("tts", data),
            stt: configFor("stt", data),
            is_realtime: isRealtime,
        };
        if (providers.realtime) payload.realtime = configFor("realtime", data);
        if (hasAnyApiKey(apiKeys.embeddings)) payload.embeddings = configFor("embeddings", data);
        const voicePreviewTexts = toSavedPreviewTexts(previewTexts);
        if (voicePreviewTexts) payload.voice_preview_texts = voicePreviewTexts;
        return payload;
    };

    const submit = form.handleSubmit(async (data) => {
        setApiError(null);
        setIsSaving(true);
        try {
            await onSave(buildPayload(data));
            reset(data);
        } catch (error: unknown) {
            setApiError(error instanceof Error ? error.message : "An unknown error occurred");
        } finally {
            setIsSaving(false);
        }
    });

    return {
        form,
        submit,
        apiError,
        isSaving,
        isRealtime,
        setIsRealtime,
        enabledOverrides,
        editor: {
            mode,
            userConfig,
            schemas,
            providers,
            apiKeys,
            setApiKeys: (service: ServiceSegment, keys: string[]) => setApiKeys((prev) => ({ ...prev, [service]: keys })),
            customInput,
            setCustomInputFlag: (fieldKey: string, value: boolean) => setCustomInput((prev) => ({ ...prev, [fieldKey]: value })),
            genderFilters,
            setGenderFilter: (service: ServiceSegment, gender: string) => setGenderFilters((prev) => ({ ...prev, [service]: gender })),
            enabledOverrides,
            setOverrideEnabled: (service: ServiceSegment, enabled: boolean) => setEnabledOverrides((prev) => ({ ...prev, [service]: enabled })),
            changeProvider,
            configFor,
            previewTexts,
            setPreviewText: (service: ServiceSegment, text: string | null) => setPreviewTexts((prev) => ({ ...prev, [service]: text })),
            enableVoicePreview: props.enableVoicePreview ?? false,
            voicePreviewModelConfigurationId: props.voicePreviewModelConfigurationId,
        },
    };
}

export type ServiceConfigEditor = ReturnType<typeof useServiceConfigurationForm>["editor"];
