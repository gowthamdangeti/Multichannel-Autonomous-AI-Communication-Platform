'use client';

import {
    Activity,
    Calendar,
    Check,
    Clock,
    Code,
    Copy,
    Globe,
    Laptop,
    MessageSquare,
    Monitor,
    Phone,
    PhoneIncoming,
    PhoneOutgoing,
    Radio,
    Server,
    Smartphone,
    User,
    Wifi,
} from 'lucide-react';
import React, { useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

import type { RealtimeFeedbackEvent, WorkflowRunResponse } from './types';

export interface SessionOverviewSidebarProps {
    workflowRun: WorkflowRunResponse | null | undefined;
    runId: number | string;
    organizationName?: string;
}

// ── Channel Classification ──────────────────────────────────────────────────

type ChannelType = 'telephonic' | 'test-agent' | 'embed' | 'textchat' | 'unknown';

const TELEPHONIC_MODES = new Set(['twilio', 'vonage', 'vobiz', 'cloudonix', 'ari', 'telnyx', 'plivo']);

function classifyChannel(mode: string): ChannelType {
    const lower = (mode || '').toLowerCase().trim();
    if (TELEPHONIC_MODES.has(lower)) return 'telephonic';
    if (lower === 'webrtc') return 'test-agent';
    if (lower === 'smallwebrtc') return 'embed';
    if (lower === 'textchat') return 'textchat';
    if (lower.includes('telephon') || lower.includes('phone') || lower.includes('sip')) return 'telephonic';
    if (lower.includes('embed')) return 'embed';
    if (lower.includes('text') || lower.includes('chat')) return 'textchat';
    return 'unknown';
}

function getChannelDisplay(channelType: ChannelType, rawMode: string): { label: string; color: string; icon: React.ElementType } {
    switch (channelType) {
        case 'telephonic':
            return {
                label: 'Telephonic',
                color: 'bg-orange-500/10 border-orange-500/20 text-orange-400',
                icon: Phone,
            };
        case 'test-agent':
            return {
                label: 'Test agent',
                color: 'bg-sky-500/10 border-sky-500/20 text-sky-400',
                icon: Monitor,
            };
        case 'embed':
            return {
                label: 'Embed',
                color: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
                icon: Code,
            };
        case 'textchat':
            return {
                label: 'Text chat',
                color: 'bg-violet-500/10 border-violet-500/20 text-violet-400',
                icon: MessageSquare,
            };
        default:
            return {
                label: rawMode.toUpperCase() || 'UNKNOWN',
                color: 'bg-muted/40 border-border/50 text-muted-foreground',
                icon: Smartphone,
            };
    }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatDurationTimestamp(seconds?: number | null) {
    if (seconds == null || Number.isNaN(seconds) || seconds <= 0) return '00:00';
    const totalSecs = Math.round(seconds);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function formatTimelineDate(date: Date) {
    try {
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
        }) + ', ' + date.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
        });
    } catch {
        return '—';
    }
}

// ── Status Badge Styling (Matches Voice Conversations table) ────────────────
function getStatusBadgeStyle(status: string) {
    const s = (status || '').toLowerCase();
    if (s.includes('qualified') || s === 'completed' || s.includes('success')) {
        return {
            badge: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:bg-emerald-500/20 dark:text-emerald-300 dark:border-emerald-500/30',
            dot: 'bg-emerald-400',
        };
    }
    if (s.includes('hangup')) {
        return {
            badge: 'bg-rose-500/10 text-rose-700 border-rose-500/20 dark:bg-rose-500/20 dark:text-rose-300 dark:border-rose-500/30',
            dot: 'bg-rose-400',
        };
    }
    if (s.includes('no_answer') || s.includes('busy') || s.includes('progress') || s.includes('in_progress')) {
        return {
            badge: 'bg-amber-500/10 text-amber-700 border-amber-500/20 dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-500/30',
            dot: 'bg-amber-400',
        };
    }
    if (s.includes('error') || s.includes('fail') || s.includes('fatal') || s.includes('disqualified')) {
        return {
            badge: 'bg-red-500/10 text-red-700 border-red-500/20 dark:bg-red-500/20 dark:text-red-300 dark:border-red-500/30',
            dot: 'bg-red-400',
        };
    }
    return {
        badge: 'bg-slate-500/10 text-slate-700 border-slate-500/20 dark:bg-slate-500/20 dark:text-slate-300 dark:border-slate-500/30',
        dot: 'bg-slate-400',
    };
}

