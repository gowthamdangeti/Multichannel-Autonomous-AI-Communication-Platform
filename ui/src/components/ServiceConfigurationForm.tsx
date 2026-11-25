"use client";

import { FormProvider } from "react-hook-form";

import { getVisibleTabs } from "@/components/service-configuration/constants";
import { useServiceConfigurationForm } from "@/components/service-configuration/hooks/useServiceConfigurationForm";
import { ServiceTabPanels } from "@/components/service-configuration/sections/ServiceTabPanels";
import { ServiceConfigProvider } from "@/components/service-configuration/ServiceConfigContext";
import type { ServiceConfigurationFormProps } from "@/components/service-configuration/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export type {
    ProviderSchema,
    ServiceConfigurationDefaults,
    ServiceConfigurationFormProps,
    ServiceSegment,
} from "@/components/service-configuration/types";

/**
 * Provider / model / voice / key editor for every AI service, used for the
 * organization configuration (global) and per-workflow overrides.
 */
export function ServiceConfigurationForm(props: ServiceConfigurationFormProps) {
    const { mode, onCancel, submitLabel, forceRealtime, activeServiceSegment, hideServiceTabs = false, nextTab } = props;
    const { form, submit, apiError, isSaving, isRealtime, setIsRealtime, editor } = useServiceConfigurationForm(props);

    const visibleTabs = getVisibleTabs(mode, isRealtime);
    const defaultTab = isRealtime ? "realtime" : "stt";
    const tabs = (
        <Tabs
            key={`${defaultTab}-${activeServiceSegment}`}
            defaultValue={activeServiceSegment ?? defaultTab}
            value={activeServiceSegment}
            className="w-full"
        >
            {!hideServiceTabs && (
                <TabsList className="grid w-full mb-6" style={{ gridTemplateColumns: `repeat(${visibleTabs.length}, 1fr)` }}>
                    {visibleTabs.map(({ key, label }) => (
                        <TabsTrigger key={key} value={key}>
                            {label}
                        </TabsTrigger>
                    ))}
                </TabsList>
            )}
            <ServiceTabPanels tabs={visibleTabs} />
        </Tabs>
    );

    return (
        <FormProvider {...form}>
            <ServiceConfigProvider value={editor}>
                <form onSubmit={submit} className="flex-1 flex flex-col min-h-0">
                    {/* Realtime toggle — hidden when the parent locks the mode (v2 tabs) */}
                    {forceRealtime === undefined && (
                        <div className="flex items-center justify-between mb-4 p-4 border rounded-lg">
                            <div>
                                <Label htmlFor="realtime-toggle" className="text-sm font-medium">
                                    Realtime Mode
                                </Label>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    Uses a single speech-to-speech model (no separate STT/TTS). An LLM is still required for variable extraction and QA.
                                </p>
                            </div>
                            <Switch id="realtime-toggle" checked={isRealtime} onCheckedChange={setIsRealtime} />
                        </div>
                    )}

                    {hideServiceTabs ? (
                        <div className="space-y-4">{tabs}</div>
                    ) : (
                        <Card>
                            <CardContent className="pt-6">{tabs}</CardContent>
                        </Card>
                    )}

                    {apiError && <p className="text-red-500 mt-4">{apiError}</p>}

                    <div className={cn("flex justify-end gap-3 mt-auto items-center shrink-0", hideServiceTabs ? "pt-4 pb-4 border-t border-border" : "pt-6 pb-4")}>
                        {onCancel && (
                            <Button type="button" variant="outline" onClick={onCancel}>
                                Cancel
                            </Button>
                        )}
                        {nextTab ? (
                            <Button type="button" className="cursor-pointer" onClick={nextTab.onNavigate}>
                                Next: {nextTab.label} →
                            </Button>
                        ) : (
                            <Button type="submit" disabled={isSaving} className="cursor-pointer">
                                {isSaving ? "Saving..." : submitLabel || "Save Configuration"}
                            </Button>
                        )}
                    </div>
                </form>
            </ServiceConfigProvider>
        </FormProvider>
    );
}
