import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Surface of every card in the drawer: matches the admin/orgs drawer card styling. */
export const DRAWER_CARD = "rounded-lg border border-border bg-card p-4 shadow-xs";

export interface DetailSectionProps {
    title: string;
    description?: string;
    action?: ReactNode;
    children: ReactNode;
    className?: string;
}

/** A titled card inside an off-canvas drawer tab matching Autonomous AI OS org drawer conventions. */
export function DetailSection({ title, description, action, children, className }: DetailSectionProps) {
    return (
        <section className={cn(DRAWER_CARD, "space-y-4", className)}>
            <div className="flex items-start justify-between gap-2">
                <div>
                    <h3 className="text-xs font-semibold text-foreground">{title}</h3>
                    {description && <p className="text-[11px] text-muted-foreground mt-0.5">{description}</p>}
                </div>
                {action}
            </div>
            {children}
        </section>
    );
}
