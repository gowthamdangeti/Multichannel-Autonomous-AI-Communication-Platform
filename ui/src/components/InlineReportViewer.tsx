"use client";

import { AlertCircle, Download, FileText, Loader2, RotateCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { ReportGenerationStatus } from "@/components/ReportViewerDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/lib/auth";
import { downloadBlobWithName, getSignedUrl } from "@/lib/files";
import logger from "@/lib/logger";
import { buildReportPdfFilename } from "@/lib/reportFilename";
import { fetchCampaignReportHtml, fetchRunReportHtml } from "@/lib/runReport";
import { cn } from "@/lib/utils";

const NO_SCROLLBAR_STYLE = `
<style>
  html, body {
    scrollbar-width: none !important;
    -ms-overflow-style: none !important;
    overflow-y: auto !important;
  }
  html::-webkit-scrollbar, body::-webkit-scrollbar, *::-webkit-scrollbar {
    display: none !important;
    width: 0 !important;
    height: 0 !important;
  }
</style>
`;

/** Which report to show: one run's, or a whole campaign's. */
export type InlineReportSource =
    | { kind: "run"; workflowId: number; runId: number }
    | { kind: "campaign"; campaignId: number };

interface InlineReportViewerProps {
    source: InlineReportSource;
    title?: string;
    subtitle?: string;
    agentName?: string | null;
    reportS3Key?: string | null;
    reportVariables?: Record<string, unknown> | null;
    reportStatus?: ReportGenerationStatus;
    onRegenerate?: () => void;
    isRegenerating?: boolean;
    /** Label of the regenerate button (e.g. "Generate report" when none exists yet). */
    regenerateLabel?: string;
    className?: string;
    style?: React.CSSProperties;
}

/**
 * Inline Report view — same rendered executive report the drawer shows
 * (`ReportViewerDialog`), rendered directly in the page instead of a sheet.
 * Used by the conversation page (a run's report) and the campaign page.
 */
export function InlineReportViewer({
    source,
    title,
    subtitle,
    agentName,
    reportS3Key,
    reportVariables,
    reportStatus,
    onRegenerate,
    isRegenerating = false,
    regenerateLabel = "Regenerate Report",
    className,
    style,
}: InlineReportViewerProps) {
    const { getAccessToken } = useAuth();
    const [htmlContent, setHtmlContent] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const wasRegenerating = useRef(false);
    const sourceKey = source.kind === "run" ? `run:${source.workflowId}:${source.runId}` : `campaign:${source.campaignId}`;
    const sourceLabel = source.kind === "run" ? `run ${source.runId}` : `campaign ${source.campaignId}`;
    const runId = source.kind === "run" ? source.runId : null;

    const loadReport = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const token = await getAccessToken();
            const html = source.kind === "run"
                ? (await fetchRunReportHtml(source.workflowId, source.runId, token)).renderedHtml
                : await fetchCampaignReportHtml(source.campaignId, token);
            setHtmlContent(html);
        } catch (err) {
            logger.error(`Failed to load ${sourceLabel} report: ${err}`);
            setError(err instanceof Error ? err.message : "Failed to load report");
        } finally {
            setIsLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- sourceKey identifies `source`
    }, [sourceKey, getAccessToken]);

    useEffect(() => {
        void loadReport();
    }, [loadReport]);

    // Pull the freshly generated report once an in-flight regeneration finishes.
    useEffect(() => {
        if (wasRegenerating.current && !isRegenerating) {
            void loadReport();
        }
        wasRegenerating.current = isRegenerating;
    }, [isRegenerating, loadReport]);

    const downloadPdf = useCallback(async () => {
        // Stored PDF (report_s3_key) — download the real rendered PDF with a
        // human-readable filename, else fall back to printing the preview HTML.
        if (reportS3Key) {
            const signedUrl = await getSignedUrl(reportS3Key);
            if (signedUrl) {
                const filename = buildReportPdfFilename({ reportVariables, agentName, runId });
                await downloadBlobWithName(signedUrl, filename);
                return;
            }
        }
        if (!htmlContent) return;

        const win = window.open("", "_blank");
        if (!win) return;
        win.document.write(htmlContent);
        win.document.close();
        win.focus();
        win.print();
    }, [reportS3Key, reportVariables, agentName, runId, htmlContent]);

    const isBusy = isRegenerating || reportStatus === "processing" || reportStatus === "pending";
    const isCampaign = source.kind === "campaign";
    const headerTitle = title ?? (isCampaign ? "Campaign Report" : "Report");
    const headerSubtitle = subtitle ?? (isCampaign ? "Summary report across every call in this campaign" : undefined);

    const processedHtml = htmlContent
        ? (htmlContent.includes("</head>")
            ? htmlContent.replace("</head>", `${NO_SCROLLBAR_STYLE}</head>`)
            : `${NO_SCROLLBAR_STYLE}${htmlContent}`)
        : null;

    return (
        <Card
            style={style}
            className={cn(
                "border-border shadow-sm overflow-hidden bg-card h-full flex flex-col [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden",
                !style?.height && "min-h-[820px]",
                className
            )}
        >
            <CardHeader className="p-4 sm:p-5 pb-3 border-b border-border/40 flex-row items-center justify-between space-y-0 shrink-0 gap-3">
                <div className="min-w-0 space-y-0.5">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                        <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span>{headerTitle}</span>
                        {agentName ? <span className="text-muted-foreground font-normal truncate">— {agentName}</span> : null}
                    </CardTitle>
                    {headerSubtitle && (
                        <p className="text-xs text-muted-foreground">{headerSubtitle}</p>
                    )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    {onRegenerate && (
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-8 text-xs px-3.5 font-semibold gap-1.5 cursor-pointer"
                            onClick={onRegenerate}
                            disabled={isBusy}
                        >
                            {isRegenerating ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                            ) : (
                                <RotateCw className="h-3.5 w-3.5 shrink-0" />
                            )}
                            {isRegenerating ? "Regenerating..." : regenerateLabel}
                        </Button>
                    )}
                    <Button
                        size="sm"
                        className="h-8 text-xs px-4 font-medium gap-1.5 cursor-pointer"
                        onClick={downloadPdf}
                        disabled={!htmlContent || isLoading}
                    >
                        <Download className="h-3.5 w-3.5 shrink-0" />
                        Download PDF
                    </Button>
                </div>
            </CardHeader>

            <CardContent className="p-0 flex-1 min-h-0 overflow-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                {isLoading ? (
                    <div className="flex flex-col items-center justify-center h-full space-y-3 p-6 text-center">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        <span className="text-sm font-medium text-muted-foreground">
                            {isRegenerating ? "Regenerating executive report via LLM..." : "Loading report..."}
                        </span>
                    </div>
                ) : error ? (
                    <div className="flex flex-col items-center justify-center h-full gap-2 p-6 text-center">
                        <AlertCircle className="h-7 w-7 text-destructive" />
                        <span className="text-sm text-destructive">{error}</span>
                        <Button variant="outline" size="sm" className="h-8 text-xs cursor-pointer" onClick={loadReport}>
                            <RotateCw className="h-3.5 w-3.5 mr-1.5" />
                            Retry
                        </Button>
                    </div>
                ) : processedHtml ? (
                    <iframe
                        srcDoc={processedHtml}
                        className="w-full h-full border-0 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
                        title="Report"
                        sandbox="allow-same-origin"
                        scrolling="yes"
                        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
                    />
                ) : (
                    <div className="flex items-center justify-center h-full p-6 text-sm text-muted-foreground">
                        No report available for this {isCampaign ? "campaign" : "run"}.
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
