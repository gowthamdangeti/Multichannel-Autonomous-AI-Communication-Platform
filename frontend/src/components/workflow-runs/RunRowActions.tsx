"use client";

import { AlertCircle, Clock, FileText, Headphones, Loader2, Video } from "lucide-react";

import { RowAction } from "@/components/layout/RowActionsMenu";

interface RunMediaActionProps {
  recordingUrl: string | null | undefined;
  transcriptUrl: string | null | undefined;
  fallbackRecordingUrl?: string | null | undefined;
  videoUrl?: string | null | undefined;
  runId: number;
  // Hidden when the run has no recording, video, or transcript.
  onOpenPreview: (
    recordingUrl: string | null,
    transcriptUrl: string | null,
    runId: number,
    videoUrl?: string | null,
  ) => void | Promise<void>;
  onSelect?: (runId: number) => void;
}

// Hidden when the run has neither a recording, video, nor a transcript.
export function RunMediaAction({
  recordingUrl,
  transcriptUrl,
  fallbackRecordingUrl,
  videoUrl,
  runId,
  onOpenPreview,
  onSelect,
}: RunMediaActionProps) {
  const effectiveRecordingUrl = recordingUrl ?? fallbackRecordingUrl ?? null;
  if (!effectiveRecordingUrl && !transcriptUrl && !videoUrl) return null;

  return (
    <RowAction
      icon={videoUrl ? <Video /> : <Headphones />}
      onClick={() => {
        onSelect?.(runId);
        onOpenPreview(effectiveRecordingUrl, transcriptUrl ?? null, runId, videoUrl ?? null);
      }}
    >
      {videoUrl ? "Media preview" : "Recording & transcript"}
    </RowAction>
  );
}

type ReportStatus = "pending" | "processing" | "completed" | "failed" | null;

interface RunReportActionProps {
  workflowId: number;
  runId: number;
  agentName?: string | null;
  reportStatus?: ReportStatus;
  hasReport?: boolean;
  reportS3Key?: string | null;
  reportVariables?: Record<string, unknown> | null;
  onOpenPreview: (
    workflowId: number,
    runId: number,
    agentName?: string | null,
    reportS3Key?: string | null,
    reportVariables?: Record<string, unknown> | null,
  ) => void;
  onSelect?: (runId: number) => void;
}

// Queued, generating and failed reports show as disabled items.
export function RunReportAction({
  workflowId,
  runId,
  agentName,
  reportStatus,
  hasReport,
  reportS3Key,
  reportVariables,
  onOpenPreview,
  onSelect,
}: RunReportActionProps) {
  if (reportStatus === "pending") {
    return (
      <RowAction icon={<Clock />} disabled>
        Report queued
      </RowAction>
    );
  }
  if (reportStatus === "processing") {
    return (
      <RowAction icon={<Loader2 className="animate-spin" />} disabled>
        Generating report...
      </RowAction>
    );
  }
  if (reportStatus === "failed") {
    return (
      <RowAction icon={<AlertCircle />} disabled>
        Report failed
      </RowAction>
    );
  }
  if (reportStatus !== "completed" && !hasReport) return null;

  return (
    <RowAction
      icon={<FileText />}
      onClick={() => {
        onSelect?.(runId);
        onOpenPreview(workflowId, runId, agentName, reportS3Key, reportVariables);
      }}
    >
      Report preview
    </RowAction>
  );
}

