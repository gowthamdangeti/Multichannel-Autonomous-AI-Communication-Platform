"use client";

import { CalendarDays, CheckCircle2, Clock, PhoneIncoming, Star } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

// ─── At-a-glance highlights ──────────────────────────────────────────────────

export type HighlightKind = "clock" | "calendar" | "star" | "check" | "phone";

const HIGHLIGHT_ICON: Record<HighlightKind, typeof Clock> = {
    clock: Clock,
    calendar: CalendarDays,
    star: Star,
    check: CheckCircle2,
    phone: PhoneIncoming,
};

export interface HighlightItem {
    kind: HighlightKind;
    label: string;
    value: string;
}

export function HighlightsTile({ items, subtitle, loading }: { items: HighlightItem[]; subtitle?: string; loading?: boolean }) {
    return (
        <Card className="h-full transition-transform duration-200 ease-out hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0">
            <CardContent className="flex h-full flex-col gap-1 p-5">
                <h3 className="text-sm font-semibold text-foreground">At a glance</h3>
                {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
                {loading ? (
                    <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                        Crunching numbers…
                    </div>
                ) : (
                    <ul className="flex flex-1 flex-col justify-between">
                        {items.map((it) => {
                            const Icon = HIGHLIGHT_ICON[it.kind];
                            return (
                                <li key={it.label} className="flex items-center gap-3 py-1.5">
                                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                                        <Icon className="h-4 w-4" />
                                    </span>
                                    <span className="text-sm text-muted-foreground">{it.label}</span>
                                    <span className="ml-auto truncate text-sm font-semibold">{it.value}</span>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </CardContent>
        </Card>
    );
}
