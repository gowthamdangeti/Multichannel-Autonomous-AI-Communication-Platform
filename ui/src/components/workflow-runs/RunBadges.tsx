import { cn } from "@/lib/utils";

/*
 * Pills for run tables (agent view conversations, voice conversations, campaign
 * runs). One shape and one colour scale, matching CallTypeCell and the
 * conversation page's status badge.
 */

type PillTone = "success" | "danger" | "warning" | "error" | "neutral";

const PILL_TONE: Record<PillTone, string> = {
    success: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:bg-emerald-500/20 dark:text-emerald-300 dark:border-emerald-500/30",
    danger: "bg-rose-500/10 text-rose-700 border-rose-500/20 dark:bg-rose-500/20 dark:text-rose-300 dark:border-rose-500/30",
    warning: "bg-amber-500/10 text-amber-700 border-amber-500/20 dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-500/30",
    error: "bg-red-500/10 text-red-700 border-red-500/20 dark:bg-red-500/20 dark:text-red-300 dark:border-red-500/30",
    neutral: "bg-slate-500/10 text-slate-700 border-slate-500/20 dark:bg-slate-500/20 dark:text-slate-300 dark:border-slate-500/30",
};

const PILL_SHAPE = "inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors";

function toneForDisposition(disposition: string): PillTone {
    const value = disposition.toLowerCase();
    if (value.includes("disqualified")) return "error";
    if (value.includes("qualified")) return "success";
    if (value.includes("hangup")) return "danger";
    if (value.includes("no_answer") || value.includes("busy")) return "warning";
    if (value.includes("error") || value.includes("fail")) return "error";
    return "neutral";
}

/** A call's disposition (user hangup, qualified, no answer, ...), coloured by meaning. */
export function DispositionBadge({ disposition }: { disposition?: string | null }) {
    if (!disposition) return <span className="text-xs text-muted-foreground">—</span>;
    return <span className={cn(PILL_SHAPE, PILL_TONE[toneForDisposition(disposition)])}>{disposition}</span>;
}

/** Whether a run finished: Completed (green) or In progress (amber). */
export function RunStatusBadge({ completed }: { completed: boolean }) {
    return (
        <span className={cn(PILL_SHAPE, PILL_TONE[completed ? "success" : "warning"])}>
            {completed ? "Completed" : "In progress"}
        </span>
    );
}

export type ChatConversationStatus = "error" | "in_progress" | "completed" | "disconnected";

const CHAT_STATUS: Record<ChatConversationStatus, { tone: PillTone; label: string }> = {
    error: { tone: "error", label: "Error" },
    in_progress: { tone: "warning", label: "In progress" },
    completed: { tone: "success", label: "Completed" },
    disconnected: { tone: "danger", label: "Disconnected" },
};

/** A chat conversation's status: Error (red), In progress (amber), Completed (green) or Disconnected (red). */
export function ChatStatusBadge({ status, title }: { status: ChatConversationStatus; title?: string }) {
    const { tone, label } = CHAT_STATUS[status];
    return (
        <span className={cn(PILL_SHAPE, PILL_TONE[tone])} title={title}>
            {label}
        </span>
    );
}
