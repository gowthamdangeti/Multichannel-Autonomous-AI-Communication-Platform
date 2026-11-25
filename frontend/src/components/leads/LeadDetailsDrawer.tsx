"use client";

import { Check, Copy } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { UnderlineTabs } from "@/components/ui/underline-tabs";
import { formatDateTime } from "@/lib/formatDateTime";

import { LEAD_STATUSES, type LeadItem } from "./types";

type LeadDrawerTab = "overview" | "contact" | "deployment";

const TABS = [
    { value: "overview", label: "Overview" },
    { value: "contact", label: "Contact" },
    { value: "deployment", label: "Deployment" },
];

/** Surface of every card in the drawer (identical to the Org and Tool drawers). */
const DRAWER_CARD = "rounded-lg border border-border bg-card p-4 shadow-xs";

const FIELD_GRID = "grid grid-cols-2 gap-x-4 gap-y-3";

interface LeadDetailsDrawerProps {
    lead: LeadItem | null;
    onOpenChange: (open: boolean) => void;
    onStatusChange: (id: number, status: string) => void;
}

/** A titled card inside a drawer tab. */
function DetailSection({ title, description, action, children }: {
    title: string;
    description?: string;
    action?: ReactNode;
    children: ReactNode;
}) {
    return (
        <section className={`${DRAWER_CARD} space-y-4`}>
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h4 className="text-sm font-semibold text-foreground">{title}</h4>
                    {description && <p className="text-xs text-muted-foreground">{description}</p>}
                </div>
                {action}
            </div>
            {children}
        </section>
    );
}

/** Label above a read-only value. */
function DetailField({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
    return (
        <div className="min-w-0">
            <span className="block text-[11px] font-medium text-muted-foreground">{label}</span>
            <span className={`block truncate text-xs font-medium text-foreground ${mono ? "font-mono" : ""}`}>{children}</span>
        </div>
    );
}

/** A DetailField whose value is a mailto:/tel: link with a copy button beside it. */
function CopyableField({ label, value, href }: { label: string; value: string; href: string }) {
    const [copied, setCopied] = useState(false);

    const copy = () => {
        void navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="min-w-0">
            <span className="block text-[11px] font-medium text-muted-foreground">{label}</span>
            <div className="flex items-center gap-1">
                <a
                    href={href}
                    title={value}
                    className="min-w-0 truncate font-mono text-xs font-medium text-foreground underline-offset-4 hover:underline"
                >
                    {value}
                </a>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-6 shrink-0 text-muted-foreground"
                    aria-label={`Copy ${label.toLowerCase()}`}
                    onClick={copy}
                >
                    {copied ? <Check className="size-3.5 text-status-success" /> : <Copy className="size-3.5" />}
                </Button>
            </div>
        </div>
    );
}

/**
 * Lead details as an off-canvas drawer: same header, underline tabs, section
 * cards and label/value fields as the Org and Tool drawers.
 */
export function LeadDetailsDrawer({ lead, onOpenChange, onStatusChange }: LeadDetailsDrawerProps) {
    const [activeTab, setActiveTab] = useState<LeadDrawerTab>("overview");

    return (
        <Sheet open={lead !== null} onOpenChange={(open) => { if (!open) onOpenChange(false); }}>
            <SheetContent side="right">
                <SheetHeader>
                    {lead && (
                        <>
                            <SheetTitle className="truncate pr-10 text-base">
                                Lead #{lead.id} — {lead.name || "Lead"}
                            </SheetTitle>
                            <SheetDescription className="sr-only">
                                Details of the enterprise lead submitted by {lead.name}
                            </SheetDescription>
                        </>
                    )}
                </SheetHeader>

                {lead && (
                    <Tabs
                        value={activeTab}
                        onValueChange={(value) => setActiveTab(value as LeadDrawerTab)}
                        className="flex min-h-0 flex-1 flex-col gap-0"
                    >
                        {/* Tab bar stays fixed under the drawer title. */}
                        <div className="shrink-0 border-b border-border px-4 pb-3">
                            <UnderlineTabs
                                value={activeTab}
                                onValueChange={(value) => setActiveTab(value as LeadDrawerTab)}
                                items={TABS}
                            />
                        </div>

                        <SheetBody className="px-4 py-4">
                            <TabsContent value="overview" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
                                <DetailSection
                                    title="Lead"
                                    description="From the Book a Strategy Call form."
                                    action={
                                        <Select value={lead.status} onValueChange={(value) => onStatusChange(lead.id, value)}>
                                            <SelectTrigger className="h-8 w-32 shrink-0 text-xs capitalize" aria-label="Lead status">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {LEAD_STATUSES.map((status) => (
                                                    <SelectItem key={status} value={status} className="text-xs capitalize">
                                                        {status}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    }
                                >
                                    <div className={FIELD_GRID}>
                                        <DetailField label="Name">{lead.name || "—"}</DetailField>
                                        <DetailField label="Submitted">{formatDateTime(lead.created_at)}</DetailField>
                                        <DetailField label="Company">{lead.company || "—"}</DetailField>
                                        <DetailField label="Role">{lead.job_title || "—"}</DetailField>
                                    </div>
                                </DetailSection>

                                <DetailSection title="Agent objective" description="What they want the voice agent to do.">
                                    {lead.agent_goal ? (
                                        <p className="select-text whitespace-pre-wrap text-xs leading-relaxed text-foreground">
                                            {lead.agent_goal}
                                        </p>
                                    ) : (
                                        <p className="text-xs text-muted-foreground">No objective was provided.</p>
                                    )}
                                </DetailSection>
                            </TabsContent>

                            <TabsContent value="contact" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
                                <DetailSection title="Contact" description="How to reach this lead.">
                                    <div className={FIELD_GRID}>
                                        <CopyableField label="Work email" value={lead.work_email} href={`mailto:${lead.work_email}`} />
                                        {lead.phone ? (
                                            <CopyableField label="Contact number" value={lead.phone} href={`tel:${lead.phone}`} />
                                        ) : (
                                            <DetailField label="Contact number">—</DetailField>
                                        )}
                                        <DetailField label="Company">{lead.company || "—"}</DetailField>
                                        <DetailField label="Location">{lead.country || "—"}</DetailField>
                                    </div>
                                </DetailSection>
                            </TabsContent>

                            <TabsContent value="deployment" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
                                <DetailSection title="Deployment" description="Volume and hosting requirements.">
                                    <div className={FIELD_GRID}>
                                        <DetailField label="Expected volume">{lead.volume || "—"}</DetailField>
                                        <DetailField label="On-premises">
                                            {lead.deployment === "yes" ? "Required" : lead.deployment || "—"}
                                        </DetailField>
                                        <DetailField label="Source">{lead.source || "—"}</DetailField>
                                        <DetailField label="Origin">{lead.origin || "—"}</DetailField>
                                    </div>
                                </DetailSection>
                            </TabsContent>
                        </SheetBody>
                    </Tabs>
                )}
            </SheetContent>
        </Sheet>
    );
}
