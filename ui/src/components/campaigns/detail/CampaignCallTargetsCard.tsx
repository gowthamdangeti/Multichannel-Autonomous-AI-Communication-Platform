import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";

import type { CampaignCallTargetResponse, CampaignCallTargetsResponse } from "@/client/types.gen";
import { DetailPanel, PanelItem } from "@/components/detail-panel/DetailPanel";
import { Button } from "@/components/ui/button";

import { formatStateLabel, StatusLabel, toneForState } from "./CampaignDetailParts";

interface CampaignCallTargetsCardProps {
    callTargets: CampaignCallTargetsResponse | null;
    isLoading: boolean;
    canEdit: boolean;
    onAdd: () => void;
    onEdit: (target: CampaignCallTargetResponse) => void;
    onDelete: (target: CampaignCallTargetResponse) => void;
    onPageChange: (page: number) => void;
}

const numberFormat = new Intl.NumberFormat("en-US");

/** The numbers this campaign dials: number, state and the variables passed to the agent. */
export function CampaignCallTargetsCard({
    callTargets,
    isLoading,
    canEdit,
    onAdd,
    onEdit,
    onDelete,
    onPageChange,
}: CampaignCallTargetsCardProps) {
    const total = callTargets?.total_count ?? 0;

    return (
        <DetailPanel
            title="Numbers to Call"
            description={callTargets ? `${numberFormat.format(total)} ${total === 1 ? "number" : "numbers"} in this campaign` : undefined}
            action={
                canEdit ? (
                    <Button size="sm" className="h-8" onClick={onAdd}>
                        <Plus className="h-4 w-4" />
                        Add number
                    </Button>
                ) : undefined
            }
        >
            {isLoading ? (
                <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading numbers
                </div>
            ) : callTargets && callTargets.targets.length > 0 ? (
                <>
                    <div className="space-y-2">
                        {callTargets.targets.map((target, idx) => {
                            const variables = Object.entries(target.context_variables ?? {});
                            const editable = canEdit && target.id !== undefined && target.id !== null;
                            return (
                                <PanelItem
                                    key={target.id ? `target-${target.id}` : `target-${target.phone_number}-${idx}`}
                                    className="flex items-center gap-3"
                                >
                                    <div className="min-w-0 flex-1 space-y-1">
                                        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                                            <span className="font-mono text-xs font-bold text-foreground">{target.phone_number}</span>
                                            <StatusLabel tone={toneForState(target.state)} className="text-xs text-muted-foreground">
                                                {formatStateLabel(target.state)}
                                            </StatusLabel>
                                        </div>
                                        {variables.length > 0 && (
                                            <p
                                                className="truncate text-[11px] text-muted-foreground"
                                                title={variables.map(([k, v]) => `${k}=${String(v)}`).join(", ")}
                                            >
                                                {variables.map(([k, v]) => `${k.replace(/_/g, " ")}: ${String(v)}`).join("  ·  ")}
                                            </p>
                                        )}
                                    </div>
                                    {editable && (
                                        <div className="flex shrink-0 items-center gap-1">
                                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(target)} aria-label={`Edit ${target.phone_number}`}>
                                                <Pencil className="h-4 w-4" />
                                            </Button>
                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => onDelete(target)} aria-label={`Remove ${target.phone_number}`}>
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    )}
                                </PanelItem>
                            );
                        })}
                    </div>
                    {callTargets.total_pages > 1 && (
                        <div className="flex items-center justify-between gap-4 pt-1">
                            <span className="text-xs text-muted-foreground">
                                Page {callTargets.page} of {callTargets.total_pages}
                            </span>
                            <div className="flex gap-2">
                                <Button variant="outline" size="sm" className="h-8" disabled={callTargets.page === 1} onClick={() => onPageChange(callTargets.page - 1)}>
                                    Previous
                                </Button>
                                <Button variant="outline" size="sm" className="h-8" disabled={callTargets.page === callTargets.total_pages} onClick={() => onPageChange(callTargets.page + 1)}>
                                    Next
                                </Button>
                            </div>
                        </div>
                    )}
                </>
            ) : (
                <p className="py-6 text-center text-xs text-muted-foreground">No phone numbers in this campaign yet</p>
            )}
        </DetailPanel>
    );
}
