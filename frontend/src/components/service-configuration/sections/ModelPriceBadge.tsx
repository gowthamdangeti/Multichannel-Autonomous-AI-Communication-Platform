"use client";

import { useModelPrice } from "../hooks/useModelPrice";
import type { ServiceSegment } from "../types";

const SOURCE_LABELS: Record<string, string> = {
    admin: "Set by admin",
    provider_api: "From provider API",
    official: "From provider pricing page",
    feed: "From public price list",
};

interface ModelPriceBadgeProps {
    service: ServiceSegment;
    provider?: string;
    model?: string;
    voice?: string;
}

function formatVerifiedDate(value?: string | null): string | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString();
}

/** Price of the selected provider and model, shown under the model picker. */
export function ModelPriceBadge({ service, provider, model, voice }: ModelPriceBadgeProps) {
    const { price, isLoading } = useModelPrice({ service, provider, model, voice });

    if (service === "embeddings" || !provider || price?.status === "hidden") return null;
    if (!price) {
        return isLoading ? <p className="text-xs text-muted-foreground">Loading price…</p> : null;
    }
    if (price.status === "self_hosted") {
        return <p className="text-xs text-muted-foreground">Self-hosted: no provider charge.</p>;
    }
    if (price.status !== "priced") {
        return <p className="text-xs text-muted-foreground">Price unavailable</p>;
    }

    const verified = formatVerifiedDate(price.verified_at);
    const details = [
        price.source ? SOURCE_LABELS[price.source] : null,
        price.tier,
        verified ? `Checked ${verified}` : null,
    ].filter(Boolean);

    return (
        <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
                {price.lines.map((line) => (
                    <span key={line.component}>
                        <span className="text-muted-foreground">{line.label}: </span>
                        <span className="font-mono font-medium">{line.display}</span>
                    </span>
                ))}
            </div>
            {details.length > 0 && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                    {price.source_url ? (
                        <a href={price.source_url} target="_blank" rel="noreferrer" className="underline">
                            {details.join(" · ")}
                        </a>
                    ) : (
                        details.join(" · ")
                    )}
                </p>
            )}
            {price.note && <p className="mt-1 text-[11px] text-muted-foreground">{price.note}</p>}
        </div>
    );
}
