"use client";

import { ExternalLink } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { EmbedDialog } from "@/app/workflow/[workflowId]/components/EmbedDialog";
import { Button } from "@/components/ui/button";
import {
    Sheet,
    SheetBody,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { UnderlineTabs } from "@/components/ui/underline-tabs";
import { UnsavedChangesProvider } from "@/context/UnsavedChangesContext";
import type { ReportVariable, WorkflowConfigurations } from "@/types/workflow-configurations";

import { AgentUuidSection } from "./AgentUuidSection";
import { DictionarySection } from "./DictionarySection";
import { GeneralSection } from "./GeneralSection";
import { useOrganizationModelConfiguration } from "./hooks/useOrganizationModelConfiguration";
import { DeploymentCard, RecordingsCard } from "./LinkSectionCards";
import { ReportSection } from "./ReportSection";
import { TemplateVariablesSection } from "./TemplateVariablesSection";
import { VoicemailSection } from "./VoicemailSection";
import { WorkflowModelOverridesSection } from "./WorkflowModelOverridesSection";

export interface WorkflowSettingsDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    workflowId: number;
    workflowUuid?: string;
    workflowName: string;
    workflowConfigurations: WorkflowConfigurations | null;
    onSaveWorkflowConfigurations: (configurations: WorkflowConfigurations, newWorkflowName: string) => Promise<void>;
    templateContextVariables: Record<string, string>;
    onSaveTemplateContextVariables: (variables: Record<string, string>) => Promise<void>;
    dictionary: string;
    onSaveDictionary: (dictionary: string) => Promise<void>;
}

const SETTINGS_TABS = [
    { value: "general", label: "General" },
    { value: "models", label: "Model Overrides" },
    { value: "variables", label: "Variables" },
    { value: "dictionary", label: "Dictionary" },
    { value: "voicemail", label: "Voicemail" },
    { value: "recordings", label: "Recordings" },
    { value: "deployment", label: "Add to Website" },
    { value: "report", label: "Report" },
    { value: "identity", label: "Agent UUID" },
];

export function WorkflowSettingsDrawer(props: WorkflowSettingsDrawerProps) {
    return (
        <UnsavedChangesProvider>
            <WorkflowSettingsDrawerContent {...props} />
        </UnsavedChangesProvider>
    );
}

