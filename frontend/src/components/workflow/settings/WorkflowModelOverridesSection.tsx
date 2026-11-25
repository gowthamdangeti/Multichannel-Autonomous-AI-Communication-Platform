"use client";


import { Brain, ExternalLink, Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
    getModelConfigurationOptionsApiV1OrganizationsModelConfigurationOptionsGet,
} from "@/client/sdk.gen";
import type {
    ModelConfigurationOption,
    OrganizationAiModelConfigurationResponse,
    OrganizationAiModelConfigurationV2,
} from "@/client/types.gen";
import {
    AIModelConfigurationV2Editor,
    type ModelConfigurationDefaultsV2,
} from "@/components/AIModelConfigurationV2Editor";
import { ServiceConfigurationForm } from "@/components/ServiceConfigurationForm";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { WorkflowModelPresetSelector } from "@/components/workflow/settings/WorkflowModelPresetSelector";
import { SETTINGS_DOCUMENTATION_URLS } from "@/constants/documentation";
import {
    type WorkflowConfigurations,
} from "@/types/workflow-configurations";


// ---------------------------------------------------------------------------
// Section: Model Overrides
// ---------------------------------------------------------------------------

export function withoutModelConfigurationOverrides(configurations: WorkflowConfigurations): WorkflowConfigurations {
    const next = { ...configurations };
    delete next.model_overrides;
    delete next.model_configuration_v2_override;
    return next;
}

