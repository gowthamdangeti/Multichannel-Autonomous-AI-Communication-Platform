"use client";

import { useFormContext } from "react-hook-form";

import { VoiceSelector } from "@/components/VoiceSelector";
import { buildProviderVoiceOptions } from "@/lib/voiceMetadata";

import { getSchemaDropdownOptions } from "../schemaUtils";
import { useServiceConfigEditor } from "../ServiceConfigContext";
import type { FormValues, SchemaProperty, ServiceSegment } from "../types";

interface VoiceFieldInputProps {
    service: ServiceSegment;
    schema: SchemaProperty | undefined;
}

/** Voice picker for TTS / speech-to-speech. */
export function VoiceFieldInput({ service, schema }: VoiceFieldInputProps) {
    const { watch, setValue } = useFormContext<FormValues>();
    const editor = useServiceConfigEditor();
    const provider = editor.providers[service];
    const fieldKey = `${service}_voice`;
    const model = (watch(`${service}_model`) as string) || undefined;
    const voice = (watch(fieldKey) as string) || "";

    const staticOptions = getSchemaDropdownOptions(schema, model);
    const staticVoices = staticOptions ? buildProviderVoiceOptions(provider, staticOptions) : undefined;

    return (
        <VoiceSelector
            provider={provider}
            value={voice}
            onChange={(voiceId) => setValue(fieldKey, voiceId, { shouldDirty: true })}
            onGenderFilterChange={(gender) => editor.setGenderFilter(service, gender)}
            model={model}
            language={(watch(`${service}_language`) as string) || undefined}
            staticVoices={staticVoices}
            allowManualInput
            genderFilter={editor.genderFilters[service] || "all"}
            isManualInput={Boolean(editor.customInput[fieldKey])}
            onManualInputToggle={(checked) => editor.setCustomInputFlag(fieldKey, checked)}
            hideManualCheckbox
        />
    );
}
