"use client";

import { useId } from "react";
import { useFormContext } from "react-hook-form";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

import { getSchemaDropdownOptions, isVoiceField, resolveFieldSchema } from "../schemaUtils";
import { useServiceConfigEditor } from "../ServiceConfigContext";
import type { FormValues, ProviderSchema, ServiceSegment } from "../types";

interface FieldLabelProps {
    service: ServiceSegment;
    field: string;
    providerSchema: ProviderSchema;
    label?: string;
}

/** Field label, with a "Custom" checkbox for fields that accept a typed value. */
export function FieldLabel({ service, field, providerSchema, label }: FieldLabelProps) {
    const { watch, setValue } = useFormContext<FormValues>();
    const { customInput, setCustomInputFlag } = useServiceConfigEditor();
    // Unique per form: the same field can render in two mounted forms
    // (e.g. LLM in both Speech to Speech and BYOK), so ids must not collide.
    const instanceId = useId();
    const schema = resolveFieldSchema(providerSchema, field);
    const labelText = label || field.replace(/_/g, " ");

    if (!isVoiceField(service, field) && !schema?.allow_custom_input) {
        return <Label className="capitalize">{labelText}</Label>;
    }

    const fieldKey = `${service}_${field}`;
    const checkboxId = `custom-toggle-${fieldKey}-${instanceId}`;
    const handleCustomToggle = (checked: boolean) => {
        setCustomInputFlag(fieldKey, checked);
        // Back to the list: select its first option rather than keep a typed value.
        const options = getSchemaDropdownOptions(schema, watch(`${service}_model`) as string | undefined);
        if (!checked && options && options.length > 0) setValue(fieldKey, options[0], { shouldDirty: true });
    };

    return (
        <div className="flex items-center justify-between">
            <Label className="capitalize">{labelText}</Label>
            <div className="flex items-center space-x-1.5 cursor-pointer">
                <Checkbox
                    id={checkboxId}
                    className="cursor-pointer"
                    checked={Boolean(customInput[fieldKey])}
                    onCheckedChange={(checked) => handleCustomToggle(Boolean(checked))}
                />
                <Label htmlFor={checkboxId} className="text-xs font-normal cursor-pointer text-muted-foreground select-none">
                    Custom
                </Label>
            </div>
        </div>
    );
}
