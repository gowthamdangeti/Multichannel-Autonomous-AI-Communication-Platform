"use client";

import { toast } from "sonner";

import {
    conversationItemsFromLiveFeedback,
    conversationItemsFromRealtimeFeedbackEvents,
} from "./adapters/fromRealtimeFeedback";
import { ConversationContainer } from "./ConversationContainer";
import { ConversationTimeline } from "./ConversationTimeline";
import type { ConversationMessageItem } from "./types";
import type {
    ConversationStatus,
    RealtimeFeedbackMessage,
    WorkflowRunLogs,
} from "./types";
import { countConversationMessages } from "./utils";

interface LiveModeProps {
    mode: "live";
    messages: RealtimeFeedbackMessage[];
    isCallActive: boolean;
    isCallCompleted: boolean;
}

interface HistoricalModeProps {
    mode: "historical";
    logs: WorkflowRunLogs | null;
    transcriptUrl?: string | null;
    runId?: number | string;
    onDownloadTranscript?: () => void;
}

type RealtimeFeedbackProps = LiveModeProps | HistoricalModeProps;

export function RealtimeFeedback(props: RealtimeFeedbackProps) {
    let items;
    let status: ConversationStatus;
    let title: string;
    let emptyState: { title: string; subtitle: string };
    let autoScroll = false;

    if (props.mode === "historical") {
        items = props.logs?.realtime_feedback_events
            ? conversationItemsFromRealtimeFeedbackEvents(props.logs.realtime_feedback_events)
            : [];
        status = "ended";
        title = "Call Transcript";
        emptyState = {
            title: "No conversation recorded",
            subtitle: "Real-time feedback events were not captured for this call",
        };
    } else {
        items = conversationItemsFromLiveFeedback(props.messages);
        status = props.isCallActive ? "live" : props.isCallCompleted ? "ended" : "ready";
        title = "Live Transcript";
        emptyState = {
            title: "No messages yet",
            subtitle: props.isCallActive
                ? "Start speaking to see the transcript"
                : "Start the call to begin the conversation",
        };
        autoScroll = true;
    }

    const handleDownload = () => {
        if (props.mode === "historical" && props.onDownloadTranscript) {
            props.onDownloadTranscript();
            return;
        }

        if (props.mode === "historical" && props.transcriptUrl) {
            const a = document.createElement("a");
            a.href = props.transcriptUrl;
            a.target = "_blank";
            a.download = `transcript-${props.runId || "call"}.txt`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            toast.success("Downloading transcript...");
            return;
        }

        const messageLines = items
            .filter((item): item is ConversationMessageItem => item.kind === "message")
            .map((item) => {
                const speaker = item.role === "user" ? "User" : "Assistant";
                return `[${speaker}]: ${item.text || ""}`;
            });

        if (messageLines.length === 0) {
            toast.error("No transcript messages available to download");
            return;
        }

        const content = messageLines.join("\n\n");
        const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `transcript-${(props.mode === "historical" ? props.runId : "") || "call"}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast.success("Transcript downloaded successfully");
    };

    return (
        <ConversationContainer
            title={title}
            status={status}
            messageCount={countConversationMessages(items) || undefined}
            onDownloadTranscript={props.mode === "historical" ? handleDownload : undefined}
            downloadDisabled={items.length === 0 && !(props.mode === "historical" && props.transcriptUrl)}
        >
            <ConversationTimeline
                items={items}
                autoScroll={autoScroll}
                emptyState={emptyState}
            />
        </ConversationContainer>
    );
}
