interface OverviewShareBarProps {
  share: number;
  label: string;
}

/** A thin meter for an agent's share of the org's calls. */
export function OverviewShareBar({ share, label }: OverviewShareBarProps) {
  const width = Math.min(100, Math.max(0, share));
  return (
    <div className="flex items-center gap-2">
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(width)}
        className="h-1.5 w-16 overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${width}%` }} />
      </div>
      <span className="w-9 text-right tabular-nums text-muted-foreground">{Math.round(share)}%</span>
    </div>
  );
}
