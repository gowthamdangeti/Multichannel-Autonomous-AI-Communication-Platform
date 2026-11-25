"use client";

import { Calendar, Check, Copy } from "lucide-react";
import { type ElementType, type ReactNode, useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/*
 * Card pieces shared by the detail pages (conversation, campaign). Classes are
 * the ones of the conversation page's "Session Overview" sidebar, so every
 * detail card looks the same. Use them inside a `data-detail-page` wrapper:
 * the theme applies the detail-page surfaces and type there.
 */

/** A detail card: title (+ optional description and action) and its body. */
export function DetailPanel({
    title,
    description,
    action,
    children,
    className,
    style,
}: {
    title: string;
    description?: ReactNode;
    action?: ReactNode;
    children: ReactNode;
    className?: string;
    style?: React.CSSProperties;
}) {
    return (
        <Card style={style} className={cn("overflow-hidden border-border bg-card shadow-sm", className)}>
            <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 p-4 pb-3">
                <div className="min-w-0 space-y-1">
                    <CardTitle className="text-xs font-bold uppercase tracking-wider text-foreground">{title}</CardTitle>
                    {description && <p className="text-[11px] text-muted-foreground">{description}</p>}
                </div>
                {action && <div className="shrink-0">{action}</div>}
            </CardHeader>
            <CardContent className="space-y-3 p-4 pt-0">{children}</CardContent>
        </Card>
    );
}

/** Icon box + label + value, like the Channel / Duration tiles. */
export function PanelTile({ icon: Icon, label, children }: { icon: ElementType; label: string; children: ReactNode }) {
    return (
        <div className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-muted p-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background">
                <Icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
                <div className="truncate text-xs font-bold font-mono text-foreground">{children}</div>
            </div>
        </div>
    );
}

/** Started / ended box, like the timeline at the bottom of Session Overview. */
export function PanelTimeline({ items }: { items: { label: string; value: string }[] }) {
    if (items.length === 0) return null;
    return (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted p-2.5 text-[11px]">
            {items.map((item, index) => (
                <div key={item.label} className={cn("min-w-0 space-y-0.5", index > 0 && index === items.length - 1 && "text-right")}>
                    <p className={cn("flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground", index > 0 && index === items.length - 1 && "justify-end")}>
                        {index === 0 && <Calendar className="h-3 w-3" />}
                        {item.label}
                    </p>
                    <p className="text-[10px] font-mono text-foreground/80">{item.value}</p>
                </div>
            ))}
        </div>
    );
}

/**
 * Icon + label + sub-text on the left, value on the right — the conversation
 * page's Telephonic Configuration rows (Call Direction, From Number, Call SID).
 */
export function PanelDetailRow({
    icon: Icon,
    label,
    sublabel,
    children,
}: {
    icon: ElementType;
    label: string;
    sublabel: string;
    children: ReactNode;
}) {
    return (
        <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted p-2">
            <div className="flex min-w-0 items-center gap-2">
                <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-foreground">{label}</p>
                    <p className="text-[9px] text-muted-foreground">{sublabel}</p>
                </div>
            </div>
            <div className="min-w-0 max-w-[55%] break-words text-right font-mono text-[11px] text-foreground">{children}</div>
        </div>
    );
}

/** A boxed list item (a number to call, an activity entry). */
export function PanelItem({ children, className }: { children: ReactNode; className?: string }) {
    return <div className={cn("rounded-lg border border-border bg-muted p-2.5", className)}>{children}</div>;
}

/** Labelled ID with a copy button, like Session Identifiers. */
export function PanelIdentifier({ label, value }: { label: string; value: string }) {
    const [copied, setCopied] = useState(false);
    const copy = () => {
        void navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
        });
    };
    return (
        <div className="space-y-1">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
            <div className="flex items-center justify-between rounded-md border border-border bg-muted px-2.5 py-1.5 font-mono text-[11px] text-foreground">
                <span className="truncate pr-2">{value}</span>
                <button
                    type="button"
                    onClick={copy}
                    aria-label={`Copy ${label}`}
                    className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                >
                    {copied ? <Check className="h-3.5 w-3.5 text-status-success" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
            </div>
        </div>
    );
}

/**
 * Wraps a shared dashboard chart (which renders its own Card) so its header and
 * padding match DetailPanel: same border, 16px header, 16px body.
 */
export function PanelChart({ children, className }: { children: ReactNode; className?: string }) {
    return (
        <div
            className={cn(
                "min-w-0 [&_[data-slot=card]]:overflow-hidden [&_[data-slot=card]]:border-border/70 [&_[data-slot=card]]:bg-card/60 [&_[data-slot=card]]:shadow-sm",
                // The chart title is already text-sm / 600, which is what DetailPanel titles render as on detail pages.
                "[&_[data-slot=card]>:first-child]:p-4 [&_[data-slot=card]>:first-child]:pb-3",
                "[&_[data-slot=card]>:not(:first-child)]:px-4 [&_[data-slot=card]>:not(:first-child)]:pb-4",
                className,
            )}
        >
            {children}
        </div>
    );
}
