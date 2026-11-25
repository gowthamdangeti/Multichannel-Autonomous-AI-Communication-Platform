import type { ReactNode } from "react";

import type { CampaignResponse } from "@/client/types.gen";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { DetailLink } from "./CampaignDetailParts";

export type CampaignTab = "overview" | "analytics" | "runs" | "report";

export const CAMPAIGN_TABS: { id: CampaignTab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "analytics", label: "Analytics" },
    { id: "runs", label: "Campaign Runs" },
    { id: "report", label: "Campaign Report" },
];

interface CampaignSummaryCardProps {
    campaign: CampaignResponse;
    activeTab: CampaignTab;
    onTabChange: (tab: CampaignTab) => void;
    onOpenWorkflow: () => void;
    /** Tabs to show; defaults to all. The page hides Report when there is no template. */
    tabs?: { id: CampaignTab; label: string }[];
    /** Card actions on the right of the name (refresh, more menu), like the agent view header. */
    actions?: ReactNode;
}

/**
 * Campaign header, same structure as the agent view header card:
 * campaign name, its agent, then the section tabs. Status, dates and dial
 * progress live in the Overview sidebar and Analytics.
 */
export function CampaignSummaryCard({ campaign, activeTab, onTabChange, onOpenWorkflow, tabs = CAMPAIGN_TABS, actions }: CampaignSummaryCardProps) {
    return (
        <Card className="gap-0 px-5 pt-5 pb-0">
            {/* 1. Name and its agent, with the card actions on the right */}
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <h2 className="min-w-0 truncate text-xl font-semibold tracking-tight text-foreground" title={campaign.name}>
                        {campaign.name}
                    </h2>

                    {/* 2. The agent this campaign runs. Status and dates live in the Overview sidebar. */}
                    <div className="mt-1.5 text-sm text-muted-foreground">
                        <DetailLink onClick={onOpenWorkflow} title="Open the agent's workflow">
                            <span className="font-normal text-muted-foreground hover:text-foreground">{campaign.workflow_name}</span>
                        </DetailLink>
                    </div>
                </div>
                {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
            </div>

            {/* 3. Section tabs, same style as the agent view */}
            <div role="tablist" aria-label="Campaign sections" className="mt-5 flex items-center gap-6 overflow-x-auto text-xs">
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={activeTab === tab.id}
                        onClick={() => onTabChange(tab.id)}
                        className={cn(
                            "shrink-0 border-b-2 pb-2.5 font-semibold transition-colors",
                            activeTab === tab.id
                                ? "border-primary text-foreground"
                                : "border-transparent text-muted-foreground hover:text-foreground",
                        )}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>
        </Card>
    );
}