export function WorkflowModelOverridesSection({
    workflowConfigurations,
    workflowName,
    onSave,
    modelConfigurationDefaults,
    organizationModelConfiguration,
    modelConfigurationLoading,
    modelConfigurationError,
}: {
    workflowConfigurations: WorkflowConfigurations;
    workflowName: string;
    onSave: (configurations: WorkflowConfigurations, workflowName: string) => Promise<void>;
    modelConfigurationDefaults: ModelConfigurationDefaultsV2 | null;
    organizationModelConfiguration: OrganizationAiModelConfigurationResponse | null;
    modelConfigurationLoading: boolean;
    modelConfigurationError: string | null;
}) {
    const savedV2Override = workflowConfigurations.model_configuration_v2_override;
    const hasSavedModelOverride = Boolean(savedV2Override || workflowConfigurations.model_overrides);
    const [overrideEnabled, setOverrideEnabled] = useState(Boolean(savedV2Override));
    const [isRemovingOverride, setIsRemovingOverride] = useState(false);
    const [presetOptions, setPresetOptions] = useState<ModelConfigurationOption[] | null>(null);

    useEffect(() => {
        setOverrideEnabled(Boolean(workflowConfigurations.model_configuration_v2_override));
    }, [workflowConfigurations.model_configuration_v2_override]);

    useEffect(() => {
        (async () => {
            const res = await getModelConfigurationOptionsApiV1OrganizationsModelConfigurationOptionsGet();
            setPresetOptions(res.data ?? []);
        })();
    }, []);

    // Admin presets exist → org users only pick a preset; no provider/key editor.
    if (presetOptions === null) {
        return null;
    }
    if (presetOptions.length > 0) {
        return (
            <WorkflowModelPresetSelector
                workflowConfigurations={workflowConfigurations}
                workflowName={workflowName}
                onSave={onSave}
                options={presetOptions}
            />
        );
    }

    const source = organizationModelConfiguration?.source || "empty";
    const isV2 = source === "organization_v2";

    const saveLegacyOverrides = async (config: Record<string, unknown>) => {
        const nextConfigurations = withoutModelConfigurationOverrides(workflowConfigurations);
        const modelOverrides = config.model_overrides as WorkflowConfigurations["model_overrides"] | undefined;
        if (modelOverrides) {
            nextConfigurations.model_overrides = modelOverrides;
        }
        await onSave(nextConfigurations, workflowName);
    };

    const saveV2Override = async (configuration: OrganizationAiModelConfigurationV2) => {
        const nextConfigurations = withoutModelConfigurationOverrides(workflowConfigurations);
        nextConfigurations.model_configuration_v2_override = configuration;
        await onSave(nextConfigurations, workflowName);
        toast.success("Model override saved");
    };

    const removeV2Override = async () => {
        setIsRemovingOverride(true);
        try {
            await onSave(withoutModelConfigurationOverrides(workflowConfigurations), workflowName);
            setOverrideEnabled(false);
            toast.success("Using organization model configuration");
        } finally {
            setIsRemovingOverride(false);
        }
    };

    return (
        <Card id="models">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                    <Brain className="h-4 w-4" />
                    Model Overrides
                </CardTitle>
                <CardDescription>
                    {isV2
                        ? "Override the full organization model configuration for this workflow."
                        : "Override global model settings for this workflow. Toggle individual services to customize."}{" "}
                    <a href={SETTINGS_DOCUMENTATION_URLS.modelOverrides} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 underline">Learn more <ExternalLink className="h-3 w-3" /></a>
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {modelConfigurationLoading && (
                    <div className="flex items-center gap-2 rounded-md border p-4 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading model configuration
                    </div>
                )}

                {modelConfigurationError && (
                    <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                        {modelConfigurationError}
                    </div>
                )}

                {!modelConfigurationLoading && !modelConfigurationError && !isV2 && (
                    <>
                        {source === "legacy_user_v1" && (
                            <div className="flex flex-col gap-3 rounded-md border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
                                <p className="text-sm text-muted-foreground">
                                    This workflow is using legacy model overrides. Migrate organization model configuration to use v2 overrides.
                                </p>
                                <Button type="button" variant="outline" size="sm" asChild>
                                    <Link href="/model-configurations?action=migrate_to_v2">Migrate to v2</Link>
                                </Button>
                            </div>
                        )}
                        <ServiceConfigurationForm
                            mode="override"
                            currentOverrides={workflowConfigurations.model_overrides}
                            submitLabel="Save Model Overrides"
                            onSave={saveLegacyOverrides}
                        />
                    </>
                )}

                {!modelConfigurationLoading && !modelConfigurationError && isV2 && modelConfigurationDefaults && organizationModelConfiguration && (
                    <>
                        <div className="flex items-center justify-between rounded-md border p-4">
                            <div className="space-y-0.5">
                                <Label htmlFor="workflow-model-v2-override" className="text-sm font-medium">
                                    Override for this workflow
                                </Label>
                                <p className="text-xs text-muted-foreground">
                                    {overrideEnabled
                                        ? "This workflow uses its own complete model configuration."
                                        : "This workflow uses the organization model configuration."}
                                </p>
                            </div>
                            <Switch
                                id="workflow-model-v2-override"
                                checked={overrideEnabled}
                                onCheckedChange={setOverrideEnabled}
                            />
                        </div>

                        {overrideEnabled ? (
                            <AIModelConfigurationV2Editor
                                defaults={modelConfigurationDefaults}
                                configuration={
                                    (savedV2Override as OrganizationAiModelConfigurationV2 | undefined)
                                    || (organizationModelConfiguration.configuration as OrganizationAiModelConfigurationV2 | null)
                                }
                                effectiveConfiguration={
                                    savedV2Override
                                        ? null
                                        : organizationModelConfiguration.effective_configuration
                                }
                                submitLabel="Save Model Override"
                                onSave={saveV2Override}
                            />
                        ) : (
                            <div className="rounded-md border bg-muted/20 p-4">
                                <p className="text-sm text-muted-foreground">
                                    Using organization model configuration.
                                </p>
                                {hasSavedModelOverride && (
                                    <div className="mt-3 flex justify-end">
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={removeV2Override}
                                            disabled={isRemovingOverride}
                                        >
                                            {isRemovingOverride ? "Saving..." : "Save Organization Configuration"}
                                        </Button>
                                    </div>
                                )}
                            </div>
                        )}
                    </>
                )}
            </CardContent>
        </Card>
    );
}
