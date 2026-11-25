import type { ReactNode } from "react";

interface OverviewSectionProps {
  id: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}

/** One labelled band of the overview, so the page reads top to bottom as a report. */
export function OverviewSection({ id, title, description, actions, children }: OverviewSectionProps) {
  const headingId = `${id}-heading`;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h2 id={headingId} className="text-base font-semibold tracking-tight text-foreground">
            {title}
          </h2>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex min-w-0 flex-wrap items-center gap-2 lg:shrink-0 lg:justify-end">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