// ── Detail Row ──────────────────────────────────────────────────────────────

function DetailRow({
    icon: Icon,
    label,
    sublabel,
    value,
    valueBadge,
}: {
    icon: React.ElementType;
    label: string;
    sublabel?: string;
    value?: string;
    valueBadge?: { text: string; className: string };
}) {
    return (
        <div className="flex items-center justify-between rounded-md border border-border/40 bg-muted/20 p-2">
            <div className="flex items-center gap-2 min-w-0">
                <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-foreground">{label}</p>
                    {sublabel && <p className="text-[9px] text-muted-foreground">{sublabel}</p>}
                </div>
            </div>
            {valueBadge ? (
                <Badge variant="outline" className={cn('h-4 px-1.5 text-[9px] font-mono uppercase shrink-0', valueBadge.className)}>
                    {valueBadge.text}
                </Badge>
            ) : (
                <span className="font-mono text-[11px] text-foreground shrink-0 truncate max-w-[140px]">{value || '—'}</span>
            )}
        </div>
    );
}

// ── Telephonic Configuration Card ───────────────────────────────────────────

function TelephonicConfigCard({ workflowRun, rawMode }: { workflowRun: WorkflowRunResponse | null | undefined; rawMode: string }) {
    const ctx = workflowRun?.gathered_context ?? {};
    const initCtx = workflowRun?.initial_context ?? {};

    const direction = (initCtx.direction || ctx.direction || workflowRun?.call_type || '').toString().toUpperCase();
    const providerName = (ctx.provider || initCtx.provider || rawMode).toString().toUpperCase();
    const fromNumber = (initCtx.caller_number || ctx.caller_number || initCtx.from_number || ctx.from_number || '').toString();
    const toNumber = (initCtx.called_number || ctx.called_number || initCtx.phone_number || ctx.phone_number || initCtx.to_number || ctx.to_number || '').toString();
    const sipUri = (ctx.sip_uri || initCtx.sip_uri || '').toString();
    const trunkId = (ctx.trunk_id || initCtx.trunk_id || '').toString();
    const callSid = (ctx.call_sid || initCtx.call_sid || ctx.call_id || initCtx.call_id || ctx.channel_id || initCtx.channel_id || '').toString();

    const DirectionIcon = direction === 'INBOUND' ? PhoneIncoming : PhoneOutgoing;

    return (
        <Card className="border-border/70 bg-card/60 backdrop-blur-sm shadow-sm overflow-hidden">
            <CardHeader className="p-4 pb-2.5 flex flex-row items-center gap-2">
                <Phone className="h-3.5 w-3.5 text-orange-400" />
                <CardTitle className="text-xs font-bold uppercase tracking-wider text-foreground">
                    Telephonic Configuration
                </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-2.5 text-xs">
                {direction && (
                    <DetailRow
                        icon={DirectionIcon}
                        label="Call Direction"
                        sublabel="SIP Telephony Gateway"
                        valueBadge={{
                            text: direction,
                            className: direction === 'INBOUND'
                                ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-400'
                                : 'border-sky-500/30 bg-sky-500/15 text-sky-400',
                        }}
                    />
                )}

                <DetailRow
                    icon={Server}
                    label="Provider"
                    sublabel="Telephony Carrier"
                    valueBadge={{
                        text: providerName,
                        className: 'border-border bg-muted text-foreground',
                    }}
                />

                {fromNumber && (
                    <DetailRow
                        icon={Radio}
                        label="From Number"
                        sublabel="Caller / Connected Line"
                        value={fromNumber}
                    />
                )}

                {toNumber && (
                    <DetailRow
                        icon={User}
                        label="To Number"
                        sublabel="Dialed Destination"
                        value={toNumber}
                    />
                )}

                {sipUri && (
                    <DetailRow
                        icon={Globe}
                        label="SIP URI"
                        sublabel="SIP Endpoint Address"
                        value={sipUri}
                    />
                )}

                {trunkId && (
                    <DetailRow
                        icon={Server}
                        label="Trunk ID"
                        sublabel="Carrier Trunk"
                        value={trunkId}
                    />
                )}

                {callSid && (
                    <DetailRow
                        icon={Radio}
                        label="Call SID"
                        sublabel="Provider Call Identifier"
                        value={callSid}
                    />
                )}

                {!direction && !fromNumber && !toNumber && (
                    <p className="text-[11px] text-muted-foreground leading-relaxed py-1">
                        Telephonic details will appear here once the call connects.
                    </p>
                )}
            </CardContent>
        </Card>
    );
}

