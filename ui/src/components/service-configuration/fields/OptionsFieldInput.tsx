"use client";

import { useFormContext } from "react-hook-form";

import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getLanguageDisplayName } from "@/constants/languages";

import { VOICE_DISPLAY_NAMES } from "../constants";
import { useServiceConfigEditor } from "../ServiceConfigContext";
import type { FormValues, ServiceSegment } from "../types";

interface OptionsFieldInputProps {
    service: ServiceSegment;
    field: string;
    options: string[];
    /** Whether the user may switch to typing a value (the label's "Custom" box). */
    allowCustom: boolean;
}

function formatOption(field: string, value: string, allowCustom: boolean): string {
    if (allowCustom) return value;
    if (field === "language") return getLanguageDisplayName(value);
    if (field === "voice") return VOICE_DISPLAY_NAMES[value] || value.charAt(0).toUpperCase() + value.slice(1);
    return value;
}

/** Dropdown of schema options, or a text box when "Custom" is ticked. */
export function OptionsFieldInput({ service, field, options, allowCustom }: OptionsFieldInputProps) {
    const { watch, setValue } = useFormContext<FormValues>();
    const { customInput } = useServiceConfigEditor();
    const fieldKey = `${service}_${field}`;
    const value = (watch(fieldKey) as string) || "";
    const setFieldValue = (next: string) => setValue(fieldKey, next, { shouldDirty: true });

    if (allowCustom && customInput[fieldKey]) {
        return (
            <Input
                type="text"
                placeholder={`Enter ${field}`}
                value={value}
                onChange={(e) => setFieldValue(e.target.value)}
            />
        );
    }

    return (
        <Select value={value} onValueChange={(next) => next && setFieldValue(next)}>
            <SelectTrigger className="w-full">
                <SelectValue placeholder={`Select ${field}`} />
            </SelectTrigger>
            <SelectContent>
                {options.map((option) => (
                    <SelectItem key={option} value={option}>
                        {formatOption(field, option, allowCustom)}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}