function WorkflowSettingsDrawerContent({
    isOpen,
    onClose,
    workflowId,
    workflowUuid,
    workflowName,
    workflowConfigurations,
    onSaveWorkflowConfigurations,
    templateContextVariables,
    onSaveTemplateContextVariables,
    dictionary,
    onSaveDictionary,
}: WorkflowSettingsDrawerProps) {
    const [activeTab, setActiveTab] = useState("general");
    const [isEmbedDialogOpen, setIsEmbedDialogOpen] = useState(false);
    const modelConfiguration = useOrganizationModelConfiguration();

    const safeConfigurations = useMemo<WorkflowConfigurations>(
        () => workflowConfigurations ?? ({} as WorkflowConfigurations),
        [workflowConfigurations],
    );

    const savedConfig = safeConfigurations as Record<string, unknown>;
    const [reportTemplate, setReportTemplate] = useState<string>(() => (savedConfig?.report_template as string) || "");
    const [reportVariables, setReportVariables] = useState<ReportVariable[]>(
        () => (savedConfig?.report_variables as ReportVariable[]) || [],
    );

    const handleSaveReportTemplate = useCallback((template: string, variables: ReportVariable[]) => {
        setReportTemplate(template);
        setReportVariables(variables);
    }, []);

    const visibleTabs = useMemo(() => {
        if (!workflowUuid) {
            return SETTINGS_TABS.filter((t) => t.value !== "identity");
        }
        return SETTINGS_TABS;
    }, [workflowUuid]);

    return (
        <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <SheetContent side="right" className="w-full sm:w-[560px] md:w-[640px] lg:w-[720px] sm:max-w-none">
                <SheetHeader>
                    <SheetTitle className="text-base font-semibold truncate pr-10">
                        Settings — {workflowName || "Voice Agent"}
                    </SheetTitle>
                    <SheetDescription className="sr-only">
                        Configure general settings, models, template variables, dictionary, and integrations.
                    </SheetDescription>
                </SheetHeader>

                <Tabs
                    value={activeTab}
                    onValueChange={setActiveTab}
                    className="flex min-h-0 flex-1 flex-col gap-0"
                >
                    {/* Fixed tab bar directly beneath title (identical to Org & Tools drawer pattern) */}
                    <div className="shrink-0 border-b border-border px-4 pb-3">
                        <UnderlineTabs
                            value={activeTab}
                            onValueChange={setActiveTab}
                            items={visibleTabs}
                        />
                    </div>

                    <SheetBody className="px-4 py-4 space-y-4">
                        <TabsContent value="general" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
                            <GeneralSection
                                workflowConfigurations={safeConfigurations}
                                workflowName={workflowName}
                                workflowId={workflowId}
                                onSave={onSaveWorkflowConfigurations}
                            />
                        </TabsContent>

                        <TabsContent value="models" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
                            <WorkflowModelOverridesSection
                                workflowConfigurations={safeConfigurations}
                                workflowName={workflowName}
                                onSave={onSaveWorkflowConfigurations}
                                modelConfigurationDefaults={modelConfiguration.defaults}
                                organizationModelConfiguration={modelConfiguration.configuration}
                                modelConfigurationLoading={modelConfiguration.isLoading}
                                modelConfigurationError={modelConfiguration.error}
                            />
                        </TabsContent>

                        <TabsContent value="variables" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
                            <TemplateVariablesSection
                                templateContextVariables={templateContextVariables}
                                onSave={onSaveTemplateContextVariables}
                            />
                        </TabsContent>

                        <TabsContent value="dictionary" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
                            <DictionarySection
                                dictionary={dictionary}
                                onSave={onSaveDictionary}
                            />
                        </TabsContent>

                        <TabsContent value="voicemail" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
                            <VoicemailSection
                                workflowConfigurations={safeConfigurations}
                                workflowName={workflowName}
                                onSave={onSaveWorkflowConfigurations}
                            />
                        </TabsContent>

                        <TabsContent value="recordings" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
                            <RecordingsCard />
                        </TabsContent>

                        <TabsContent value="deployment" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
                            <DeploymentCard onConfigure={() => setIsEmbedDialogOpen(true)} />
                        </TabsContent>

                        <TabsContent value="report" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
                            <ReportSection
                                workflowId={workflowId}
                                reportTemplate={reportTemplate}
                                reportVariables={reportVariables}
                                currentConfigurations={(safeConfigurations as Record<string, unknown>) || {}}
                                workflowConfigurations={safeConfigurations}
                                workflowName={workflowName}
                                onSaveTemplate={handleSaveReportTemplate}
                                onSave={onSaveWorkflowConfigurations}
                            />
                        </TabsContent>

                        {workflowUuid && (
                            <TabsContent value="identity" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
                                <AgentUuidSection workflowUuid={workflowUuid} />
                            </TabsContent>
                        )}
                    </SheetBody>

                    <SheetFooter className="justify-between">
                        <div>
                            <a
                                href="https://docs.autonomous-ai-os.enterprise/voice-agent/settings"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                            >
                                Docs
                                <ExternalLink className="h-3 w-3" />
                            </a>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={onClose}
                            >
                                Close
                            </Button>
                        </div>
                    </SheetFooter>
                </Tabs>

                <EmbedDialog
                    open={isEmbedDialogOpen}
                    onOpenChange={setIsEmbedDialogOpen}
                    workflowId={workflowId}
                    workflowName={workflowName}
                    templateContextVariables={templateContextVariables}
                />
            </SheetContent>
        </Sheet>
    );
}
