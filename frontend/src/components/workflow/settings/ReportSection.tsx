"use client";

import { Code, FileDown, Variable } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { ExtractedVariablesSheet, extractVariablesCount, ReportTemplateSheet } from "@/app/workflow/[workflowId]/settings/ReportTemplateSheet";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { ReportVariable, WorkflowConfigurations } from "@/types/workflow-configurations";

import { ReportDownloadPopover } from "./report/ReportDownloadPopover";

interface ReportSectionProps {
    workflowId: number;
    reportTemplate: string;
    reportVariables: ReportVariable[];
    currentConfigurations: Record<string, unknown>;
    workflowConfigurations: WorkflowConfigurations;
    workflowName: string;
    onSaveTemplate: (template: string, reportVariables: ReportVariable[]) => void;
    onSave: (configurations: WorkflowConfigurations, workflowName: string) => Promise<void>;
}

/** Auto-generated call reports: on/off, download, template and extracted variables. */
export function ReportSection({
    workflowId,
    reportTemplate,
    reportVariables,
    currentConfigurations,
    workflowConfigurations,
    workflowName,
    onSaveTemplate,
    onSave,
}: ReportSectionProps) {
    const [isTemplateSheetOpen, setIsTemplateSheetOpen] = useState(false);
    const [isVarSheetOpen, setIsVarSheetOpen] = useState(false);
    const [reportGenerationEnabled, setReportGenerationEnabled] = useState<boolean>(
        () => (currentConfigurations?.report_generation_enabled as boolean) ?? false,
    );
    const [isTogglingReport, setIsTogglingReport] = useState(false);

    const variableCount = useMemo(() => {
        if (reportVariables && reportVariables.length > 0) return reportVariables.length;
        return reportTemplate ? extractVariablesCount(reportTemplate) : 0;
    }, [reportVariables, reportTemplate]);

    const handleToggleReportGeneration = async (enabled: boolean) => {
        setReportGenerationEnabled(enabled);
        setIsTogglingReport(true);
        try {
            await onSave({ ...workflowConfigurations, report_generation_enabled: enabled } as WorkflowConfigurations, workflowName);
        } catch {
            setReportGenerationEnabled(!enabled);
            toast.error("Failed to update report generation setting");
        } finally {
            setIsTogglingReport(false);
        }
    };

    return (
        <>
            <Card id="report">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                        <FileDown className="h-4 w-4" />
                        Report
                    </CardTitle>
                    <CardDescription>
                        {reportTemplate
                            ? "Download a PDF report generated from your report template."
                            : "Download a CSV report of completed runs for this agent, optionally filtered by date range."}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                            <Label htmlFor="report-generation-toggle" className="text-sm font-medium">
                                Auto-generate reports
                            </Label>
                            <p className="text-xs text-muted-foreground">
                                Automatically generate a report after each call. You can still regenerate reports manually.
                            </p>
                        </div>
                        <Switch
                            id="report-generation-toggle"
                            checked={reportGenerationEnabled}
                            onCheckedChange={handleToggleReportGeneration}
                            disabled={isTogglingReport}
                        />
                    </div>
                </CardContent>
                {reportGenerationEnabled && (
                    <CardFooter className="flex flex-wrap justify-end gap-2 border-t pt-6">
                        <ReportDownloadPopover workflowId={workflowId} hasTemplate={Boolean(reportTemplate)} />
                        <Button variant="outline" onClick={() => setIsTemplateSheetOpen(true)}>
                            <Code className="h-4 w-4 mr-2" />
                            {reportTemplate ? "Edit Report Template" : "Add Report Template"}
                        </Button>
                        <Button variant="outline" onClick={() => setIsVarSheetOpen(true)}>
                            <Variable className="h-4 w-4 mr-2" />
                            Extracted Variables
                            {variableCount > 0 && (
                                <span className="ml-1.5 inline-flex items-center justify-center h-4 min-w-4 rounded-full bg-primary px-1.5 text-[10px] font-medium text-primary-foreground">
                                    {variableCount}
                                </span>
                            )}
                        </Button>
                    </CardFooter>
                )}
            </Card>

            <ReportTemplateSheet
                workflowId={workflowId}
                open={isTemplateSheetOpen}
                onOpenChange={setIsTemplateSheetOpen}
                initialTemplate={reportTemplate}
                initialReportVariables={reportVariables}
                currentConfigurations={currentConfigurations}
                onSave={onSaveTemplate}
            />
            <ExtractedVariablesSheet
                workflowId={workflowId}
                open={isVarSheetOpen}
                onOpenChange={setIsVarSheetOpen}
                template={reportTemplate}
                initialReportVariables={reportVariables}
                currentConfigurations={currentConfigurations}
                onSave={(vars) => onSaveTemplate(reportTemplate, vars)}
            />
        </>
    );
}
