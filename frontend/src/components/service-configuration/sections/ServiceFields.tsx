"use client";

import { useFormContext } from "react-hook-form";

import { VoicePreviewPanel } from "@/components/voice-preview/VoicePreviewPanel";

import { ServiceField } from "../fields/ServiceField";
import { getAvailableGenderOptions, getServiceFieldLayout, resolveFieldSchema } from "../schemaUtils";
import { useServiceConfigEditor } from "../ServiceConfigContext";
import type { FormValues, ServiceSegment } from "../types";
import { ApiKeysField } from "./ApiKeysField";
import { ModelPriceBadge } from "./ModelPriceBadge";
import { ProviderSelect } from "./ProviderSelect";
import { VoiceGenderSelect } from "./VoiceGenderSelect";

/** Provider, model, language, voice and remaining fields of one service tab. */
export function ServiceFields({ service }: { service: ServiceSegment }) {
    const { watch, getValues } = useFormContext<FormValues>();
    const editor = useServiceConfigEditor();
    const { schemas, providers, enableVoicePreview, voicePreviewModelConfigurationId, previewTexts, setPreviewText, configFor } = editor;
    const provider = providers[service];
    const providerSchema = schemas[service]?.[provider];
    const layout = getServiceFieldLayout(service, providerSchema);
    const ready = Boolean(provider && providerSchema);
    const model = (watch(`${service}_model`) as string) || undefined;
    const voice = (watch(`${service}_voice`) as string) || undefined;

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <ProviderSelect service={service} />
                {ready && layout.firstField && (
                    <ServiceField service={service} field={layout.firstField} providerSchema={providerSchema!} />
                )}
            </div>

            {ready && layout.showLanguageBeforeVoice && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <ServiceField service={service} field="language" providerSchema={providerSchema!} label="Language" />
                </div>
            )}

            {ready && layout.hasVoiceField && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <VoiceGenderSelect
                        service={service}
                        options={getAvailableGenderOptions(provider, providerSchema!, model)}
                    />
                    <ServiceField service={service} field="voice" providerSchema={providerSchema!} label="Voice" />
                </div>
            )}

            {ready && layout.remainingFields.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {layout.remainingFields.map((field) => (
                        <ServiceField
                            key={field}
                            service={service}
                            field={field}
                            providerSchema={providerSchema!}
                            className={resolveFieldSchema(providerSchema!, field)?.multiline ? "sm:col-span-2" : undefined}
                        />
                    ))}
                </div>
            )}

            {ready && providerSchema!.properties.api_key && (
                <ApiKeysField service={service} providerSchema={providerSchema!} />
            )}

            {ready && (
                <ModelPriceBadge
                    service={service}
                    provider={provider}
                    model={model}
                    voice={voice}
                />
            )}

            {ready && enableVoicePreview && (service === "tts" || service === "realtime") && (
                <VoicePreviewPanel
                    className="w-full"
                    serviceType={service === "realtime" ? "sts" : "tts"}
                    provider={provider}
                    model={model}
                    voice={voice}
                    config={configFor(service, getValues())}
                    modelConfigurationId={voicePreviewModelConfigurationId}
                    text={previewTexts[service] ?? null}
                    onTextChange={(text) => setPreviewText(service, text)}
                />
            )}
        </div>
    );
}
