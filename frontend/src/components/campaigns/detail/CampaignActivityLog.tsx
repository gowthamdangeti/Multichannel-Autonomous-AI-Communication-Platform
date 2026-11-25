import type { CampaignResponse } from "@/client/types.gen";
import { DetailPanel, PanelItem } from "@/components/detail-panel/DetailPanel";
import { formatDateTime } from "@/lib/formatDateTime";

import { StatusLabel, type StatusTone } from "./CampaignDetailParts";

interface ActivityEntry {
    ts: string;
    tone: StatusTone;
    title: string;
    message: string;
    details?: Record<string, unknown>;
}

const numberFormat = new Intl.NumberFormat("en-US");

/** Logged events the backend writes: pause / resume and every failure or warning. */
const EVENT_TITLES: Record<string, string> = {
    campaign_paused: "Paused",
    campaign_resumed: "Resumed",
    circuit_breaker_tripped: "Paused after too many failed calls",
    source_sync_failed: "Contact list could not be read",
    batch_failed: "A batch of calls failed",
    phone_number_pool_exhausted_retry: "No free caller number, retrying",
    phone_number_pool_exhausted: "No free caller number",
};

function toneForEvent(event: string, level: string): StatusTone {
    if (event === "campaign_resumed") return "info";
    if (event === "campaign_paused") return "warning";
    if (level === "error") return "destructive";
    if (level === "warning") return "warning";
    return "secondary";
}

/**
 * Timeline of the campaign: its milestones (created, started, completed, from
 * the campaign's own timestamps) merged with logged events, newest first.
 */
function buildTimeline(campaign: CampaignResponse): ActivityEntry[] {
    const queued = numberFormat.format(campaign.total_queued_count ?? 0);
    const dialed = numberFormat.format(campaign.executed_count ?? 0);

    const milestones: ActivityEntry[] = [
        { ts: campaign.created_at, tone: "secondary", title: "Created", message: "Campaign created" },
        ...(campaign.started_at
            ? [{ ts: campaign.started_at, tone: "info" as const, title: "Started", message: "Dialing started" }]
            : []),
        ...(campaign.completed_at
            ? [{ ts: campaign.completed_at, tone: "success" as const, title: "Completed", message: `${dialed} of ${queued} numbers dialed` }]
            : []),
    ];

    const logged: ActivityEntry[] = (campaign.logs ?? []).map((entry) => ({
        ts: entry.ts,
        tone: toneForEvent(entry.event, entry.level),
        title: EVENT_TITLES[entry.event] ?? entry.event.replace(/_/g, " "),
        message: entry.message,
        details: entry.details && Object.keys(entry.details).length > 0 ? entry.details : undefined,
    }));

    return [...milestones, ...logged].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
}

/** Campaign activity: milestones, pauses and resumes, and failures, newest first. */
export function CampaignActivityLog({ campaign }: { campaign: CampaignResponse }) {
    const timeline = buildTimeline(campaign);

    return (
        <DetailPanel title="Activity" description="Milestones, pauses and failures, newest first">
            <div className="space-y-2">
                {timeline.map((entry, idx) => (
                    <PanelItem key={`${entry.ts}-${entry.title}-${idx}`} className="space-y-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                            <StatusLabel tone={entry.tone} className="text-xs font-semibold text-foreground">
                                {entry.title}
                            </StatusLabel>
                            <span className="font-mono text-[11px] text-muted-foreground">{formatDateTime(entry.ts)}</span>
                        </div>
                        <p className="break-words text-xs text-muted-foreground">{entry.message}</p>
                        {entry.details && (
                            <details>
                                <summary className="cursor-pointer text-[11px] text-muted-foreground transition-colors hover:text-foreground">
                                    Details
                                </summary>
                                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-2.5 font-mono text-[11px]">
                                    {JSON.stringify(entry.details, null, 2)}
                                </pre>
                            </details>
                        )}
                    </PanelItem>
                ))}
            </div>
        </DetailPanel>
    );
}
