"use client";

import { Sparkles } from "lucide-react";

import type { WorkflowSummaryResponse } from "@/client/types.gen";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

import { DetailSection } from "./DetailSection";

interface CampaignBasicDetailsSectionProps {
    campaignName: string;
    onCampaignNameChange: (val: string) => void;
    selectedWorkflowId: string;
    onSelectedWorkflowIdChange: (val: string) => void;
    workflows: WorkflowSummaryResponse[];
    isLoadingWorkflows: boolean;
    requiredCsvColumns: string[];
    isLoadingRequiredCsvColumns: boolean;
}

export function CampaignBasicDetailsSection({
    campaignName,
    onCampaignNameChange,
    selectedWorkflowId,
    onSelectedWorkflowIdChange,
    workflows,
    isLoadingWorkflows,
    requiredCsvColumns,
    isLoadingRequiredCsvColumns,
}: CampaignBasicDetailsSectionProps) {
    const selectedWorkflow = workflows.find((w) => String(w.id) === selectedWorkflowId);

    return (
        <div className="space-y-4">
            <DetailSection
                title="Campaign Identity"
                description="Choose a memorable name to identify this outbound voice campaign."
            >
                <div className="space-y-1.5">
                    <Label htmlFor="campaign-name" className="text-xs font-semibold">
                        Campaign Name <span className="text-destructive">*</span>
                    </Label>
                    <Input
                        id="campaign-name"
                        placeholder="e.g. Q4 Inbound Leads Follow-up"
                        value={campaignName}
                        onChange={(e) => onCampaignNameChange(e.target.value)}
                        maxLength={255}
                        className="h-8 text-xs"
                        required
                    />
                    <p className="text-[10px] text-muted-foreground">
                        Clear names help distinguish campaigns in analytics and billing logs.
                    </p>
                </div>
            </DetailSection>

            <DetailSection
                title="Workflow Agent"
                description="Select the voice agent workflow that will execute on every dispatched call."
            >
                <div className="space-y-3">
                    <div className="space-y-1.5">
                        <Label htmlFor="workflow-select" className="text-xs font-semibold">
                            Workflow <span className="text-destructive">*</span>
                        </Label>
                        <Select
                            value={selectedWorkflowId}
                            onValueChange={onSelectedWorkflowIdChange}
                        >
                            <SelectTrigger id="workflow-select" className="h-8 text-xs">
                                <SelectValue placeholder="Select a workflow" />
                            </SelectTrigger>
                            <SelectContent>
                                {isLoadingWorkflows ? (
                                    <SelectItem value="loading" disabled>
                                        Loading workflows…
                                    </SelectItem>
                                ) : workflows.length === 0 ? (
                                    <SelectItem value="none" disabled>
                                        No active workflows found
                                    </SelectItem>
                                ) : (
                                    workflows.map((wf) => (
                                        <SelectItem key={wf.id} value={String(wf.id)}>
                                            {wf.name} (#{wf.id})
                                        </SelectItem>
                                    ))
                                )}
                            </SelectContent>
                        </Select>
                    </div>

                    {selectedWorkflow && (
                        <div className="rounded-md border border-primary/30 bg-primary/5 p-2.5 flex items-center gap-2">
                            <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
                            <div className="text-[11px] min-w-0">
                                <p className="font-semibold text-foreground truncate">
                                    Selected Agent: {selectedWorkflow.name}
                                </p>
                                <p className="text-muted-foreground text-[10px]">
                                    Workflow ID #{selectedWorkflow.id} ready for execution.
                                </p>
                            </div>
                        </div>
                    )}

                    {selectedWorkflowId && (
                        <div className="rounded-md border border-dashed border-border bg-muted/30 p-2.5 text-xs space-y-1">
                            <p className="font-semibold text-foreground text-xs">Required CSV columns</p>
                            {isLoadingRequiredCsvColumns ? (
                                <p className="text-muted-foreground text-[11px]">Checking workflow variables…</p>
                            ) : requiredCsvColumns.length > 0 ? (
                                <>
                                    <p className="text-muted-foreground text-[11px]">
                                        Your CSV file must include these headers. Each contact row must provide values for:
                                    </p>
                                    <div className="mt-1 flex flex-wrap gap-1.5">
                                        {requiredCsvColumns.map((col) => (
                                            <code
                                                key={col}
                                                className="rounded bg-background px-1.5 py-0.5 text-[10px] font-mono border border-border"
                                            >
                                                {col}
                                            </code>
                                        ))}
                                    </div>
                                </>
                            ) : (
                                <p className="text-muted-foreground text-[11px]">
                                    No custom variables detected. Your CSV only requires a{" "}
                                    <code className="font-mono bg-background px-1 rounded text-[10px] border border-border">
                                        phone_number
                                    </code>{" "}
                                    column.
                                </p>
                            )}
                        </div>
                    )}
                </div>
            </DetailSection>
        </div>
    );
}
