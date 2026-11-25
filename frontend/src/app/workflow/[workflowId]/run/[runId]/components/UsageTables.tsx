'use client';

import { AlertTriangle, ChevronDown, ChevronRight, Coins } from 'lucide-react';
import React, { Fragment, useEffect, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatExactUsd, formatItemCost, formatTotalCost } from '@/lib/modelPricing';
import { cn } from '@/lib/utils';

import { ClientReferenceId } from './ClientReferenceId';
import type { BilledTokenPart, ProviderUsage } from './providerUsage';
import { getUsageSourceLabel, isAwaitingBilling, toBilledInput, toBilledOutput } from './providerUsage';
import type { SpeechTokenPart, SpeechTokenSplit } from './sonioxUsage';
import { isSonioxService, sonioxSttSplit, sonioxTtsSplit } from './sonioxUsage';
import type {
    CaseGroup,
    QaSummary,
    TokenBreakdown,
    UsageCase,
    UsageEntry,
    UsageIssue,
} from './usageBreakdown';
import { CASE_ORDER } from './usageBreakdown';

/** Makes service names human-readable in the table rows. */
function formatServiceLabel(service: string): string {
    // ReportGeneration_Regen  → Report Generation (Regen 1)
    // ReportGeneration_Regen2 → Report Generation (Regen 2)
    const regenMatch = service.match(/^ReportGeneration_Regen(\d*)$/i);
    if (regenMatch) {
        const num = regenMatch[1] ? parseInt(regenMatch[1], 10) + 1 : 1;
        return `Report Generation (Regen ${num})`;
    }
    if (/^ReportGeneration$/i.test(service)) return 'Report Generation';
    if (/^QAAnalysis$/i.test(service)) return 'QA Analysis';
    // Completeness_Reeval  → Completeness (Re-eval 1)
    // Completeness_Reeval2 → Completeness (Re-eval 2)
    const reevalMatch = service.match(/^Completeness_Reeval(\d*)$/i);
    if (reevalMatch) {
        const num = reevalMatch[1] ? parseInt(reevalMatch[1], 10) : 1;
        return `Completeness (Re-eval ${num})`;
    }
    if (/^Completeness$/i.test(service)) return 'Completeness Eval';
    if (/^(ConversationTitle|conversation_title)$/i.test(service)) return 'Conversation Title';
    return service;
}

const TYPE_COLORS: Record<UsageEntry['type'], string> = {
    LLM: 'bg-blue-500/10 text-blue-500 border-blue-500/30',
    STS: 'bg-pink-500/10 text-pink-500 border-pink-500/30',
    TTS: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30',
    STT: 'bg-amber-500/10 text-amber-500 border-amber-500/30',
};

const HEAD_CELL = 'py-2.5 px-3 text-right text-[10px] uppercase font-semibold text-muted-foreground tracking-wider';
const BODY_CELL = 'py-2.5 px-3 text-right font-mono text-[11px]';

const formatUSD = formatExactUsd;

function getSpeechSplit(entry: UsageEntry): SpeechTokenSplit | null {
    if (!isSonioxService(entry.service)) return null;
    if (entry.type === 'STT') return sonioxSttSplit(entry.totalUnits);
    if (entry.type === 'TTS') return sonioxTtsSplit(entry.totalUnits);
    return null;
}

function SpeechTokenCell({ part, priced }: { part: SpeechTokenPart; priced: boolean }) {
    const title = part.exact
        ? 'Calculated from audio length: 1 Soniox audio token per 120 ms.'
        : "Estimated from Soniox's published averages. The provider's actual token count is not recorded.";
    return (
        <div title={title}>
            <div>{part.exact ? '' : '~'}{part.tokens.toLocaleString()} {part.label}</div>
            {priced && <div className="text-[9px] text-muted-foreground">{formatUSD(part.costUsd)}</div>}
        </div>
    );
}

function BilledTokenCell({ part }: { part: BilledTokenPart }) {
    return (
        <div title={part.detail}>
            <div>{part.tokens.toLocaleString()} {part.label}</div>
            <div className="text-[9px] text-muted-foreground">{formatUSD(part.costUsd)}</div>
        </div>
    );
}

