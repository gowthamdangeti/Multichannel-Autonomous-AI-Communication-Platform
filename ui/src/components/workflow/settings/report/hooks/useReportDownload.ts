"use client";

import { useState } from "react";
import { toast } from "sonner";

import { downloadWorkflowReportApiV1WorkflowWorkflowIdReportGet } from "@/client/sdk.gen";
import { useAuth } from "@/lib/auth";
import logger from "@/lib/logger";

/** ISO timestamp of `date` at `time` ("HH:MM"), or undefined without a date. */
function combineDateTime(date: Date | undefined, time: string): string | undefined {
    if (!date) return undefined;
    const [hours, minutes] = time.split(":").map(Number);
    const combined = new Date(date);
    combined.setHours(hours, minutes, 0, 0);
    return combined.toISOString();
}

function saveBlob(blob: Blob, filename: string) {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
}

/**
 * Date-range filter and download of a workflow's run report: a PDF bundle
 * when a report template exists, otherwise a CSV of completed runs.
 */
export function useReportDownload(workflowId: number, hasTemplate: boolean) {
    const { getAccessToken } = useAuth();
    const [startDate, setStartDate] = useState<Date | undefined>(undefined);
    const [startTime, setStartTime] = useState("00:00");
    const [endDate, setEndDate] = useState<Date | undefined>(undefined);
    const [endTime, setEndTime] = useState("23:59");
    const [isDownloading, setIsDownloading] = useState(false);

    const downloadPdf = async (start?: string, end?: string) => {
        const params = new URLSearchParams();
        if (start) params.set("start_date", start);
        if (end) params.set("end_date", end);
        const token = await getAccessToken();
        const response = await fetch(`/api/v1/workflow/${workflowId}/report/pdf?${params.toString()}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) {
            const err = await response.json().catch(() => null);
            throw new Error(err?.detail || "Failed to download PDF report");
        }
        saveBlob(await response.blob(), `workflow_${workflowId}_report.zip`);
    };

    const downloadCsv = async (start?: string, end?: string) => {
        const response = await downloadWorkflowReportApiV1WorkflowWorkflowIdReportGet({
            path: { workflow_id: workflowId },
            query: { start_date: start, end_date: end },
            parseAs: "blob",
        });
        if (response.data) saveBlob(response.data as Blob, `workflow_${workflowId}_report.csv`);
        else toast.error("Failed to download report");
    };

    const download = async () => {
        setIsDownloading(true);
        try {
            const start = combineDateTime(startDate, startTime);
            const end = combineDateTime(endDate, endTime);
            await (hasTemplate ? downloadPdf(start, end) : downloadCsv(start, end));
        } catch (err) {
            logger.error(`Failed to download workflow report: ${err}`);
            toast.error(err instanceof Error ? err.message : "Failed to download report");
        } finally {
            setIsDownloading(false);
        }
    };

    const clear = () => {
        setStartDate(undefined);
        setStartTime("00:00");
        setEndDate(undefined);
        setEndTime("23:59");
    };

    return {
        startDate, setStartDate, startTime, setStartTime,
        endDate, setEndDate, endTime, setEndTime,
        isFiltered: Boolean(startDate || endDate),
        isDownloading,
        download,
        clear,
    };
}
