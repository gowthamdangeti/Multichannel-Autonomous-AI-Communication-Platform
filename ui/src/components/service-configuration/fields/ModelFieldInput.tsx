"use client";

import { useMemo } from "react";
import { useFormContext } from "react-hook-form";

import { useProviderModels } from "../hooks/useProviderModels";
import { useServiceConfigEditor } from "../ServiceConfigContext";
import type { FormValues, ServiceSegment } from "../types";
import { OptionsFieldInput } from "./OptionsFieldInput";

interface ModelFieldInputProps {
    service: ServiceSegment;
    /** The list in code: shown until the API answers, and if it fails. */
    staticOptions: string[];
    allowCustom: boolean;
}

/** Model picker fed by the provider's live list, with the code list as fallback. */
export function ModelFieldInput({ service, staticOptions, allowCustom }: ModelFieldInputProps) {
    const { watch } = useFormContext<FormValues>();
    const { providers } = useServiceConfigEditor();
    const models = useProviderModels(service, providers[service]);
    const selected = (watch(`${service}_model`) as string) || "";

    const options = useMemo(() => {
        const available = models.filter((model) => !model.is_deprecated).map((model) => model.model_id);
        const list = available.length > 0 ? available : staticOptions;
        // A saved model must stay selectable even if the provider stopped listing it.
        return selected && !list.includes(selected) ? [selected, ...list] : list;
    }, [models, staticOptions, selected]);

    return <OptionsFieldInput service={service} field="model" options={options} allowCustom={allowCustom} />;
}
