"use client";

import { useMemo, useState } from "react";

import { EmbedDialog } from "@/app/workflow/[workflowId]/components/EmbedDialog";
import type { WorkflowResponse } from "@/client/types.gen";
type WorkflowResponseWithUtilization = WorkflowResponse & {
    utilization_type?: string | null;
    private_allowed_user_ids?: number[] | null;
    created_by_user_id?: number | null;
    is_creator?: boolean;
};
import { type Breadcrumb, PageHeader } from "@/context/HeaderContext";
import { UnsavedChangesProvider } from "@/context/UnsavedChangesContext";

import { AgentUuidSection } from "./AgentUuidSection";
import { DictionarySection } from "./DictionarySection";
import { GeneralSection } from "./GeneralSection";
import { useOrganizationModelConfiguration } from "./hooks/useOrganizationModelConfiguration";
import { type SettingsUser, useWorkflowSettingsState } from "./hooks/useWorkflowSettingsState";
import { DeploymentCard, RecordingsCard } from "./LinkSectionCards";
import { ReportSection } from "./ReportSection";
import { SettingsNav } from "./SettingsNav";
import { TemplateVariablesSection } from "./TemplateVariablesSection";
import { UtilisationSection } from "./UtilisationSection";
import { VoicemailSection } from "./VoicemailSection";
import { WorkflowModelOverridesSection } from "./WorkflowModelOverridesSection";

interface WorkflowSettingsViewProps {
    workflow: WorkflowResponseWithUtilization;
    user: SettingsUser;
}

/**
 * Agent settings page body. Mounts only once the workflow is fetched, so the
 * workflow store always initialises with real data.
 */
export function WorkflowSettingsContent(props: WorkflowSettingsViewProps) {
    return (
        <UnsavedChangesProvider>
            <WorkflowSettingsView {...props} />
        </UnsavedChangesProvider>
    );
}

function WorkflowSettingsView({ workflow, user }: WorkflowSettingsViewProps) {
    const [isEmbedDialogOpen, setIsEmbedDialogOpen] = useState(false);
    const [activeSection, setActiveSection] = useState("general");
    const modelConfiguration = useOrganizationModelConfiguration();
    const state = useWorkflowSettingsState(workflow, user);
    const { workflowConfigurations, saveWorkflowConfigurations } = state;
    const workflowName = state.workflowName || workflow.name;

    const breadcrumbs = useMemo<Breadcrumb[]>(
        () => [
            { label: "Voice agents", href: "/voice/agents" },
            { label: workflowName || `Agent #${workflow.id}`, href: `/voice/agents/${workflow.id}` },
            { label: "Settings" },
        ],
        [workflowName, workflow.id],
    );

    return (
        <div className="h-full flex flex-col">
            <PageHeader
                title={`${workflowName || "Agent"} Settings`}
                breadcrumbs={breadcrumbs}
            />

            {workflowConfigurations && (
                <div className="flex-1 w-full min-h-0 flex flex-col overflow-hidden px-4 lg:px-6 pt-3 pb-4">
                    <div className="flex flex-1 w-full min-h-0 gap-4 lg:gap-5 items-stretch">
                        <SettingsNav activeSection={activeSection} onSelect={setActiveSection} />

                        <div className="flex-1 min-w-0 overflow-y-auto space-y-8 px-1">
                            {activeSection === "general" && (
                                <GeneralSection
                                    workflowConfigurations={workflowConfigurations}
                                    workflowName={workflowName}
                                    workflowId={workflow.id}
                                    onSave={saveWorkflowConfigurations}
                                />
                            )}
                            {activeSection === "models" && (
                                <WorkflowModelOverridesSection
                                    workflowConfigurations={workflowConfigurations}
                                    workflowName={state.workflowName}
                                    onSave={saveWorkflowConfigurations}
                                    modelConfigurationDefaults={modelConfiguration.defaults}
                                    organizationModelConfiguration={modelConfiguration.configuration}
                                    modelConfigurationLoading={modelConfiguration.isLoading}
                                    modelConfigurationError={modelConfiguration.error}
                                />
                            )}
                            {activeSection === "utilisation" && (
                                <UtilisationSection
                                    workflowId={workflow.id}
                                    workflowName={workflowName}
                                    utilizationType={workflow.utilization_type}
                                    privateAllowedUserIds={workflow.private_allowed_user_ids}
                                    creatorUserId={workflow.created_by_user_id ?? null}
                                    isCreator={workflow.is_creator ?? false}
                                />
                            )}
                            {activeSection === "variables" && (
                                <TemplateVariablesSection
                                    templateContextVariables={state.templateContextVariables}
                                    onSave={state.saveTemplateContextVariables}
                                />
                            )}
                            {activeSection === "dictionary" && (
                                <DictionarySection dictionary={state.dictionary} onSave={state.saveDictionary} />
                            )}
                            {activeSection === "voicemail" && (
                                <VoicemailSection
                                    workflowConfigurations={workflowConfigurations}
                                    workflowName={state.workflowName}
                                    onSave={saveWorkflowConfigurations}
                                />
                            )}
                            {activeSection === "recordings" && <RecordingsCard />}
                            {activeSection === "deployment" && <DeploymentCard onConfigure={() => setIsEmbedDialogOpen(true)} />}
                            {activeSection === "report" && (
                                <ReportSection
                                    workflowId={workflow.id}
                                    reportTemplate={state.reportTemplate}
                                    reportVariables={state.reportVariables}
                                    currentConfigurations={(workflowConfigurations as Record<string, unknown>) || {}}
                                    workflowConfigurations={workflowConfigurations}
                                    workflowName={workflowName}
                                    onSaveTemplate={state.saveReportTemplate}
                                    onSave={saveWorkflowConfigurations}
                                />
                            )}
                            {activeSection === "identity" && workflow.workflow_uuid && (
                                <AgentUuidSection workflowUuid={workflow.workflow_uuid} />
                            )}
                        </div>
                    </div>
                </div>
            )}

            <EmbedDialog
                open={isEmbedDialogOpen}
                onOpenChange={setIsEmbedDialogOpen}
                workflowId={workflow.id}
                workflowName={workflowName}
                templateContextVariables={state.templateContextVariables}
            />
        </div>
    );
}
