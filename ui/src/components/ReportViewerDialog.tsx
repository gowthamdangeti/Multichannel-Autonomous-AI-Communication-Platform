"use client";

import { AlertCircle, Download, Loader2, RotateCw } from "lucide-react";
import { useCallback, useState } from "react";

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import { getBackendApiUrl } from "@/lib/apiClient";
import { useAuth } from "@/lib/auth";
import { downloadBlobWithName, getSignedUrl } from "@/lib/files";
import logger from "@/lib/logger";
import { buildReportPdfFilename } from "@/lib/reportFilename";
import { fetchRunReportHtml } from "@/lib/runReport";

export type ReportGenerationStatus = "pending" | "processing" | "completed" | "failed" | null;

export function ReportViewerDialog() {
    const { getAccessToken } = useAuth();
    const [isOpen, setIsOpen] = useState(false);
    const [htmlContent, setHtmlContent] = useState<string | null>(null);
    const [runId, setRunId] = useState<number | null>(null);
    const [agentName, setAgentName] = useState<string | null>(null);
    const [mediaLoading, setMediaLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [reportS3Key, setReportS3Key] = useState<string | null>(null);
    const [reportVariables, setReportVariables] = useState<Record<string, unknown> | null>(null);

    const [workflowId, setWorkflowId] = useState<number | null>(null);
    const [isRegenerating, setIsRegenerating] = useState(false);
    const [showCloseWarning, setShowCloseWarning] = useState(false);

    const openPreview = useCallback(
        async (
            wId: number,
            rId: number,
            initialAgentName?: string | null,
            storedReportKey?: string | null,
            runReportVariables?: Record<string, unknown> | null,
        ) => {
            setMediaLoading(true);
            setHtmlContent(null);
            setError(null);
            setReportS3Key(storedReportKey ?? null);
            setReportVariables(runReportVariables ?? null);
            setWorkflowId(wId > 0 ? wId : null);
            setRunId(rId);
            setAgentName(initialAgentName || null);
            setIsOpen(true);

            try {
                const token = await getAccessToken();
                const payload = await fetchRunReportHtml(wId, rId, token);

                if (payload.workflowId) {
                    setWorkflowId(payload.workflowId);
                }
                setHtmlContent(payload.renderedHtml);
                if (payload.agentName) {
                    setAgentName((prev) => prev || payload.agentName);
                }
            } catch (err) {
                logger.error(`Failed to load report for run ${rId}: ${err}`);
                setError(err instanceof Error ? err.message : "Failed to load report");
            } finally {
                setMediaLoading(false);
            }
        },
        [getAccessToken],
    );

    const openCampaignPreview = useCallback(
        async (campaignId: number, initialCampaignName?: string | null) => {
            setMediaLoading(true);
            setHtmlContent(null);
            setError(null);
            setReportS3Key(null);
            setReportVariables(null);
            setWorkflowId(null);
            setRunId(null);
            setAgentName(initialCampaignName || null);
            setIsOpen(true);

            try {
                const token = await getAccessToken();
                const baseUrl = getBackendApiUrl();
                const response = await fetch(
                    `${baseUrl}/api/v1/campaign/${campaignId}/report/preview`,
                    {
                        headers: {
                            Authorization: `Bearer ${token}`,
                            'ngrok-skip-browser-warning': 'true',
                        },
                    }
                );

                const contentType = response.headers.get("content-type") || "";

                if (!response.ok) {
                    let errorMessage = "Failed to load campaign report";
                    if (contentType.includes("application/json")) {
                        const err = await response.json().catch(() => null);
                        if (err?.detail) errorMessage = err.detail;
                    } else {
                        const text = await response.text().catch(() => "");
                        if (text) errorMessage = text.slice(0, 250);
                    }
                    throw new Error(errorMessage);
                }

                const responseText = await response.text();
                let data: { rendered_html?: string; campaign_name?: string } = {};
                try {
                    data = JSON.parse(responseText);
                } catch {
                    // Raw HTML response fallback
                    setHtmlContent(responseText);
                    return;
                }

                if (data.rendered_html) {
                    setHtmlContent(data.rendered_html);
                } else {
                    setHtmlContent(responseText);
                }

                if (data.campaign_name) {
                    setAgentName(data.campaign_name);
                }
            } catch (err) {
                logger.error(`Failed to load campaign report for ${campaignId}: ${err}`);
                setError(err instanceof Error ? err.message : "Failed to load campaign report");
            } finally {
                setMediaLoading(false);
            }
        },
        [getAccessToken],
    );

    const handleRegenerateInDrawer = useCallback(async () => {
        if (!runId || isRegenerating) return;
        const targetWfId = workflowId || 0;

        setIsRegenerating(true);
        setError(null);
        setMediaLoading(true);

        try {
            const token = await getAccessToken();
            const baseUrl = getBackendApiUrl();

            const response = await fetch(
                `${baseUrl}/api/v1/workflow/${targetWfId}/runs/${runId}/report/regenerate`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'ngrok-skip-browser-warning': 'true',
                    },
                }
            );

            if (!response.ok) {
                const body = await response.json().catch(() => null);
                throw new Error(body?.detail || 'Failed to queue report regeneration');
            }

            // Poll for the updated report (large templates need minutes)
            let attempts = 0;
            const maxAttempts = 90; // 180 seconds timeout
            const pollInterval = window.setInterval(async () => {
                attempts += 1;
                try {
                    const pollRes = await fetch(
                        `${baseUrl}/api/v1/workflow/${targetWfId}/runs/${runId}/report`,
                        {
                            headers: {
                                Authorization: `Bearer ${token}`,
                                'ngrok-skip-browser-warning': 'true',
                            },
                        }
                    );

                    if (pollRes.ok) {
                        const responseText = await pollRes.text();
                        let data: {
                            rendered_html?: string;
                            is_ready?: boolean;
                            report_generation_status?: string | null;
                            report_diagnostics?: { generation_status?: string | null };
                        } = {};
                        try {
                            data = JSON.parse(responseText);
                        } catch {
                            // Raw HTML has no status — keep waiting for completed.
                            return;
                        }

                        const status = data.report_generation_status
                            ?? data.report_diagnostics?.generation_status
                            ?? null;
                        if (status === "failed") {
                            window.clearInterval(pollInterval);
                            setMediaLoading(false);
                            setIsRegenerating(false);
                            setError("Report generation failed (LLM quota or extraction error). Please try again.");
                            return;
                        }
                        if ((data.is_ready === true || status === "completed") && data.rendered_html) {
                            setHtmlContent(data.rendered_html);
                            window.clearInterval(pollInterval);
                            setMediaLoading(false);
                            setIsRegenerating(false);
                            return;
                        }
                        // pending/processing or stale response — keep polling, keep loader.
                    }
                } catch {
                    // Keep polling while backend report generation is pending/processing
                }

                if (attempts >= maxAttempts) {
                    window.clearInterval(pollInterval);
                    setMediaLoading(false);
                    setIsRegenerating(false);
                    setError("Regeneration is taking longer than expected. Please refresh preview in a moment.");
                }
            }, 2000);
        } catch (err) {
            logger.error(`Failed to regenerate report: ${err}`);
            setError(err instanceof Error ? err.message : 'Failed to queue report regeneration');
            setIsRegenerating(false);
            setMediaLoading(false);
        }
    }, [runId, workflowId, isRegenerating, getAccessToken]);

    const handleSheetOpenChange = useCallback((open: boolean) => {
        if (!open && isRegenerating) {
            setShowCloseWarning(true);
            return;
        }
        setIsOpen(open);
    }, [isRegenerating]);

    const downloadPdf = useCallback(async () => {
        // Stored PDF (report_s3_key) — download the real rendered PDF with a
        // human-readable filename: {Title}_conv_{runId}.pdf when a title
        // variable exists, else {agentName}_conv_{runId}.pdf.
        if (reportS3Key) {
            const signedUrl = await getSignedUrl(reportS3Key);
            if (signedUrl) {
                const filename = buildReportPdfFilename({
                    reportVariables,
                    agentName,
                    runId,
                });
                await downloadBlobWithName(signedUrl, filename);
                return;
            }
        }
        // Preview-only fallback: print the rendered HTML to PDF.
        if (!htmlContent) return;

        const win = window.open("", "_blank");
        if (!win) return;
        win.document.write(htmlContent);
        win.document.close();
        win.focus();
        win.print();
    }, [reportS3Key, reportVariables, agentName, runId, htmlContent]);

    return {
        openPreview,
        openCampaignPreview,
        dialog: (
            <>
                <Sheet open={isOpen} onOpenChange={handleSheetOpenChange}>
                    <SheetContent side="right" className="w-full sm:w-[45%] sm:max-w-[45%] flex flex-col">
                        <SheetHeader className="pb-3 border-b border-border shrink-0">
                            <SheetTitle>
                                Report
                                {agentName ? ` - ${agentName}` : runId ? ` - Run #${runId}` : ""}
                            </SheetTitle>
                            <SheetDescription className="sr-only">
                                Report preview {agentName ? `for ${agentName}` : runId ? `for run #${runId}` : ""}
                            </SheetDescription>
                        </SheetHeader>

                        <div className="flex-1 min-h-0 overflow-y-auto h-full">
                            {mediaLoading && (
                                <div className="flex flex-col items-center justify-center h-full space-y-3 p-6 text-center">
                                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                                    <span className="text-sm font-medium text-muted-foreground">
                                        {isRegenerating ? "Regenerating executive report via LLM..." : "Loading report..."}
                                    </span>
                                </div>
                            )}

                            {!mediaLoading && error && (
                                <div className="flex items-center justify-center h-full text-destructive p-4 text-center">
                                    {error}
                                </div>
                            )}

                            {!mediaLoading && htmlContent && (
                                <iframe
                                    srcDoc={htmlContent}
                                    className="w-full h-full min-h-[70vh] border-0"
                                    title="Report"
                                    sandbox="allow-same-origin"
                                />
                            )}
                        </div>

                        <SheetFooter className="border-t border-border/60 bg-card/95 px-4 py-2.5 shrink-0">
                            <div className="flex items-center justify-between w-full">
                                <div>
                                    {Boolean(runId) && (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="h-8 text-xs px-3.5 font-semibold gap-1.5 shrink-0 cursor-pointer text-foreground hover:text-primary hover:border-primary/50 transition-colors"
                                            onClick={handleRegenerateInDrawer}
                                            disabled={isRegenerating || mediaLoading}
                                        >
                                            {isRegenerating ? (
                                                <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                                            ) : (
                                                <RotateCw className="h-3.5 w-3.5 shrink-0" />
                                            )}
                                            {isRegenerating ? "Regenerating..." : "Regenerate Report"}
                                        </Button>
                                    )}
                                </div>

                                <div className="flex items-center gap-2.5">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-8 text-xs px-4 font-medium shrink-0 cursor-pointer"
                                        onClick={() => handleSheetOpenChange(false)}
                                    >
                                        Close
                                    </Button>

                                    {htmlContent && (
                                        <Button
                                            size="sm"
                                            className="h-8 text-xs px-4 font-medium gap-1.5 shrink-0 cursor-pointer"
                                            onClick={downloadPdf}
                                        >
                                            <Download className="h-3.5 w-3.5 shrink-0" />
                                            Download PDF
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </SheetFooter>
                    </SheetContent>
                </Sheet>

                <AlertDialog open={showCloseWarning} onOpenChange={setShowCloseWarning}>
                    <AlertDialogContent className="sm:max-w-md">
                        <AlertDialogHeader>
                            <AlertDialogTitle className="flex items-center gap-2 text-base">
                                <AlertCircle className="h-5 w-5 text-amber-500 shrink-0" />
                                Report Generation in Progress
                            </AlertDialogTitle>
                            <AlertDialogDescription className="text-xs leading-relaxed text-muted-foreground pt-1">
                                An executive report is currently being extracted and rendered via LLM. Closing the drawer now will let generation complete in the background. Are you sure you want to close?
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter className="mt-4 gap-2">
                            <AlertDialogCancel
                                className="h-8 text-xs font-medium"
                                onClick={() => setShowCloseWarning(false)}
                            >
                                Keep Drawer Open
                            </AlertDialogCancel>
                            <AlertDialogAction
                                className="h-8 text-xs font-medium"
                                onClick={() => {
                                    setShowCloseWarning(false);
                                    setIsOpen(false);
                                }}
                            >
                                Close Drawer
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </>
        ),
    };
}
