"use client";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

import { getGlobalSummary } from "../schemaUtils";
import { useServiceConfigEditor } from "../ServiceConfigContext";
import type { ServiceSegment } from "../types";

interface OverrideToggleProps {
    service: ServiceSegment;
    label: string;
}

/** Per-service switch in override mode; shows what the global config uses when off. */
export function OverrideToggle({ service, label }: OverrideToggleProps) {
    const { userConfig, schemas, enabledOverrides, setOverrideEnabled } = useServiceConfigEditor();
    const globalVal = userConfig?.[service] as Record<string, unknown> | null | undefined;
    const globalProvider = globalVal?.provider as string | undefined;
    const globalProviderSchema = globalProvider ? schemas[service]?.[globalProvider] : undefined;
    const isEnabled = enabledOverrides[service];

    return (
        <div className="flex items-center justify-between p-3 border rounded-md bg-muted/20 mb-4">
            <div className="space-y-0.5">
                <Label htmlFor={`override-${service}`} className="text-sm cursor-pointer font-medium">
                    Override {label}
                </Label>
                {!isEnabled && (
                    <p className="text-xs text-muted-foreground">
                        Using global: {getGlobalSummary(globalVal, globalProviderSchema)}
                    </p>
                )}
            </div>
            <Switch
                id={`override-${service}`}
                checked={isEnabled}
                onCheckedChange={(checked) => setOverrideEnabled(service, checked)}
            />
        </div>
    );
}
