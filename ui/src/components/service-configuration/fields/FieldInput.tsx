"use client";

import { useFormContext } from "react-hook-form";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { getSchemaDropdownOptions, isVoiceField, resolveFieldSchema } from "../schemaUtils";
import type { FormValues, ProviderSchema, ServiceSegment } from "../types";
import { LanguageFieldInput } from "./LanguageFieldInput";
import { ModelFieldInput } from "./ModelFieldInput";
import { OptionsFieldInput } from "./OptionsFieldInput";
import { VoiceFieldInput } from "./VoiceFieldInput";

interface FieldInputProps {
    service: ServiceSegment;
    field: string;
    providerSchema: ProviderSchema;
}

/** The input control for one provider field, chosen from its schema. */
export function FieldInput({ service, field, providerSchema }: FieldInputProps) {
    const { watch, register } = useFormContext<FormValues>();
    const schema = resolveFieldSchema(providerSchema, field);
    const options = getSchemaDropdownOptions(schema, watch(`${service}_model`) as string | undefined);
    const hasOptions = Boolean(options && options.length > 0);

    if (isVoiceField(service, field)) {
        return <VoiceFieldInput service={service} schema={schema} />;
    }
    if (field === "language" && hasOptions) {
        return <LanguageFieldInput service={service} schema={schema} options={options!} />;
    }
    if (field === "model" && service !== "embeddings" && hasOptions) {
        return (
            <ModelFieldInput
                service={service}
                staticOptions={options!}
                allowCustom={Boolean(schema?.allow_custom_input)}
            />
        );
    }
    if (hasOptions) {
        return (
            <OptionsFieldInput
                service={service}
                field={field}
                options={options!}
                allowCustom={Boolean(schema?.allow_custom_input)}
            />
        );
    }

    const isRequired = service !== "embeddings" && providerSchema.required?.includes(field);
    if (schema?.multiline) {
        return (
            <Textarea
                rows={6}
                className="font-mono text-xs"
                placeholder={`Enter ${field}`}
                {...register(`${service}_${field}`, { required: isRequired })}
            />
        );
    }
    const isNumber = schema?.type === "number";
    // An empty optional number is left unset (not NaN) so the backend uses its default.
    const numberOptions = isRequired
        ? { valueAsNumber: true }
        : { setValueAs: (value: unknown) => (value === "" || value == null ? undefined : Number(value)) };
    return (
        <Input
            type={isNumber ? "number" : "text"}
            {...(isNumber && { step: "any" })}
            placeholder={isNumber && !isRequired ? "Default" : `Enter ${field}`}
            {...register(`${service}_${field}`, { required: isRequired, ...(isNumber && numberOptions) })}
        />
    );
}
