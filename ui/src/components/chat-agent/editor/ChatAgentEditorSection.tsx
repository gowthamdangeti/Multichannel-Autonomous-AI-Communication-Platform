import type { ReactNode } from "react";

/** Surface of every card in the drawer: identical to ToolDetailsDrawer, Org drawer, and ConfigFormDialog. */
export const DRAWER_CARD = "rounded-lg border border-border bg-card p-4 shadow-xs";

export function DetailSection({
    title,
    description,
    action,
    children,
}: {
    title: string;
    description?: string;
    action?: ReactNode;
    children: ReactNode;
}) {
    return (
        <section className={`${DRAWER_CARD} space-y-4`}>
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h4 className="text-sm font-semibold text-foreground">{title}</h4>
                    {description && <p className="text-xs text-muted-foreground">{description}</p>}
                </div>
                {action}
            </div>
            {children}
        </section>
    );
}
