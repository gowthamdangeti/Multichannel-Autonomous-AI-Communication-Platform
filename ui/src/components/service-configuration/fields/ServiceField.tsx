import { cn } from "@/lib/utils";

import type { ProviderSchema, ServiceSegment } from "../types";
import { FieldDescription } from "./FieldDescription";
import { FieldInput } from "./FieldInput";
import { FieldLabel } from "./FieldLabel";

interface ServiceFieldProps {
    service: ServiceSegment;
    field: string;
    providerSchema: ProviderSchema;
    label?: string;
    className?: string;
}

/** Label, input and help text of one provider field. */
export function ServiceField({ service, field, providerSchema, label, className }: ServiceFieldProps) {
    return (
        <div className={cn("space-y-2", className)}>
            <FieldLabel service={service} field={field} providerSchema={providerSchema} label={label} />
            <FieldInput service={service} field={field} providerSchema={providerSchema} />
            <FieldDescription field={field} providerSchema={providerSchema} />
        </div>
    );
}
