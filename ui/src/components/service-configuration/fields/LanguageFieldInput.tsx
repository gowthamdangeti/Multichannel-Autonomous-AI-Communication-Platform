"use client";

import { useFormContext } from "react-hook-form";

import { type LanguageCapability, LanguageMismatchWarning, LanguagePicker } from "@/components/LanguagePicker";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getLanguageDisplayName } from "@/constants/languages";

import { useServiceConfigEditor } from "../ServiceConfigContext";
import type { FormValues, SchemaProperty, ServiceSegment } from "../types";

interface LanguageFieldInputProps {
    service: ServiceSegment;
    schema: SchemaProperty | undefined;
    options: string[];
}

/** Language picker backed by the provider's live language list (or a typed code). */
export function LanguageFieldInput({ service, schema, options }: LanguageFieldInputProps) {
    const { watch, setValue } = useFormContext<FormValues>();
    const { providers, customInput } = useServiceConfigEditor();
    const fieldKey = `${service}_language`;
    const value = (watch(fieldKey) as string) || "";
    const setLanguage = (next: string) => setValue(fieldKey, next, { shouldDirty: true });
    const uniqueOptions = Array.from(new Set(options));

    if (schema?.allow_custom_input && customInput[fieldKey]) {
        return (
            <Input
                type="text"
                placeholder="Enter language code (e.g. en-US, hi-IN)"
                value={value}
                onChange={(e) => setLanguage(e.target.value)}
            />
        );
    }

    const capability: LanguageCapability | null =
        service === "stt" || service === "tts" || service === "realtime" ? service : null;

    if (!capability) {
        return (
            <Select value={value} onValueChange={(next) => next && setLanguage(next)}>
                <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select language" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                    {uniqueOptions.map((code) => (
                        <SelectItem key={code} value={code}>
                            {getLanguageDisplayName(code)}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        );
    }

    return (
        <>
            <LanguagePicker
                provider={providers[service]}
                capability={capability}
                model={(watch(`${service}_model`) as string) || undefined}
                value={value}
                onChange={setLanguage}
                fallbackCodes={uniqueOptions}
            />
            {service === "tts" && (
                <LanguageMismatchWarning sttLanguage={(watch("stt_language") as string) || ""} ttsLanguage={value} />
            )}
        </>
    );
}
