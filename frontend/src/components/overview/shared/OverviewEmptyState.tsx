import type { LucideIcon } from "lucide-react";

import { Card } from "@/components/ui/card";

interface OverviewEmptyStateProps {
  icon: LucideIcon;
  title: string;
  body: string;
}

/** Shown when a channel has no agents yet. */
export function OverviewEmptyState({ icon: Icon, title, body }: OverviewEmptyStateProps) {
  return (
    <Card className="flex flex-col items-center gap-4 px-4 py-16 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-6" aria-hidden />
      </span>
      <div className="max-w-sm">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{body}</p>
      </div>
    </Card>
  );
}
