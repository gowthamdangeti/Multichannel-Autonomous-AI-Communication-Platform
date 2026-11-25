import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type StatusTone = "on" | "idle" | "off";

const VARIANTS: Record<StatusTone, "default" | "secondary" | "outline"> = {
  on: "default",
  idle: "secondary",
  off: "outline",
};

export function OverviewStatusBadge({ tone, label }: { tone: StatusTone; label: string }) {
  return (
    <Badge variant={VARIANTS[tone]} className={cn(tone === "off" && "text-muted-foreground")}>
      <span aria-hidden className={cn("size-1.5 rounded-full", tone === "on" ? "bg-primary" : "bg-muted-foreground/60")} />
      {label}
    </Badge>
  );
}
