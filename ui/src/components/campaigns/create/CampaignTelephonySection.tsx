"use client";

import { FileSpreadsheet, Phone } from "lucide-react";

import CsvUploadSelector from "@/app/campaigns/CsvUploadSelector";
import type { TelephonyConfigurationListItem } from "@/client/types.gen";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

import { DetailSection } from "./DetailSection";

interface CampaignTelephonySectionProps {
    telephonyConfigs: TelephonyConfigurationListItem[];
    selectedTelephonyConfigId: string;
    onSelectedTelephonyConfigIdChange: (val: string) => void;
    isLoadingTelephonyConfigs: boolean;
    onFileUploaded: (fileKey: string, fileName: string) => void;
    selectedFileName: string;
    sourceId: string;
    effectiveLimit: number;
    orgConcurrentLimit: number;
    availableFromNumbersCount: number;
}

export function CampaignTelephonySection({
    telephonyConfigs,
    selectedTelephonyConfigId,
    onSelectedTelephonyConfigIdChange,
    isLoadingTelephonyConfigs,
    onFileUploaded,
    selectedFileName,
    sourceId,
    effectiveLimit,
    orgConcurrentLimit,
    availableFromNumbersCount,
}: CampaignTelephonySectionProps) {
    const selectedConfig = telephonyConfigs.find(
        (c) => String(c.id) === selectedTelephonyConfigId
    );

    return (
        <div className="space-y-4">
            <DetailSection
                title="Caller ID & Telephony"
                description="Select the carrier and trunk configuration used for outbound calling."
            >
                <div className="space-y-3">
                    <div className="space-y-1.5">
                        <Label htmlFor="telephony-select" className="text-xs font-semibold">
                            Telephony Configuration <span className="text-destructive">*</span>
                        </Label>
                        <Select
                            value={selectedTelephonyConfigId}
                            onValueChange={onSelectedTelephonyConfigIdChange}
                        >
                            <SelectTrigger id="telephony-select" className="h-8 text-xs">
                                <SelectValue placeholder="Select telephony configuration" />
                            </SelectTrigger>
                            <SelectContent>
                                {isLoadingTelephonyConfigs ? (
                                    <SelectItem value="loading" disabled>
                                        Loading configurations…
                                    </SelectItem>
                                ) : telephonyConfigs.length === 0 ? (
                                    <SelectItem value="none" disabled>
                                        No telephony configurations found
                                    </SelectItem>
                                ) : (
                                    telephonyConfigs.map((cfg) => (
                                        <SelectItem key={cfg.id} value={String(cfg.id)}>
                                            {cfg.name} ({cfg.provider})
                                            {cfg.phone_number_count ? ` · ${cfg.phone_number_count} CLIs` : ""}
                                            {cfg.is_default_outbound ? " (Default)" : ""}
                                        </SelectItem>
                                    ))
                                )}
                            </SelectContent>
                        </Select>
                    </div>

                    {selectedConfig && (
                        <div className="rounded-md border border-border bg-muted/40 p-3 text-xs space-y-1.5">
                            <div className="flex items-center justify-between">
                                <span className="font-medium text-foreground flex items-center gap-1.5">
                                    <Phone className="h-3.5 w-3.5 text-primary" />
                                    {selectedConfig.name}
                                </span>
                                <div className="flex items-center gap-1.5">
                                    <Badge variant="outline" className="text-[10px] uppercase font-mono">
                                        {selectedConfig.provider}
                                    </Badge>
                                    {selectedConfig.is_default_outbound && (
                                        <Badge variant="secondary" className="text-[10px]">
                                            Default Outbound
                                        </Badge>
                                    )}
                                </div>
                            </div>
                            <p className="text-[11px] text-muted-foreground">
                                Active phone numbers (CLIs):{" "}
                                <span className="font-semibold text-foreground">
                                    {selectedConfig.phone_number_count ?? 0}
                                </span>
                                {" · "}
                                Effective concurrency limit:{" "}
                                <span className="font-semibold text-foreground">
                                    {effectiveLimit}
                                </span>
                            </p>
                            {availableFromNumbersCount < orgConcurrentLimit && (
                                <p className="text-[10px] text-amber-600 dark:text-amber-400">
                                    Note: Pacing is bounded by your {availableFromNumbersCount} phone number(s). Org limit is {orgConcurrentLimit}.
                                </p>
                            )}
                        </div>
                    )}
                </div>
            </DetailSection>

            <DetailSection
                title="Audience Contact List"
                description="Upload the CSV audience file with contact numbers and workflow variables."
            >
                <div className="space-y-3">
                    <CsvUploadSelector
                        onFileUploaded={onFileUploaded}
                        selectedFileName={selectedFileName}
                    />

                    {selectedFileName && (
                        <div className="flex items-center gap-2 rounded-md border border-border bg-card p-2.5 text-xs shadow-2xs">
                            <FileSpreadsheet className="h-4 w-4 text-primary shrink-0" />
                            <div className="min-w-0 flex-1">
                                <p className="font-medium text-foreground truncate">{selectedFileName}</p>
                                <p className="text-[10px] text-muted-foreground font-mono truncate">
                                    Key: {sourceId}
                                </p>
                            </div>
                            <Badge variant="outline" className="text-[10px] text-emerald-600 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/10">
                                Uploaded
                            </Badge>
                        </div>
                    )}

                    <p className="text-[11px] text-muted-foreground">
                        The CSV must have a <code className="font-mono bg-muted px-1 rounded text-[10px]">phone_number</code> column formatted in E.164 (e.g. +1234567890).
                    </p>
                </div>
            </DetailSection>
        </div>
    );
}