// ── Test Agent Configuration Card ───────────────────────────────────────────

function TestAgentConfigCard({ workflowRun }: { workflowRun?: WorkflowRunResponse | null }) {
    const ctx = workflowRun?.gathered_context ?? {};
    const initCtx = workflowRun?.initial_context ?? {};

    const userAgent = (ctx.user_agent || initCtx.user_agent || '').toString();
    const browserInfo = (ctx.browser || initCtx.browser || '').toString();
    const ipAddress = (ctx.ip_address || initCtx.ip_address || '').toString();

    return (
        <Card className="border-border/70 bg-card/60 backdrop-blur-sm shadow-sm overflow-hidden">
            <CardHeader className="p-4 pb-2.5 flex flex-row items-center gap-2">
                <Monitor className="h-3.5 w-3.5 text-sky-400" />
                <CardTitle className="text-xs font-bold uppercase tracking-wider text-foreground">
                    Test Agent Configuration
                </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-2.5 text-xs">
                <DetailRow
                    icon={Wifi}
                    label="Connection"
                    sublabel="Browser Test Call"
                    valueBadge={{
                        text: 'WebRTC direct',
                        className: 'border-sky-500/30 bg-sky-500/15 text-sky-400',
                    }}
                />

                <DetailRow
                    icon={Laptop}
                    label="Client"
                    sublabel="Workflow Editor Test"
                    value={browserInfo || userAgent || 'Browser'}
                />

                {ipAddress && (
                    <DetailRow
                        icon={Server}
                        label="IP Address"
                        sublabel="Tester Network Address"
                        value={ipAddress}
                    />
                )}
            </CardContent>
        </Card>
    );
}

// ── Embed Configuration Card ────────────────────────────────────────────────

function EmbedConfigCard({ workflowRun }: { workflowRun?: WorkflowRunResponse | null }) {
    const ctx = workflowRun?.gathered_context ?? {};
    const initCtx = workflowRun?.initial_context ?? {};

    const userAgent = (ctx.user_agent || initCtx.user_agent || '').toString();
    const browserInfo = (ctx.browser || initCtx.browser || '').toString();
    const ipAddress = (ctx.ip_address || initCtx.ip_address || '').toString();
    const embedOrigin = (ctx.embed_origin || initCtx.embed_origin || initCtx.origin || '').toString();

    return (
        <Card className="border-border/70 bg-card/60 backdrop-blur-sm shadow-sm overflow-hidden">
            <CardHeader className="p-4 pb-2.5 flex flex-row items-center gap-2">
                <Code className="h-3.5 w-3.5 text-emerald-400" />
                <CardTitle className="text-xs font-bold uppercase tracking-wider text-foreground">
                    Embed Configuration
                </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-2.5 text-xs">
                <DetailRow
                    icon={Wifi}
                    label="Connection"
                    sublabel="Website Visitor Session"
                    valueBadge={{
                        text: 'Embedded widget',
                        className: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-400',
                    }}
                />

                <DetailRow
                    icon={Laptop}
                    label="Client"
                    sublabel="Public Embed Widget"
                    value={browserInfo || userAgent || 'Browser'}
                />

                {embedOrigin && (
                    <DetailRow
                        icon={Globe}
                        label="Origin"
                        sublabel="Embed Source Domain"
                        value={embedOrigin}
                    />
                )}

                {ipAddress && (
                    <DetailRow
                        icon={Server}
                        label="IP Address"
                        sublabel="Visitor Network Address"
                        value={ipAddress}
                    />
                )}
            </CardContent>
        </Card>
    );
}

// ── Text Chat Configuration Card ────────────────────────────────────────────

