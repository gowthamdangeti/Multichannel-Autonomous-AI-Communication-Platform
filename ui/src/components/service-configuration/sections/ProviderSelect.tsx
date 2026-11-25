"use client";

import { ExternalLink } from "lucide-react";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { getProviderDisplayName } from "../schemaUtils";
import { useServiceConfigEditor } from "../ServiceConfigContext";
import type { ServiceSegment } from "../types";

/** Provider picker for one service, with the provider's description and docs link. */
export function ProviderSelect({ service }: { service: ServiceSegment }) {
    const { schemas, providers, changeProvider } = useServiceConfigEditor();
    const serviceSchemas = schemas[service] ?? {};
    const currentProvider = providers[service];
    const providerSchema = serviceSchemas[currentProvider];

    return (
        <div className="space-y-2">
            <Label>Provider</Label>
            <Select value={currentProvider} onValueChange={(name) => changeProvider(service, name)}>
                <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent>
                    {Object.keys(serviceSchemas).map((provider) => (
                        <SelectItem key={provider} value={provider}>
                            {getProviderDisplayName(provider, serviceSchemas[provider])}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            {(providerSchema?.description || providerSchema?.provider_docs_url) && (
                <p className="text-xs text-muted-foreground">
                    {providerSchema.description}{" "}
                    {providerSchema.provider_docs_url && (
                        <a
                            href={providerSchema.provider_docs_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-0.5 underline"
                        >
                            Learn more <ExternalLink className="h-3 w-3" />
                        </a>
                    )}
                </p>
            )}
        </div>
    );
}
