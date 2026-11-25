"use client";

import { Loader2 } from "lucide-react";

import type { FolderResponse, WorkflowListResponse } from "@/client/types.gen";
import { Card, CardContent } from "@/components/ui/card";
import { CreateWorkflowButton } from "@/components/workflow/CreateWorkflowButton";
import { useVoiceAgents } from "@/components/workflow/voice-agents/hooks/useVoiceAgents";
import { VoiceAgentsToolbar } from "@/components/workflow/voice-agents/VoiceAgentsToolbar";
import { WorkflowTable } from "@/components/workflow/WorkflowTable";
import { PageHeader } from "@/context/HeaderContext";

interface WorkflowSearchWrapperProps {
    workflows?: WorkflowListResponse[];
    folders?: FolderResponse[];
}

export function WorkflowSearchWrapper({ workflows = [], folders = [] }: WorkflowSearchWrapperProps) {
    const agents = useVoiceAgents(workflows, folders);
    const { selectedFolder, selectedFolderLabel, visibleWorkflows, isArchivedView } = agents;

    const emptyMessage =
        selectedFolder === "all"
            ? "No active workflows found. Create your first workflow to get started."
            : isArchivedView
                ? "No archived agents."
                : `No agents in "${selectedFolderLabel}".`;

    return (
        <div className="flex flex-col gap-4 px-4 pt-2 pb-6 lg:px-6">
            <PageHeader
                title="Voice agents"
                subtitle="Create and manage voice agents for your workflows."
                onRefresh={() => void agents.refresh()}
                isRefreshing={agents.isRefreshing}
                primaryAction={<CreateWorkflowButton />}
                toolbar={
                    <VoiceAgentsToolbar
                        searchQuery={agents.searchQuery}
                        onSearchChange={agents.setSearchQuery}
                        folders={agents.folders}
                        selectedFolder={selectedFolder}
                        selectedFolderLabel={selectedFolderLabel}
                        archivedCount={agents.archivedCount}
                        onFolderSelect={agents.setSelectedFolder}
                        onFolderCreated={agents.handleFolderCreated}
                    />
                }
            />

            {agents.isLoading ? (
                <Card>
                    <CardContent className="flex items-center justify-center gap-2 p-12 text-center text-muted-foreground">
                        <Loader2 className="h-5 w-5 animate-spin text-primary" />
                        <span>Loading Voice Agents...</span>
                    </CardContent>
                </Card>
            ) : visibleWorkflows.length > 0 ? (
                <WorkflowTable
                    workflows={visibleWorkflows}
                    showArchived={isArchivedView}
                    folders={!isArchivedView && agents.folders.length > 0 ? agents.folders : undefined}
                    currentFolderId={agents.currentFolderId}
                    onMoved={agents.handleWorkflowMoved}
                    onStatusChanged={agents.handleWorkflowStatusChanged}
                />
            ) : (
                <Card>
                    <CardContent className="p-8 text-center text-muted-foreground">{emptyMessage}</CardContent>
                </Card>
            )}
        </div>
    );
}