function InactiveValue() {
    return (
        <span className="text-muted-foreground/60 text-[10px] font-sans font-medium" title="Not applicable">
            Inactive
        </span>
    );
}


function formatUnits(entry: UsageEntry): string {
    if (!Number.isFinite(entry.totalUnits)) return '—';
    return `${entry.totalUnits.toLocaleString()} ${entry.unitLabel}`;
}

function formatCaseStatus(
    group: CaseGroup,
    qaSummary: QaSummary | null,
    reportStatus: string | null,
    reportReady: boolean,
): string {
    if (group.case === 'QA Results' && qaSummary && qaSummary.nodes > 0) {
        const score = qaSummary.avgScore === null ? '' : ` • avg ${qaSummary.avgScore.toFixed(1)}`;
        const tags = qaSummary.tags === 0 ? '' : ` • ${qaSummary.tags} tags`;
        const errors = qaSummary.errors === 0 ? '' : ` • ${qaSummary.errors} failed`;
        return `${qaSummary.nodes} QA nodes${score}${tags}${errors}`;
    }
    if (group.case === 'Report Generation') {
        const regenCount = group.entries.filter(e => e.service.toLowerCase().includes('_regen')).length;
        const regenLabel = regenCount > 0 ? ` • ${regenCount} regen${regenCount > 1 ? 's' : ''}` : '';
        return `${reportStatus ?? 'not started'}${reportReady ? ' • ready' : ''}${regenLabel}`;
    }
    if (group.case === 'Conversation Completeness' && group.entries.length > 0) {
        const evals = group.entries.length;
        const reevals = group.entries.filter(e => /_reeval/i.test(e.service)).length;
        const reevalLabel = reevals > 0 ? ` • ${reevals} re-eval${reevals > 1 ? 's' : ''}` : '';
        return `${evals} evaluation${evals > 1 ? 's' : ''}${reevalLabel}`;
    }
    if (!group.recorded) return 'usage not recorded';
    return `${group.entries.length} usage ${group.entries.length === 1 ? 'entry' : 'entries'}`;
}

function pctOf(part: number, total: number): string {
    if (total <= 0 || part <= 0) return '';
    const p = (part / total) * 100;
    if (p < 0.1) return '< 0.1%';
    return `${p.toFixed(1)}%`;
}

export function ValidationNotes({ issues }: { issues: UsageIssue[] }) {
    if (issues.length === 0) return null;
    return null;
}


