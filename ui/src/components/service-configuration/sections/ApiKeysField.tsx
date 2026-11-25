"use client";

import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { FieldDescription } from "../fields/FieldDescription";
import { useServiceConfigEditor } from "../ServiceConfigContext";
import type { ProviderSchema, ServiceSegment } from "../types";

interface ApiKeysFieldProps {
    service: ServiceSegment;
    providerSchema: ProviderSchema;
}

/** One or more API keys (overrides take a single key and fall back to global). */
export function ApiKeysField({ service, providerSchema }: ApiKeysFieldProps) {
    const { mode, apiKeys, setApiKeys } = useServiceConfigEditor();
    const keys = apiKeys[service];
    const isOverride = mode === "override";

    const updateKey = (index: number, value: string) => setApiKeys(service, keys.map((k, i) => (i === index ? value : k)));
    const removeKey = (index: number) => setApiKeys(service, keys.filter((_, i) => i !== index));

    return (
        <div className="space-y-2">
            <Label>{isOverride ? "API Key (leave empty to use global)" : "API Key(s)"}</Label>
            <FieldDescription field="api_key" providerSchema={providerSchema} />
            {keys.map((key, index) => (
                <div key={index} className="flex gap-2">
                    <Input
                        type="text"
                        placeholder="Enter API key"
                        value={key}
                        onChange={(e) => updateKey(index, e.target.value)}
                    />
                    {keys.length > 1 && (
                        <Button type="button" variant="outline" size="icon" className="shrink-0" onClick={() => removeKey(index)}>
                            <X className="h-4 w-4" />
                        </Button>
                    )}
                </div>
            ))}
            {!isOverride && (
                <div className="flex justify-end">
                    <Button type="button" variant="outline" size="sm" onClick={() => setApiKeys(service, [...keys, ""])}>
                        <Plus className="h-4 w-4 mr-1" /> Add API Key
                    </Button>
                </div>
            )}
        </div>
    );
}