function TextChatConfigCard({ workflowRun }: { workflowRun?: WorkflowRunResponse | null }) {
    const ctx = workflowRun?.gathered_context ?? {};
    const initCtx = workflowRun?.initial_context ?? {};

    const platform = (ctx.platform || initCtx.platform || '').toString();
    const userId = (ctx.user_id || initCtx.user_id || '').toString();
    const embedOrigin = (ctx.embed_origin || initCtx.embed_origin || initCtx.origin || '').toString();

    return (
        <Card className="border-border/70 bg-card/60 backdrop-blur-sm shadow-sm overflow-hidden">
            <CardHeader className="p-4 pb-2.5 flex flex-row items-center gap-2">
                <MessageSquare className="h-3.5 w-3.5 text-violet-400" />
                <CardTitle className="text-xs font-bold uppercase tracking-wider text-foreground">
                    Text Chat Configuration
                </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-2.5 text-xs">
                <DetailRow
                    icon={Monitor}
                    label="Channel"
                    sublabel="Text Conversation"
                    valueBadge={{
                        text: 'Text chat',
                        className: 'border-violet-500/30 bg-violet-500/15 text-violet-400',
                    }}
                />

                {platform && (
                    <DetailRow
                        icon={Laptop}
                        label="Platform"
                        sublabel="Client Device"
                        value={platform}
                    />
                )}

                {userId && (
                    <DetailRow
                        icon={User}
                        label="User ID"
                        sublabel="Chat User Identifier"
                        value={userId}
                    />
                )}

                {embedOrigin && (
                    <DetailRow
                        icon={Globe}
                        label="Origin"
                        sublabel="Embed Source Domain"
                        value={embedOrigin}
                    />
                )}

                {!platform && !userId && !embedOrigin && (
                    <p className="text-[11px] text-muted-foreground leading-relaxed py-1">
                        Text-based conversation — no telephony or WebRTC connection details.
                    </p>
                )}
            </CardContent>
        </Card>
    );
}

// ── Main Component ──────────────────────────────────────────────────────────

