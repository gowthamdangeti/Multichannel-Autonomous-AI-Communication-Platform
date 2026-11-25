"use client";

import { AlertCircle, Eye, LoaderCircle } from "lucide-react";
import { useState } from "react";

import { WorkflowError } from "@/client/types.gen";
import { GitHubStarBadge } from "@/components/layout/GitHubStarBadge";
import { Button } from "@/components/ui/button";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";

interface WorkflowEditorHeaderProps {
    isDirty: boolean;
    workflowValidationErrors: WorkflowError[];
    saveWorkflow: (updateWorkflowDefinition?: boolean) => Promise<void>;
    activeVersionLabel?: string;
    isViewingHistoricalVersion: boolean;
    onBackToDraft: () => void;
}

/**
 * Workflow editor status row: read-only banner, validation count and the
 * save button. Agent actions (Phone Call, Test Agent, View Agent, More menu)
 * live in the app top bar's breadcrumb section via PageHeader actions.
 */
export const WorkflowEditorHeader = ({
    isDirty,
    workflowValidationErrors,
    saveWorkflow,
    activeVersionLabel,
    isViewingHistoricalVersion,
    onBackToDraft,
}: WorkflowEditorHeaderProps) => {
    const [savingWorkflow, setSavingWorkflow] = useState(false);

    const hasValidationErrors = workflowValidationErrors.length > 0;

    const handleSave = async () => {
        setSavingWorkflow(true);
        await saveWorkflow();
        setSavingWorkflow(false);
    };

    return (
        <header className="flex h-12 shrink-0 items-center justify-end gap-1.5 sm:gap-2 px-5 w-full bg-transparent">
            {/* Read-only banner when viewing a historical version */}
            {isViewingHistoricalVersion && (
                <div className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 rounded-md border border-border bg-muted text-muted-foreground" title={`Viewing ${activeVersionLabel} - Read only`}>
                    <Eye className="w-4 h-4" />
                    <span className="text-sm hidden sm:inline">
                        Viewing {activeVersionLabel} - Read only
                    </span>
                </div>
            )}

            {/* Back to Draft button when viewing history */}
            {isViewingHistoricalVersion && (
                <Button
                    onClick={onBackToDraft}
                    className="px-3 sm:px-4 text-sm"
                >
                    Back to Draft
                </Button>
            )}

            {/* Validation errors indicator */}
            {hasValidationErrors && (
                <Popover>
                    <PopoverTrigger asChild>
                        <Button
                            variant="outline"
                            className="flex items-center gap-1.5 sm:gap-2 h-9 px-2 sm:px-3 border-destructive text-destructive hover:bg-destructive/10"
                        >
                            <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-destructive animate-pulse" />
                            <AlertCircle className="w-4 h-4 text-destructive" />
                            <span className="text-sm hidden sm:inline">
                                {workflowValidationErrors.length} {workflowValidationErrors.length === 1 ? "error" : "errors"}
                            </span>
                            <span className="text-sm sm:hidden">
                                {workflowValidationErrors.length}
                            </span>
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent
                        align="end"
                        className="w-80 bg-popover border-border p-0 text-popover-foreground"
                    >
                        <div className="px-4 py-3 border-b border-border">
                            <h3 className="text-sm font-medium text-foreground">Validation Errors</h3>
                        </div>
                        <div className="max-h-64 overflow-y-auto">
                            {workflowValidationErrors.map((error, index) => (
                                <div
                                    key={index}
                                    className="px-4 py-3 border-b border-border last:border-b-0"
                                >
                                    <div className="flex items-start gap-2">
                                        <AlertCircle className="w-4 h-4 text-destructive mt-0.5 flex-shrink-0" />
                                        <div className="flex-1 min-w-0">
                                            {(error.kind === "node" || error.kind === "edge") && error.id && (
                                                <p className="text-xs text-muted-foreground mb-1">
                                                    {error.kind === "node" ? "Node" : "Edge"}: {error.id}
                                                    {error.field && <span className="text-muted-foreground/60"> • {error.field}</span>}
                                                </p>
                                            )}
                                            <p className="text-sm text-foreground break-words">
                                                {error.message}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </PopoverContent>
                </Popover>
            )}

            {/* Save button (only displayed when there are unsaved node/workflow changes) */}
            {!isViewingHistoricalVersion && isDirty && (
                <Button
                    onClick={handleSave}
                    disabled={savingWorkflow}
                    className="px-3 sm:px-4 h-9"
                >
                    {savingWorkflow ? (
                        <>
                            <LoaderCircle className="w-4 h-4 sm:mr-2 animate-spin" />
                            <span className="hidden sm:inline">Saving...</span>
                        </>
                    ) : (
                        "Save"
                    )}
                </Button>
            )}

            {/* GitHub star badge - desktop only */}
            <div className="hidden md:block">
                <GitHubStarBadge className="border-border bg-muted text-foreground [&_span]:bg-transparent" source="workflow_editor_header" />
            </div>
        </header>
    );
};
