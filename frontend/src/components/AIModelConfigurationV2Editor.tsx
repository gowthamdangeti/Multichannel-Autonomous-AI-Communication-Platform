"use client";

import { useEffect, useMemo, useState } from "react";

import type { OrganizationAiModelConfigurationV2 } from "@/client/types.gen";
import {
    type ProviderSchema,
    type ServiceConfigurationDefaults,
    ServiceConfigurationForm,
    type ServiceSegment,
} from "@/components/ServiceConfigurationForm";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type ModelMode = "realtime" | "autonomous_ai_os" | "byok";

interface Autonomous AI OSDefaults {
    voices: string[];
    allow_custom_input?: boolean;
    speeds: number[];
    languages: string[];
    defaults: {
        voice: string;
        speed: number;
        language: string;
    };
}

export interface ModelConfigurationDefaultsV2 {
    autonomous_ai_os: Autonomous AI OSDefaults;
    byok: {
        pipeline: ServiceConfigurationDefaults;
        realtime: {
            realtime: Record<string, ProviderSchema>;
            llm: Record<string, ProviderSchema>;
            embeddings: Record<string, ProviderSchema>;
            default_providers: ServiceConfigurationDefaults["default_providers"];
        };
    };
}

interface AIModelConfigurationV2EditorProps {
    defaults: ModelConfigurationDefaultsV2;
    configuration?: OrganizationAiModelConfigurationV2 | Record<string, unknown> | null;
    effectiveConfiguration?: Record<string, unknown> | null;
    onSave: (configuration: OrganizationAiModelConfigurationV2) => Promise<void>;
    onCancel?: () => void;
    submitLabel?: string;
    forcedMode?: "realtime" | "byok";
    hideTabList?: boolean;
    activeServiceSegment?: ServiceSegment;
    hideServiceTabs?: boolean;
    extraActions?: React.ReactNode;
    nextTab?: { label: string; onNavigate: () => void };
    /** Show the voice preview generator in the TTS / speech-to-speech tabs. */
    enableVoicePreview?: boolean;
    /** Admin model preset being edited; voice previews restore its saved key. */
    voicePreviewModelConfigurationId?: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function isAutonomous AI OSEffectiveConfig(config: Record<string, unknown> | null | undefined): boolean {
    if (!config || config.is_realtime) return false;
    const llm = asRecord(config.llm);
    const tts = asRecord(config.tts);
    const stt = asRecord(config.stt);
    return llm?.provider === "autonomous_ai_os" && tts?.provider === "autonomous_ai_os" && stt?.provider === "autonomous_ai_os";
}

function byokDefaults(defaults: ModelConfigurationDefaultsV2): ServiceConfigurationDefaults {
    return {
        llm: defaults.byok.pipeline.llm,
        tts: defaults.byok.pipeline.tts,
        stt: defaults.byok.pipeline.stt,
        embeddings: defaults.byok.pipeline.embeddings,
        realtime: defaults.byok.realtime.realtime,
        default_providers: defaults.byok.pipeline.default_providers,
    };
}

function byokConfigToLegacyShape(config: Record<string, unknown> | null): Record<string, unknown> | null {
    if (!config || config.mode !== "byok") return null;
    const byok = asRecord(config.byok);
    if (!byok) return null;
    // Preview sentences saved with the configuration, shown again on reopen.
    const voicePreviewTexts = asRecord(config.voice_preview_texts) ?? undefined;

    if (byok.mode === "realtime") {
        const realtime = asRecord(byok.realtime);
        return {
            is_realtime: true,
            realtime: realtime?.realtime,
            llm: realtime?.llm,
            embeddings: realtime?.embeddings,
            voice_preview_texts: voicePreviewTexts,
        };
    }

    const pipeline = asRecord(byok.pipeline);
    return {
        is_realtime: false,
        llm: pipeline?.llm,
        tts: pipeline?.tts,
        stt: pipeline?.stt,
        embeddings: pipeline?.embeddings,
        voice_preview_texts: voicePreviewTexts,
    };
}

function effectiveConfigToLegacyShape(config: Record<string, unknown> | null): Record<string, unknown> | null {
    if (!config) return null;
    return {
        is_realtime: Boolean(config.is_realtime),
        llm: config.llm,
        tts: config.tts,
        stt: config.stt,
        realtime: config.realtime,
        embeddings: config.embeddings,
    };
}

function emptyByokInitialConfig(isRealtime: boolean): Record<string, unknown> {
    return {
        is_realtime: isRealtime,
    };
}

// The v2 editor surfaces realtime ("Speech to Speech") and pipeline (BYOK) as
// separate tabs, so each tab gets its own initial config. A tab is pre-filled
// only when the saved (or effective) configuration matches that tab's mode;
// otherwise it starts empty so the other tab's data does not leak across.
function getByokInitialConfig(
    configuration: Record<string, unknown> | null,
    effectiveConfiguration: Record<string, unknown> | null,
    wantRealtime: boolean,
): Record<string, unknown> {
    const matchesTab = (config: Record<string, unknown> | null) =>
        config ? Boolean(config.is_realtime) === wantRealtime : false;

    const byokConfiguration = byokConfigToLegacyShape(configuration);
    if (byokConfiguration) {
        return matchesTab(byokConfiguration) ? byokConfiguration : emptyByokInitialConfig(wantRealtime);
    }

    if (configuration?.mode === "autonomous_ai_os" || isAutonomous AI OSEffectiveConfig(effectiveConfiguration)) {
        return emptyByokInitialConfig(wantRealtime);
    }

    const effective = effectiveConfigToLegacyShape(effectiveConfiguration);
    return matchesTab(effective) ? (effective as Record<string, unknown>) : emptyByokInitialConfig(wantRealtime);
}

function preferredMode(
    configuration: Record<string, unknown> | null,
    effectiveConfiguration: Record<string, unknown> | null,
): ModelMode {
    // Managed ("autonomous_ai_os") model services have been removed — legacy managed
    // configs fall back to BYOK.
    if (configuration?.mode === "byok") {
        return asRecord(configuration.byok)?.mode === "realtime" ? "realtime" : "byok";
    }
    return Boolean(effectiveConfiguration?.is_realtime) ? "realtime" : "byok";
}

function hasRequiredApiKey(
    service: ServiceSegment,
    serviceConfiguration: Record<string, unknown>,
    defaults: ServiceConfigurationDefaults,
): boolean {
    const provider = serviceConfiguration.provider as string | undefined;
    if (!provider) return false;
    const providerSchema = service === "realtime"
        ? defaults.realtime?.[provider]
        : defaults[service as "llm" | "tts" | "stt" | "embeddings"]?.[provider];
    const requiresApiKey = providerSchema?.required?.includes("api_key") ?? false;
    if (!requiresApiKey) return true;

    const apiKey = serviceConfiguration.api_key;
    if (Array.isArray(apiKey)) {
        return apiKey.some((key) => typeof key === "string" && key.trim().length > 0);
    }
    return typeof apiKey === "string" && apiKey.trim().length > 0;
}

function requireByokService(
    config: Record<string, unknown>,
    service: ServiceSegment,
    defaults: ServiceConfigurationDefaults,
): Record<string, unknown> {
    const serviceConfiguration = asRecord(config[service]);
    if (
        !serviceConfiguration
        || !serviceConfiguration.provider
        || serviceConfiguration.provider === "autonomous_ai_os"
        || !hasRequiredApiKey(service, serviceConfiguration, defaults)
    ) {
        throw new Error(`${service} configuration is required`);
    }
    return serviceConfiguration;
}

function optionalByokService(config: Record<string, unknown>, service: ServiceSegment): Record<string, unknown> | undefined {
    const serviceConfiguration = asRecord(config[service]);
    if (!serviceConfiguration?.provider || serviceConfiguration.provider === "autonomous_ai_os") return undefined;
    return serviceConfiguration;
}

export function AIModelConfigurationV2Editor({
    defaults,
    configuration,
    effectiveConfiguration,
    onSave,
    onCancel,
    submitLabel = "Save Configuration",
    forcedMode,
    hideTabList = false,
    activeServiceSegment,
    hideServiceTabs = false,
    nextTab,
    enableVoicePreview = false,
    voicePreviewModelConfigurationId,
}: AIModelConfigurationV2EditorProps) {
    const defaultsForByok = useMemo(() => byokDefaults(defaults), [defaults]);
    const [mode, setMode] = useState<ModelMode>(forcedMode ?? "byok");
    const [realtimeInitialConfig, setRealtimeInitialConfig] = useState<Record<string, unknown> | null>(null);
    const [pipelineInitialConfig, setPipelineInitialConfig] = useState<Record<string, unknown> | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (forcedMode) {
            setMode(forcedMode);
        }
    }, [forcedMode]);

    useEffect(() => {
        const rawConfiguration = asRecord(configuration);
        const rawEffectiveConfiguration = asRecord(effectiveConfiguration);
        if (!forcedMode) {
            setMode(preferredMode(rawConfiguration, rawEffectiveConfiguration));
        }
        setRealtimeInitialConfig(getByokInitialConfig(rawConfiguration, rawEffectiveConfiguration, true));
        setPipelineInitialConfig(getByokInitialConfig(rawConfiguration, rawEffectiveConfiguration, false));
    }, [configuration, defaults, effectiveConfiguration, forcedMode]);

    const saveByokConfiguration = async (config: Record<string, unknown>) => {
        setError(null);
        const isRealtime = Boolean(config.is_realtime);
        const llm = requireByokService(config, "llm", defaultsForByok);
        const embeddings = optionalByokService(config, "embeddings");
        const voicePreviewTexts = asRecord(config.voice_preview_texts);
        const body: OrganizationAiModelConfigurationV2 = {
            version: 2,
            mode: "byok",
            ...(voicePreviewTexts ? { voice_preview_texts: voicePreviewTexts as Record<string, string> } : {}),
            byok: isRealtime
                ? {
                    mode: "realtime",
                    realtime: {
                        realtime: requireByokService(config, "realtime", defaultsForByok) as never,
                        llm: llm as never,
                        ...(embeddings ? { embeddings: embeddings as never } : {}),
                    },
                }
                : {
                    mode: "pipeline",
                    pipeline: {
                        llm: llm as never,
                        tts: requireByokService(config, "tts", defaultsForByok) as never,
                        stt: requireByokService(config, "stt", defaultsForByok) as never,
                        ...(embeddings ? { embeddings: embeddings as never } : {}),
                    },
                },
        };

        await onSave(body);
    };

    const activeMode = forcedMode ?? mode;

    return (
        <div className="flex-1 flex flex-col min-h-0">
            {error && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    {error}
                </div>
            )}

            <Tabs value={activeMode} onValueChange={(value) => setMode(value as ModelMode)} className={`flex-1 flex flex-col min-h-0 ${hideTabList ? "" : "space-y-6"}`}>
                {!hideTabList && (
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="realtime">Speech to Speech</TabsTrigger>
                        <TabsTrigger value="byok">BYOK</TabsTrigger>
                    </TabsList>
                )}

                {/* Both forms stay mounted (inactive one hidden) so switching between
                    Speech to Speech and BYOK never clears what was typed in the other. */}
                <TabsContent value="realtime" forceMount className="mt-0 flex-1 flex flex-col min-h-0 data-[state=inactive]:hidden">
                    <p className="mb-4 text-sm text-muted-foreground">
                        A single speech-to-speech model handles the conversation in realtime (no separate transcriber or voice). An LLM is still required for variable extraction and QA.
                    </p>
                    <ServiceConfigurationForm
                        key={`realtime-${JSON.stringify(realtimeInitialConfig)}`}
                        mode="global"
                        forceRealtime
                        configurationDefaults={defaultsForByok}
                        initialConfig={realtimeInitialConfig}
                        submitLabel={submitLabel}
                        onSave={saveByokConfiguration}
                        onCancel={onCancel}
                        activeServiceSegment={activeServiceSegment}
                        hideServiceTabs={hideServiceTabs}
                        nextTab={nextTab}
                        enableVoicePreview={enableVoicePreview}
                        voicePreviewModelConfigurationId={voicePreviewModelConfigurationId}
                    />
                </TabsContent>

                <TabsContent value="byok" forceMount className="mt-0 flex-1 flex flex-col min-h-0 data-[state=inactive]:hidden">
                    <ServiceConfigurationForm
                        key={`byok-${JSON.stringify(pipelineInitialConfig)}`}
                        mode="global"
                        forceRealtime={false}
                        configurationDefaults={defaultsForByok}
                        initialConfig={pipelineInitialConfig}
                        submitLabel={submitLabel}
                        onSave={saveByokConfiguration}
                        onCancel={onCancel}
                        activeServiceSegment={activeServiceSegment}
                        hideServiceTabs={hideServiceTabs}
                        nextTab={nextTab}
                        enableVoicePreview={enableVoicePreview}
                        voicePreviewModelConfigurationId={voicePreviewModelConfigurationId}
                    />
                </TabsContent>
            </Tabs>
        </div>
    );
}