export function SessionOverviewSidebar({
    workflowRun,
    runId,
    organizationName,
}: SessionOverviewSidebarProps) {
    const [copiedField, setCopiedField] = useState<string | null>(null);

    const handleCopy = (text: string, fieldName: string) => {
        navigator.clipboard.writeText(text);
        setCopiedField(fieldName);
        toast.success(`Copied ${fieldName} to clipboard`);
        setTimeout(() => setCopiedField(null), 2000);
    };

    const rawMode = workflowRun?.mode ? String(workflowRun.mode).toLowerCase() : '';
    const channelType = classifyChannel(rawMode);
    const channelInfo = getChannelDisplay(channelType, rawMode);
    const ChannelIcon = channelInfo.icon;

    const durationSeconds = Number(workflowRun?.cost_info?.call_duration_seconds) || 0;
    const durationFormatted = formatDurationTimestamp(durationSeconds);

    const rtConfig = workflowRun?.initial_context?.runtime_configuration as Record<string, unknown> | undefined;
    const language = (
        (workflowRun?.gathered_context?.language as string) ||
        (workflowRun?.initial_context?.language as string) ||
        (rtConfig?.language as string) ||
        ''
    ).toString().toUpperCase();

    const events = (workflowRun?.logs?.realtime_feedback_events ?? []) as RealtimeFeedbackEvent[];
    const userTurns = events.filter((ev) => ev.type === 'rtf-user-transcription' && ev.payload?.final).length;
    const botTurns = events.filter((ev) => ev.type === 'rtf-bot-text').length;
    const totalMessages = userTurns + botTurns;

    const rawDisposition = String(workflowRun?.disposition || workflowRun?.gathered_context?.call_disposition || '');
    const statusFormatted = rawDisposition
        ? rawDisposition.replace(/_/g, ' ').toUpperCase()
        : workflowRun?.is_completed ? 'COMPLETED' : 'IN PROGRESS';
    const statusStyle = getStatusBadgeStyle(rawDisposition || statusFormatted);
    const statusLabel = statusFormatted.charAt(0) + statusFormatted.slice(1).toLowerCase();

    const startDate = workflowRun?.created_at ? new Date(workflowRun.created_at) : null;
    const endDate = startDate && durationSeconds > 0 ? new Date(startDate.getTime() + durationSeconds * 1000) : null;

    const gathered = workflowRun?.gathered_context ?? {};
    const extractedEntries = Object.entries(gathered).filter(([k, v]) => {
        if (!v) return false;
        const lower = k.toLowerCase();
        return !lower.includes('report') && !lower.includes('trace') && !lower.includes('node') && typeof v !== 'object';
    });

    const convoIdDisplay = `convo_${runId}`;

    return (
        <div className="w-full space-y-4">

            {/* ── CARD 1: SESSION OVERVIEW ── */}
            <Card className="border-border/70 bg-card/60 backdrop-blur-sm shadow-sm overflow-hidden">
                <CardHeader className="p-4 pb-3">
                    <CardTitle className="text-xs font-bold uppercase tracking-wider text-foreground">
                        Session Overview
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0 space-y-3">
                    <div className="grid grid-cols-2 gap-2.5">
                        {/* Channel */}
                        <div className="rounded-lg border border-border/40 bg-muted/20 p-2.5 flex items-center gap-3">
                            <div className="h-8 w-8 rounded-md bg-muted/40 border border-border/50 flex items-center justify-center shrink-0">
                                <ChannelIcon className="h-4 w-4 text-muted-foreground" />
                            </div>
                            <div className="min-w-0">
                                <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">Channel</p>
                                <Badge variant="outline" className={cn('mt-0.5 h-4 px-1.5 text-[9px] font-mono', channelInfo.color)}>
                                    {channelInfo.label}
                                </Badge>
                            </div>
                        </div>

                        {/* Language */}
                        <div className="rounded-lg border border-border/40 bg-muted/20 p-2.5 flex items-center gap-3">
                            <div className="h-8 w-8 rounded-md bg-muted/40 border border-border/50 flex items-center justify-center shrink-0">
                                <Globe className="h-4 w-4 text-muted-foreground" />
                            </div>
                            <div className="min-w-0">
                                <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">Language</p>
                                <p className="text-xs font-bold font-mono text-foreground uppercase truncate">{language || '—'}</p>
                            </div>
                        </div>

                        {/* Duration */}
                        <div className="rounded-lg border border-border/40 bg-muted/20 p-2.5 flex items-center gap-3">
                            <div className="h-8 w-8 rounded-md bg-muted/40 border border-border/50 flex items-center justify-center shrink-0">
                                <Clock className="h-4 w-4 text-muted-foreground" />
                            </div>
                            <div className="min-w-0">
                                <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">Duration</p>
                                <p className="text-xs font-bold font-mono text-foreground">{durationFormatted}</p>
                            </div>
                        </div>

                        {/* Messages */}
                        <div className="rounded-lg border border-border/40 bg-muted/20 p-2.5 flex items-center gap-3">
                            <div className="h-8 w-8 rounded-md bg-muted/40 border border-border/50 flex items-center justify-center shrink-0">
                                <MessageSquare className="h-4 w-4 text-muted-foreground" />
                            </div>
                            <div className="min-w-0">
                                <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">Messages</p>
                                <p className="text-xs font-bold font-mono text-foreground">{totalMessages}</p>
                            </div>
                        </div>
                    </div>

                    {/* Status */}
                    <div className="rounded-lg border border-border/40 bg-muted/20 p-2.5 flex items-center gap-3">
                        <div className="h-8 w-8 rounded-md bg-muted/40 border border-border/50 flex items-center justify-center shrink-0">
                            <Activity className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                            <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">Status</p>
                            <Badge
                                variant="outline"
                                className={cn(
                                    "mt-0.5 h-4 px-1.5 text-[9px] font-mono uppercase flex items-center gap-1 w-fit border transition-colors",
                                    statusStyle.badge
                                )}
                            >
                                <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", statusStyle.dot)} />
                                {statusLabel}
                            </Badge>
                        </div>
                    </div>

                    {/* Timeline */}
                    {startDate && (
                        <div className="rounded-lg border border-border/40 bg-muted/15 p-2.5 flex items-center justify-between text-[11px]">
                            <div className="space-y-0.5">
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                                    <Calendar className="h-3 w-3" /> Started
                                </p>
                                <p className="text-[10px] font-mono text-foreground/80">{formatTimelineDate(startDate)}</p>
                            </div>
                            {endDate && (
                                <div className="space-y-0.5 text-right">
                                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                        Ended
                                    </p>
                                    <p className="text-[10px] font-mono text-foreground/80">{formatTimelineDate(endDate)}</p>
                                </div>
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* ── CARD 2: LEAD INFO — EXTRACTED VARIABLES ── */}
            <Card className="border-border/70 bg-card/60 backdrop-blur-sm shadow-sm overflow-hidden">
                <CardHeader className="p-4 pb-2.5">
                    <CardTitle className="text-xs font-bold uppercase tracking-wider text-foreground">
                        Lead Info — Extracted Variables
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                    {extractedEntries.length > 0 ? (
                        <div className="space-y-2">
                            {extractedEntries.map(([key, value]) => (
                                <div key={key} className="flex items-center justify-between rounded-md border border-border/40 bg-muted/20 px-2.5 py-1.5 text-xs">
                                    <span className="font-semibold text-muted-foreground capitalize">{key.replace(/_/g, ' ')}:</span>
                                    <span className="font-mono text-foreground">{String(value)}</span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                            No variables captured yet. Enable extraction on the workflow node (Extraction — variables) and they will appear here as the LLM fills them.
                        </p>
                    )}
                </CardContent>
            </Card>

            {/* ── CARD 3: CHANNEL-SPECIFIC CONFIGURATION ── */}
            {channelType === 'telephonic' && (
                <TelephonicConfigCard workflowRun={workflowRun} rawMode={rawMode} />
            )}
            {channelType === 'test-agent' && (
                <TestAgentConfigCard workflowRun={workflowRun} />
            )}
            {channelType === 'embed' && (
                <EmbedConfigCard workflowRun={workflowRun} />
            )}
            {channelType === 'textchat' && (
                <TextChatConfigCard workflowRun={workflowRun} />
            )}

            {/* ── CARD 4: SESSION IDENTIFIERS ── */}
            <Card className="border-border/70 bg-card/60 backdrop-blur-sm shadow-sm overflow-hidden">
                <CardHeader className="p-4 pb-2.5">
                    <CardTitle className="text-xs font-bold uppercase tracking-wider text-foreground">
                        Session Identifiers
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0 space-y-3 text-xs">
                    <div className="space-y-1">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Conversation ID
                        </div>
                        <div className="flex items-center justify-between rounded-md border border-border/40 bg-muted/30 px-2.5 py-1.5 font-mono text-[11px] text-foreground">
                            <span className="truncate pr-2">{convoIdDisplay}</span>
                            <button
                                type="button"
                                onClick={() => handleCopy(convoIdDisplay, 'Conversation ID')}
                                className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                            >
                                {copiedField === 'Conversation ID' ? (
                                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                                ) : (
                                    <Copy className="h-3.5 w-3.5" />
                                )}
                            </button>
                        </div>
                    </div>

                    <div className="space-y-1">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Channel
                        </div>
                        <div className="rounded-md border border-border/40 bg-muted/30 px-2.5 py-1.5 text-[11px] font-medium text-foreground flex items-center gap-2">
                            <ChannelIcon className="h-3 w-3 text-muted-foreground shrink-0" />
                            {channelInfo.label.charAt(0) + channelInfo.label.slice(1).toLowerCase()}
                        </div>
                    </div>

                    {workflowRun?.workflow_id && (
                        <div className="space-y-1">
                            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                Workflow ID
                            </div>
                            <div className="flex items-center justify-between rounded-md border border-border/40 bg-muted/30 px-2.5 py-1.5 font-mono text-[11px] text-foreground">
                                <span>{workflowRun.workflow_id}</span>
                                <button
                                    type="button"
                                    onClick={() => handleCopy(String(workflowRun.workflow_id), 'Workflow ID')}
                                    className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                                >
                                    {copiedField === 'Workflow ID' ? (
                                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                                    ) : (
                                        <Copy className="h-3.5 w-3.5" />
                                    )}
                                </button>
                            </div>
                        </div>
                    )}

                    {organizationName && (
                        <div className="space-y-1">
                            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                Organization
                            </div>
                            <div className="rounded-md border border-border/40 bg-muted/30 px-2.5 py-1.5 text-[11px] font-medium text-foreground truncate">
                                {organizationName}
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

        </div>
    );
}
