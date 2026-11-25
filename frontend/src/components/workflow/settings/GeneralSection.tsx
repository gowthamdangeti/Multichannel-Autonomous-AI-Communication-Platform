"use client";

import { ExternalLink, Settings } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { SETTINGS_DOCUMENTATION_URLS } from "@/constants/documentation";
import type { WorkflowConfigurations } from "@/types/workflow-configurations";

import { AmbientNoiseSettings } from "./general/AmbientNoiseSettings";
import { CallManagementSettings } from "./general/CallManagementSettings";
import { useGeneralSettings } from "./general/hooks/useGeneralSettings";
import { SettingsBlock } from "./general/SettingsBlock";
import { TurnDetectionSettings } from "./general/TurnDetectionSettings";

interface GeneralSectionProps {
    workflowConfigurations: WorkflowConfigurations;
    workflowName: string;
    workflowId: number;
    onSave: (configurations: WorkflowConfigurations, workflowName: string) => Promise<void>;
}

/** Agent name, ambient noise, turn detection, context compaction and call limits. */
export function GeneralSection({ workflowConfigurations, workflowName, workflowId, onSave }: GeneralSectionProps) {
    const settings = useGeneralSettings({ workflowConfigurations, workflowName, onSave });

    return (
        <Card id="general">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                    <Settings className="h-4 w-4" />
                    General
                </CardTitle>
                <CardDescription>Agent name, call behavior, and turn detection.{" "}
                    <a href={SETTINGS_DOCUMENTATION_URLS.general} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 underline">Learn more <ExternalLink className="h-3 w-3" /></a>
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="space-y-2">
                    <Label htmlFor="workflow_name" className="text-sm font-medium">Agent Name</Label>
                    <Input
                        id="workflow_name"
                        value={settings.name}
                        onChange={(e) => settings.setName(e.target.value)}
                        placeholder="Enter Agent name"
                    />
                </div>

                <Separator />
                <AmbientNoiseSettings workflowId={workflowId} config={settings.ambientNoise} onChange={settings.setAmbientNoise} />

                <Separator />
                <TurnDetectionSettings
                    strategy={settings.turnStopStrategy}
                    onStrategyChange={settings.setTurnStopStrategy}
                    stopSecs={settings.smartTurnStopSecs}
                    onStopSecsChange={settings.setSmartTurnStopSecs}
                />

                <Separator />
                <SettingsBlock
                    title="Context Compaction"
                    description="Automatically summarize conversation context when transitioning between nodes. Not applicable in Realtime mode - the speech-to-speech service manages its own conversation state and this setting is ignored."
                >
                    <div className="flex items-center justify-between">
                        <Label htmlFor="context-compaction-enabled" className="text-sm">Enable Context Compaction</Label>
                        <Switch
                            id="context-compaction-enabled"
                            checked={settings.contextCompactionEnabled}
                            onCheckedChange={settings.setContextCompactionEnabled}
                        />
                    </div>
                </SettingsBlock>

                <Separator />
                <CallManagementSettings
                    maxCallDuration={settings.maxCallDuration}
                    onMaxCallDurationChange={settings.setMaxCallDuration}
                    maxUserIdleTimeout={settings.maxUserIdleTimeout}
                    onMaxUserIdleTimeoutChange={settings.setMaxUserIdleTimeout}
                />
            </CardContent>
            <CardFooter className="justify-end gap-3 border-t pt-6">
                {settings.isDirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
                <Button onClick={settings.save} disabled={settings.isSaving || !settings.isDirty}>
                    {settings.isSaving ? "Saving..." : "Save General Settings"}
                </Button>
            </CardFooter>
        </Card>
    );
}
