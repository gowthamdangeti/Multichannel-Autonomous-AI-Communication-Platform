import React from 'react';

export function CustomChartTooltip({
    active,
    payload,
    label,
}: {
    active?: boolean;
    payload?: Array<{ color?: string; fill?: string; name: string; value: unknown }>;
    label?: string | number;
}) {
    if (!active || !payload || !payload.length) return null;
    return (
        <div className="rounded-lg border border-border bg-popover/95 px-3 py-2 text-xs shadow-xl backdrop-blur-md">
            <p className="mb-1 font-mono font-semibold text-foreground">Turn {label}</p>
            <div className="space-y-1">
                {payload.map((entry, index: number) => (
                    <div key={`item-${index}`} className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color || entry.fill }} />
                        <span className="text-muted-foreground">{entry.name}:</span>
                        <span className="font-mono font-medium text-foreground">
                            {typeof entry.value === 'number'
                                ? entry.value > 1000
                                    ? entry.value.toLocaleString()
                                    : entry.name.includes('Cost')
                                        ? `$${entry.value.toFixed(6)}`
                                        : entry.value
                                : String(entry.value ?? '')}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

