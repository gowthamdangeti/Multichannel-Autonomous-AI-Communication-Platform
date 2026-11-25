"use client";

import { Activity, CalendarClock, Clock, FileSpreadsheet, Gauge, GitBranch, Globe, Phone, PhoneOff, PhoneOutgoing, Play, Repeat, RotateCcw, Timer, Users } from "lucide-react";

import type { CampaignResponse } from "@/client/types.gen";
import {
    DetailPanel,
    PanelDetailRow,
    PanelIdentifier,
    PanelTile,
    PanelTimeline,
} from "@/components/detail-panel/DetailPanel";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/formatDateTime";
import { cn } from "@/lib/utils";

import { DetailLink, dotClassForTone, formatStateLabel, toneForState } from "./CampaignDetailParts";
import { useCallerNumbers } from "./useCallerNumbers";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const numberFormat = new Intl.NumberFormat("en-US");

interface CampaignOverviewSidebarProps {
    campaign: CampaignResponse;
    onDownloadCsv: () => void;
    onOpenTelephony: (configurationId: number) => void;
    onOpenCampaign: (campaignId: number) => void;
}

/**
 * Right column of the campaign Overview tab, built from the same card pieces
 * as the conversation page's Session Overview sidebar.
 */
export function CampaignOverviewSidebar({ campaign, onDownloadCsv, onOpenTelephony, onOpenCampaign }: CampaignOverviewSidebarProps) {
    // Numbers the dialer calls from: the line's active numbers, default caller ID first.
    const callerNumbers = useCallerNumbers(campaign.telephony_configuration_id);
    const isCsv = campaign.source_type === "csv";
    const sourceFileName = campaign.source_id.split("/").pop() ?? campaign.source_id;
    const rawSourceType = campaign.source_type.replace(/[-_]+/g, " ");
    const sourceType = isCsv ? "CSV" : rawSourceType.charAt(0).toUpperCase() + rawSourceType.slice(1);
    const phoneLine = campaign.telephony_configuration_name
        || (campaign.telephony_configuration_id ? `Configuration #${campaign.telephony_configuration_id}` : "Not assigned");
    const retry = campaign.retry_config;
    const schedule = campaign.schedule_config;
    const retryOn = [
        retry.retry_on_busy && "Busy",
        retry.retry_on_no_answer && "No answer",
        retry.retry_on_voicemail && "Voicemail",
    ].filter(Boolean).join(", ");

    const timeline = [
        { label: "Started", value: campaign.started_at ?? campaign.created_at },
        ...(campaign.completed_at ? [{ label: "Completed", value: campaign.completed_at }] : []),
    ].map((item) => ({ label: item.label, value: formatDateTime(item.value) }));

    return (
        <div className="w-full space-y-4">
            {/* 1. Campaign overview — same layout as Session Overview */}
            <DetailPanel title="Campaign Overview">
                <div className="grid grid-cols-2 gap-2.5">
                    {/* Line and the number it calls from, side by side as a pair. */}
                    <PanelTile icon={Phone} label="Phone line">{phoneLine}</PanelTile>
                    <PanelTile icon={PhoneOutgoing} label="Caller number">
                        {callerNumbers.isLoading ? (
                            <span className="text-muted-foreground">Loading</span>
                        ) : callerNumbers.primary ? (
                            <span title={callerNumbers.primary.address}>{callerNumbers.primary.address}</span>
                        ) : (
                            <span className="text-muted-foreground">None</span>
                        )}
                    </PanelTile>
                    <PanelTile icon={FileSpreadsheet} label="Source">{sourceType}</PanelTile>
                    <PanelTile icon={Gauge} label="Concurrency">
                        {campaign.max_concurrency ? `${campaign.max_concurrency} calls` : "Org default"}
                    </PanelTile>
                    <div className="col-span-2">
                        <PanelTile icon={Users} label="Numbers">{numberFormat.format(campaign.total_queued_count ?? 0)} queued</PanelTile>
                    </div>
                </div>
                <PanelTile icon={Activity} label="Status">
                    <Badge variant={toneForState(campaign.state)} className="mt-0.5 h-5 gap-1.5 px-2 text-[11px] font-semibold">
                        <span className={cn("size-1.5 shrink-0 rounded-full", dotClassForTone(toneForState(campaign.state)))} aria-hidden />
                        {formatStateLabel(campaign.state)}
                    </Badge>
                </PanelTile>
                <PanelTimeline items={timeline} />
            </DetailPanel>

            {/* 2. Dialing rules — icon, label and sub-text rows, like Telephonic Configuration */}
            <DetailPanel title="Dialing Rules">
                <div className="space-y-2">
                    <PanelDetailRow icon={RotateCcw} label="Retries" sublabel="Redial Unanswered Calls">
                        {retry.enabled ? "On" : "Off"}
                    </PanelDetailRow>
                    {retry.enabled && (
                        <>
                            <PanelDetailRow icon={Repeat} label="Max retries" sublabel="Attempts Per Number">
                                {retry.max_retries}
                            </PanelDetailRow>
                            <PanelDetailRow icon={Timer} label="Retry delay" sublabel="Wait Before Redialing">
                                {retry.retry_delay_seconds}s
                            </PanelDetailRow>
                            <PanelDetailRow icon={PhoneOff} label="Retry on" sublabel="Outcomes That Redial">
                                {retryOn || "None selected"}
                            </PanelDetailRow>
                        </>
                    )}
                    <PanelDetailRow icon={CalendarClock} label="Schedule" sublabel="Calling Window">
                        {schedule?.enabled ? "On" : "Not set"}
                    </PanelDetailRow>
                    {schedule?.enabled && (
                        <>
                            <PanelDetailRow icon={Globe} label="Timezone" sublabel="Schedule Timezone">
                                {schedule.timezone.replace(/_/g, " ")}
                            </PanelDetailRow>
                            {schedule.mode === "start_at" ? (
                                <PanelDetailRow icon={Play} label="Starts" sublabel="Scheduled Start">
                                    {schedule.start_at ? formatDateTime(schedule.start_at) : "Configured time"}
                                </PanelDetailRow>
                            ) : (
                                <PanelDetailRow icon={Clock} label="Time slots" sublabel="Allowed Calling Hours">
                                    {schedule.slots?.map((slot, index) => (
                                        <span key={index} className="block">
                                            {DAY_NAMES[slot.day_of_week]} {slot.start_time} – {slot.end_time}
                                        </span>
                                    ))}
                                </PanelDetailRow>
                            )}
                        </>
                    )}
                </div>
            </DetailPanel>

            {/* 3. Source details — same rows */}
            <DetailPanel title="Source Details">
                <div className="space-y-2">
                    <PanelDetailRow
                        icon={FileSpreadsheet}
                        label={isCsv ? "Source file" : "Source sheet"}
                        sublabel={isCsv ? "Uploaded Contact List" : "Linked Contact Sheet"}
                    >
                        {isCsv ? (
                            <DetailLink onClick={onDownloadCsv} title={`Download ${sourceFileName}`}>
                                <span className="text-[11px]">{sourceFileName}</span>
                            </DetailLink>
                        ) : (
                            <DetailLink href={campaign.source_id} title={campaign.source_id}>
                                <span className="text-[11px]">Open sheet</span>
                            </DetailLink>
                        )}
                    </PanelDetailRow>
                    {campaign.telephony_configuration_id && (
                        <PanelDetailRow icon={PhoneOutgoing} label="Calls from" sublabel="Caller ID Numbers">
                            {callerNumbers.isLoading ? (
                                <span className="text-muted-foreground">Loading</span>
                            ) : callerNumbers.numbers.length === 0 ? (
                                <span className="text-muted-foreground">No active numbers</span>
                            ) : (
                                callerNumbers.numbers.map((number) => (
                                    <span key={number.id} className="block">
                                        {number.address}
                                        {number.is_default_caller_id && callerNumbers.numbers.length > 1 && (
                                            <span className="text-muted-foreground"> · default</span>
                                        )}
                                    </span>
                                ))
                            )}
                        </PanelDetailRow>
                    )}
                    <PanelDetailRow icon={Phone} label="Phone line" sublabel="Telephony Configuration">
                        {campaign.telephony_configuration_id ? (
                            <DetailLink onClick={() => onOpenTelephony(campaign.telephony_configuration_id as number)}>
                                <span className="text-[11px]">{phoneLine}</span>
                            </DetailLink>
                        ) : (
                            "Not assigned"
                        )}
                    </PanelDetailRow>
                    {campaign.parent_campaign_id && (
                        <PanelDetailRow icon={GitBranch} label="Redial of" sublabel="Original Campaign">
                            <DetailLink onClick={() => onOpenCampaign(campaign.parent_campaign_id as number)}>
                                <span className="text-[11px]">Campaign #{campaign.parent_campaign_id}</span>
                            </DetailLink>
                        </PanelDetailRow>
                    )}
                    {campaign.redialed_campaign_id && (
                        <PanelDetailRow icon={GitBranch} label="Redialed as" sublabel="Follow-up Campaign">
                            <DetailLink onClick={() => onOpenCampaign(campaign.redialed_campaign_id as number)}>
                                <span className="text-[11px]">Campaign #{campaign.redialed_campaign_id}</span>
                            </DetailLink>
                        </PanelDetailRow>
                    )}
                </div>
            </DetailPanel>

            {/* 4. Identifiers — like Session Identifiers */}
            <DetailPanel title="Campaign Identifiers">
                <PanelIdentifier label="Campaign ID" value={String(campaign.id)} />
                <PanelIdentifier label="Workflow ID" value={String(campaign.workflow_id)} />
                {campaign.telephony_configuration_id && (
                    <PanelIdentifier label="Telephony config ID" value={String(campaign.telephony_configuration_id)} />
                )}
            </DetailPanel>
        </div>
    );
}
