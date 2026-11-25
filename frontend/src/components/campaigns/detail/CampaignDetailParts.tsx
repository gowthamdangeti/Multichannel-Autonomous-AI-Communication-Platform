import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Status colours are the Badge variants, so a state has the same colour as a
 * chip, as a dot, on the campaigns list and on the detail page.
 */
export type StatusTone = "secondary" | "info" | "warning" | "success" | "destructive";

/** Dot colour of each tone — the same hue as the Badge variant of that name. */
const DOT_TONE: Record<StatusTone, string> = {
    secondary: "bg-muted-foreground/60",
    info: "bg-sky-500",
    warning: "bg-amber-500",
    success: "bg-emerald-500",
    destructive: "bg-rose-500",
};

/** Background class of the status dot for a tone. */
export function dotClassForTone(tone: StatusTone): string {
    return DOT_TONE[tone];
}

/**
 * Tone of a campaign or call-target state. Campaign states match the campaigns
 * list: created grey, running blue, paused amber, completed green, failed red.
 */
export function toneForState(state: string | null | undefined): StatusTone {
    switch ((state ?? "").toLowerCase()) {
        case "running":
        case "syncing":
        case "in_progress":
        case "calling":
            return "info";
        case "paused":
        case "retrying":
        case "queued":
        case "pending":
            return "warning";
        case "completed":
        case "processed":
        case "done":
        case "succeeded":
            return "success";
        case "failed":
        case "error":
            return "destructive";
        default:
            return "secondary";
    }
}

/** "in_progress" -> "In progress". */
export function formatStateLabel(state: string | null | undefined): string {
    const text = (state ?? "").replace(/[_-]+/g, " ").trim();
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : "—";
}

/** The page's signature: a small dot before every state, then the state in words. */
export function StatusLabel({ tone, children, className }: { tone: StatusTone; children: ReactNode; className?: string }) {
    return (
        <span className={cn("inline-flex items-center gap-2 text-sm text-foreground", className)}>
            <span className={cn("size-2 shrink-0 rounded-full", DOT_TONE[tone])} aria-hidden />
            {children}
        </span>
    );
}

/** A link inside the details: primary text, underline on hover — no off-palette blue. */
export function DetailLink({
    children,
    onClick,
    href,
    title,
}: {
    children: ReactNode;
    onClick?: () => void;
    href?: string;
    title?: string;
}) {
    const className =
        "cursor-pointer text-left text-sm font-medium text-foreground underline-offset-4 transition-colors hover:underline focus-visible:underline focus-visible:outline-none";
    if (href) {
        return (
            <a href={href} target="_blank" rel="noopener noreferrer" title={title} className={cn(className, "break-all")}>
                {children}
            </a>
        );
    }
    return (
        <button type="button" onClick={onClick} title={title} className={cn(className, "inline-block max-w-full truncate align-bottom")}>
            {children}
        </button>
    );
}