function CaseSectionHeader({
    group,
    qaSummary,
    reportStatus,
    reportReady,
    expanded,
    onToggle,
    grandTotalCost,
}: {
    group: CaseGroup;
    qaSummary: QaSummary | null;
    reportStatus: string | null;
    reportReady: boolean;
    expanded: boolean;
    onToggle: () => void;
    grandTotalCost: number;
}) {
    const status = formatCaseStatus(group, qaSummary, reportStatus, reportReady);
    const costPct = pctOf(group.totals.costUsd, grandTotalCost);
    const hasEntries = group.entries.length > 0;
    const Chevron = expanded ? ChevronDown : ChevronRight;

    return (
        <tr
            className={cn(
                'border-t-2 border-border/70 bg-muted/30 transition-colors',
                hasEntries && 'cursor-pointer hover:bg-muted/50',
            )}
            onClick={hasEntries ? onToggle : undefined}
        >
            <td className="py-3 px-3">
                <div className="flex items-center gap-2">
                    {hasEntries && <Chevron className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                    {!hasEntries && <span className="w-3.5" />}
                    <span className="text-xs font-semibold text-foreground">
                        {group.case}
                    </span>
                </div>
            </td>
            <td className="py-3 px-3 text-center">
                {hasEntries ? (
                    <span className="text-[11px] font-mono font-medium text-foreground">
                        {group.entries.length} {group.entries.length === 1 ? 'entry' : 'entries'}
                    </span>
                ) : (
                    <span className="text-[11px] font-mono text-muted-foreground/50">—</span>
                )}
            </td>
            <td className="py-3 px-3 text-center">
                {hasEntries ? (
                    <div className="flex flex-wrap items-center justify-center gap-1">
                        {Array.from(new Set(group.entries.map(e => e.type))).map(t => (
                            <Badge
                                key={t}
                                variant="outline"
                                className={cn('text-[9px] px-1.5 py-0 font-mono font-medium', TYPE_COLORS[t as UsageEntry['type']] || 'text-foreground')}
                            >
                                {t}
                            </Badge>
                        ))}
                    </div>
                ) : (
                    <span className="text-[10px] text-muted-foreground/50 font-mono">—</span>
                )}
            </td>
            <td className={cn(BODY_CELL, 'font-semibold')}>
                {group.totals.promptTokens > 0 ? group.totals.promptTokens.toLocaleString() : '—'}
            </td>
            <td className={cn(BODY_CELL, 'font-semibold')}>
                {group.totals.completionTokens > 0 ? group.totals.completionTokens.toLocaleString() : '—'}
            </td>
            <td className={cn(BODY_CELL, 'font-semibold', group.totals.cacheReadTokens > 0 ? 'text-amber-400' : 'text-muted-foreground/50')}>
                {group.totals.cacheReadTokens > 0 || group.totals.cacheCreationTokens > 0
                    ? `${group.totals.cacheReadTokens.toLocaleString()} / ${group.totals.cacheCreationTokens.toLocaleString()}`
                    : '—'}
            </td>
            <td className={cn(BODY_CELL, 'font-semibold text-foreground')}>
                {group.totals.totalTokens > 0 && <div>{group.totals.totalTokens.toLocaleString()} tok</div>}
                {group.totals.ttsChars > 0 && <div className="text-[10px] text-muted-foreground">{group.totals.ttsChars.toLocaleString()} ch</div>}
                {group.totals.sttSeconds > 0 && <div className="text-[10px] text-muted-foreground">{group.totals.sttSeconds.toFixed(1)}s</div>}
                {group.totals.totalTokens <= 0 && group.totals.ttsChars <= 0 && group.totals.sttSeconds <= 0 && '—'}
            </td>
            <td className={cn(BODY_CELL, 'font-bold text-emerald-400')}>
                <div>{formatTotalCost(formatUSD, group.totals.costUsd, group.totals.unpricedEntries)}</div>
                {costPct && <div className="text-[9px] font-normal text-muted-foreground">{costPct}</div>}
            </td>
            <td
                className={cn(
                    "py-3 px-3 text-right text-[10px] max-w-[150px] truncate",
                    hasEntries ? "text-foreground font-medium" : "text-muted-foreground/60"
                )}
                title={status}
            >
                {status}
            </td>
        </tr>
    );
}

function UsageEntryRow({
    entry,
    grandTotalCost,
    providerUsage,
}: {
    entry: UsageEntry;
    grandTotalCost: number;
    providerUsage?: ProviderUsage | null;
}) {
    const hasCache = entry.cacheReadTokens > 0 || entry.cacheCreationTokens > 0;
    const isTokenBased = entry.type === 'LLM' || entry.type === 'STS';
    const costPct = pctOf(entry.costUsd, grandTotalCost);
    const speechSplit = getSpeechSplit(entry);
    const sourceLabel = getUsageSourceLabel({
        type: entry.type,
        service: entry.service,
        model: entry.model,
        billed: Boolean(entry.billed),
        awaitsBilling: isAwaitingBilling(providerUsage, entry.service),
    });

    return (
        <tr className="hover:bg-muted/20 transition-colors border-b border-border/20">
            <td className="py-2.5 px-3 pl-10 font-sans text-xs text-foreground max-w-[240px]" title={`${entry.service} / ${entry.model}`}>
                <div className="flex items-center gap-1.5">
                    <span className="font-medium truncate">{entry.model}</span>
                    {entry.notes.length > 0 && (
                        <AlertTriangle className="h-3 w-3 text-amber-400 shrink-0" aria-label={entry.notes.join('; ')} />
                    )}
                </div>
                <div className="text-[10px] text-muted-foreground truncate">{formatServiceLabel(entry.service)}</div>
                <div className="text-[9px] text-muted-foreground/80 truncate">{sourceLabel}</div>
                {entry.billed && providerUsage?.client_reference_id && (
                    <ClientReferenceId referenceId={providerUsage.client_reference_id} />
                )}
            </td>
            <td className="py-2.5 px-3 text-center">
                <span className="text-[10px] font-mono text-muted-foreground">
                    1 entry
                </span>
            </td>
            <td className="py-2.5 px-3 text-center">
                <Badge variant="outline" className={cn('text-[9px] px-1.5 py-0', TYPE_COLORS[entry.type])}>
                    {entry.type}
                </Badge>
            </td>
            <td className={BODY_CELL}>
                {isTokenBased ? (
                    <div>
                        <div>{entry.promptTokens.toLocaleString()}</div>
                        {hasCache && entry.cacheReadTokens > 0 && (
                            <div className="text-[9px] text-amber-400">
                                ({entry.cacheReadTokens.toLocaleString()} cached)
                            </div>
                        )}
                    </div>
                ) : entry.billed ? (
                    <BilledTokenCell part={toBilledInput(entry.billed)} />
                ) : speechSplit ? (
                    <SpeechTokenCell part={speechSplit.input} priced={entry.priced} />
                ) : entry.type === 'STT' ? (
                    <div className="text-muted-foreground">{entry.totalUnits.toFixed(1)}s audio</div>
                ) : entry.type === 'TTS' ? (
                    <div className="text-muted-foreground">{entry.totalUnits.toLocaleString()} chars</div>
                ) : <InactiveValue />}
            </td>
            <td className={BODY_CELL}>
                {isTokenBased ? (
                    entry.completionTokens.toLocaleString()
                ) : entry.billed ? (
                    <BilledTokenCell part={toBilledOutput(entry.billed)} />
                ) : speechSplit ? (
                    <SpeechTokenCell part={speechSplit.output} priced={entry.priced} />
                ) : (
                    <InactiveValue />
                )}
            </td>
            <td className={cn(BODY_CELL, hasCache ? 'text-amber-400' : 'text-muted-foreground/60')}>
                {!isTokenBased ? (
                    // Caching does not apply to TTS / STT.
                    <InactiveValue />
                ) : entry.cacheRecorded || hasCache ? (
                    <div>
                        <div>{entry.cacheReadTokens.toLocaleString()} read</div>
                        <div className="text-[9px]">{entry.cacheCreationTokens.toLocaleString()} write</div>
                    </div>
                ) : (
                    <span
                        className="text-muted-foreground/60 text-[10px] font-sans font-medium"
                        title="This call's cache usage was not captured, so the real value is unknown (not zero)."
                    >
                        Not recorded
                    </span>
                )}
            </td>
            <td className={cn(BODY_CELL, 'text-foreground')}>{formatUnits(entry)}</td>
            <td className={cn(BODY_CELL, 'font-semibold text-emerald-400')}>
                <div>{formatItemCost(formatUSD, entry.costUsd, entry.priced)}</div>
                {costPct && <div className="text-[9px] font-normal text-muted-foreground">{costPct}</div>}
            </td>
            <td className="py-2.5 px-3" />
        </tr>
    );
}

function UnrecordedCaseRow({ group }: { group: CaseGroup }) {
    const message = group.recorded
        ? 'No usage recorded for this run'
        : 'Usage not tracked separately';
    return (
        <tr className="text-muted-foreground/70">
            <td colSpan={3} className="py-2.5 px-3 pl-10 font-sans text-[11px]">{message}</td>
            <td colSpan={6} className="py-2.5 px-3 text-[10px] leading-relaxed">{group.note}</td>
        </tr>
    );
}

export function TokenUsageBreakdownTable({
    providerUsage,
    breakdown,
    qaSummary,
    reportStatus,
    reportReady,
}: {
    breakdown: TokenBreakdown;
    providerUsage?: ProviderUsage | null;
    qaSummary: QaSummary | null;
    reportStatus: string | null;
    reportReady: boolean;
}) {
    const orderedGroups = CASE_ORDER
        .map((usageCase) => breakdown.groups.find((group) => group.case === usageCase))
        .filter((group): group is CaseGroup => Boolean(group));

    const [isTableExpanded, setIsTableExpanded] = useState(false);

    const [expandedCases, setExpandedCases] = useState<Set<UsageCase>>(() => {
        const initial = new Set<UsageCase>();
        for (const g of orderedGroups) {
            if (g.entries.length > 0) initial.add(g.case);
        }
        return initial;
    });

    // A case that gains entries after mount (usage fetched later, or a
    // re-evaluation adds the first row) expands once; a case the user
    // collapsed stays collapsed.
    const seenWithEntries = useRef<Set<UsageCase>>(
        new Set(orderedGroups.filter((g) => g.entries.length > 0).map((g) => g.case)),
    );
    const casesWithEntries = orderedGroups
        .filter((g) => g.entries.length > 0)
        .map((g) => g.case)
        .join('|');
    useEffect(() => {
        const fresh = casesWithEntries
            .split('|')
            .filter((c): c is UsageCase => c !== '' && !seenWithEntries.current.has(c as UsageCase));
        if (fresh.length === 0) return;
        fresh.forEach((c) => seenWithEntries.current.add(c));
        setExpandedCases((prev) => new Set([...prev, ...fresh]));
    }, [casesWithEntries]);

    if (orderedGroups.length === 0) return null;

    const toggleCase = (c: UsageCase) => {
        setExpandedCases((prev) => {
            const next = new Set(prev);
            if (next.has(c)) next.delete(c);
            else next.add(c);
            return next;
        });
    };

    const grandTotalCost = breakdown.totals.costUsd;
    const totalEntries = orderedGroups.reduce((sum, g) => sum + g.entries.length, 0);

    const allSubCasesExpanded = orderedGroups.length > 0 && orderedGroups.every((g) => expandedCases.has(g.case));
    const toggleAllSubCases = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (allSubCasesExpanded) {
            setExpandedCases(new Set());
        } else {
            setExpandedCases(new Set(orderedGroups.map((g) => g.case)));
        }
    };

    return (
        <Card className="border-border/70 bg-card/60 backdrop-blur-sm overflow-hidden shadow-sm transition-all duration-200">
            <CardHeader
                className={cn(
                    'p-4 transition-colors select-none cursor-pointer hover:bg-muted/30',
                    isTableExpanded ? 'pb-3' : 'py-3.5',
                )}
                onClick={() => setIsTableExpanded(!isTableExpanded)}
                role="button"
                aria-expanded={isTableExpanded}
                title={isTableExpanded ? 'Click to collapse table' : 'Click to expand table'}
            >
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        {isTableExpanded ? (
                            <ChevronDown className="h-4 w-4 text-sky-400 shrink-0" />
                        ) : (
                            <ChevronRight className="h-4 w-4 text-sky-400 shrink-0" />
                        )}
                        <CardTitle className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-foreground">
                            <Coins className="h-4 w-4 text-sky-400" />
                            Token Usage Breakdown
                        </CardTitle>
                    </div>
                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        {isTableExpanded && totalEntries > 0 && (
                            <button
                                type="button"
                                onClick={toggleAllSubCases}
                                className="text-[10px] text-muted-foreground hover:text-foreground font-medium underline-offset-2 hover:underline mr-1"
                            >
                                {allSubCasesExpanded ? 'Collapse sub-cases' : 'Expand sub-cases'}
                            </button>
                        )}
                        <Badge variant="outline" className="h-5 px-2 text-[10px] font-mono font-medium border-border bg-muted text-foreground">
                            {totalEntries} recorded services • {orderedGroups.filter(g => g.entries.length > 0).length}/{orderedGroups.length} cases active
                        </Badge>
                        <Badge variant="outline" className="h-5 px-2 text-[10px] font-mono font-bold border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                            Estimated: {formatUSD(grandTotalCost)}
                        </Badge>
                    </div>
                </div>
            </CardHeader>
            {isTableExpanded && (
                <CardContent className="overflow-x-auto p-0">
                    <table className="w-full text-xs">
                        <thead className="border-y border-border/50 bg-muted/40">
                            <tr>
                                <th className="py-2.5 px-3 text-left text-[10px] uppercase font-semibold text-muted-foreground tracking-wider w-[200px]">Service / Model</th>
                                <th className="py-2.5 px-3 text-center text-[10px] uppercase font-semibold text-muted-foreground tracking-wider w-[80px]">Entries</th>
                                <th className="py-2.5 px-3 text-center text-[10px] uppercase font-semibold text-muted-foreground tracking-wider w-[70px]">Type</th>
                                <th className={cn(HEAD_CELL, 'w-[110px]')}>Input Tokens</th>
                                <th className={cn(HEAD_CELL, 'w-[100px]')}>Output Tokens</th>
                                <th className={cn(HEAD_CELL, 'w-[110px]')}>Cache R / W</th>
                                <th className={cn(HEAD_CELL, 'w-[100px]')}>Total Units</th>
                                <th className={cn(HEAD_CELL, 'w-[90px]')}>Est. Cost</th>
                                <th className={cn(HEAD_CELL, 'w-[120px]')}>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {orderedGroups.map((group) => {
                                const isExpanded = expandedCases.has(group.case);
                                return (
                                    <Fragment key={group.case}>
                                        <CaseSectionHeader
                                            group={group}
                                            qaSummary={qaSummary}
                                            reportStatus={reportStatus}
                                            reportReady={reportReady}
                                            expanded={isExpanded}
                                            onToggle={() => toggleCase(group.case)}
                                            grandTotalCost={grandTotalCost}
                                        />
                                        {isExpanded && group.entries.map((entry) => (
                                            <UsageEntryRow
                                                key={entry.id}
                                                entry={entry}
                                                grandTotalCost={grandTotalCost}
                                                providerUsage={providerUsage}
                                            />
                                        ))}
                                        {isExpanded && group.entries.length === 0 && (
                                            <UnrecordedCaseRow group={group} />
                                        )}
                                    </Fragment>
                                );
                            })}
                        </tbody>
                        <tfoot className="border-t-2 border-border/70 bg-muted/40">
                            <tr className="text-xs font-bold">
                                <td className="py-3 px-3">
                                    <span className="uppercase tracking-wider text-foreground text-[11px]">Grand Total</span>
                                    <span className="ml-2 text-[10px] font-mono font-normal text-muted-foreground">
                                        (all {orderedGroups.filter(g => g.entries.length > 0).length} cases)
                                    </span>
                                </td>
                                <td className="py-3 px-3 text-center font-mono font-bold text-foreground text-[11px]">
                                    {totalEntries} {totalEntries === 1 ? 'entry' : 'entries'}
                                </td>
                                <td className="py-3 px-3" />
                                <td className={cn(BODY_CELL, 'font-bold text-foreground')}>
                                    {breakdown.totals.promptTokens.toLocaleString()}
                                </td>
                                <td className={cn(BODY_CELL, 'font-bold text-foreground')}>
                                    {breakdown.totals.completionTokens.toLocaleString()}
                                </td>
                                <td className={cn(BODY_CELL, 'font-bold text-amber-400')}>
                                    {breakdown.totals.cacheReadTokens + breakdown.totals.cacheCreationTokens > 0
                                        ? `${breakdown.totals.cacheReadTokens.toLocaleString()} / ${breakdown.totals.cacheCreationTokens.toLocaleString()}`
                                        : '—'}
                                </td>
                                <td className={cn(BODY_CELL, 'font-bold text-foreground')}>
                                    <div>{breakdown.totals.totalTokens.toLocaleString()} tok</div>
                                    {breakdown.totals.sttSeconds > 0 && (
                                        <div className="text-[10px] font-normal text-muted-foreground">{breakdown.totals.sttSeconds.toFixed(1)}s STT</div>
                                    )}
                                    {breakdown.totals.ttsChars > 0 && (
                                        <div className="text-[10px] font-normal text-muted-foreground">{breakdown.totals.ttsChars.toLocaleString()} TTS ch</div>
                                    )}
                                </td>
                                <td className={cn(BODY_CELL, 'font-bold text-emerald-400 text-sm')}>
                                    {formatTotalCost(formatUSD, breakdown.totals.costUsd, breakdown.totals.unpricedEntries)}
                                </td>
                                <td className="py-3 px-3" />
                            </tr>
                        </tfoot>
                    </table>
                </CardContent>
            )}
        </Card>
    );
}

// ============================================================================
// Token Optimization Insights
// ============================================================================

