import { ExternalLink } from "lucide-react";

import { resolveFieldSchema } from "../schemaUtils";
import type { ProviderSchema } from "../types";

interface FieldDescriptionProps {
    field: string;
    providerSchema: ProviderSchema;
}

/** Help text under a field, with an optional "Supported languages" docs link. */
export function FieldDescription({ field, providerSchema }: FieldDescriptionProps) {
    if (!providerSchema.properties[field]) return null;
    const schema = resolveFieldSchema(providerSchema, field);
    if (!schema?.description && !schema?.docs_url) return null;
    return (
        <p className="text-xs text-muted-foreground">
            {schema.description}{" "}
            {schema.docs_url && (
                <a
                    href={schema.docs_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 underline"
                >
                    Supported languages <ExternalLink className="h-3 w-3" />
                </a>
            )}
        </p>
    );
}
