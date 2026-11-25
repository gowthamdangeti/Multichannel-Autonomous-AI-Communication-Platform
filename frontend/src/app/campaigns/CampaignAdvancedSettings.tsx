import { Calendar, Clock, Code, Eye, Plus, Trash2, X } from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useId, useState } from 'react';
import TimezoneSelect from 'react-timezone-select';

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), {
    ssr: false,
    loading: () => (
        <div className="flex h-[330px] items-center justify-center bg-[#1e1e1e] rounded-b-xl">
            <span className="text-xs text-muted-foreground">Loading code editor...</span>
        </div>
    ),
});

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

import {
    DEFAULT_CAMPAIGN_REPORT_TEMPLATE,
    DEFAULT_REPORT_VARIABLE_ITEMS,
    extractJinjaVariables,
    getTimezoneValue,
    SYSTEM_TEMPLATE_TAGS,
} from './campaignReportUtils';
import type { CampaignAdvancedSettingsProps, ReportVariableItem, TimeSlot } from './campaignTypes';

export type { CampaignAdvancedSettingsProps, ReportVariableItem, TimeSlot };
export {
    DEFAULT_CAMPAIGN_REPORT_TEMPLATE,
    DEFAULT_REPORT_VARIABLE_ITEMS,
    extractJinjaVariables,
    getTimezoneValue,
    SYSTEM_TEMPLATE_TAGS,
};

function renderPreviewHtml(template: string): string {
    let rendered = template || DEFAULT_CAMPAIGN_REPORT_TEMPLATE;
    rendered = rendered.replace(/\{\{\s*run_id\s*\}\}/g, 'run_948201');
    rendered = rendered.replace(/\{\{\s*phone_number\s*\}\}/g, '+1 (555) 234-5678');
    rendered = rendered.replace(/\{\{\s*call_disposition\s*\}\}/g, 'completed');
    rendered = rendered.replace(/\{\{\s*call_duration\s*\}\}/g, '142 seconds');
    rendered = rendered.replace(/\{\{\s*extracted_variables\s*\}\}/g, '<pre style="background:#f4f4f5;padding:8px;border-radius:4px;font-size:12px;">' + JSON.stringify({ intent: 'Loan Repayment Inquiry', sentiment: 'Positive', lead_score: '85/100' }, null, 2) + '</pre>');
    return rendered;
}

const timezoneSelectStyles = {
    control: (base: Record<string, unknown>, state: { isFocused: boolean }) => ({
        ...base,
        minHeight: '36px',
        fontSize: '14px',
        backgroundColor: 'var(--background)',
        borderColor: state.isFocused ? 'var(--ring)' : 'var(--border)',
        boxShadow: state.isFocused ? '0 0 0 2px color-mix(in srgb, var(--ring) 20%, transparent)' : 'none',
        '&:hover': { borderColor: 'var(--border)' },
    }),
    menu: (base: Record<string, unknown>) => ({
        ...base,
        zIndex: 9999,
        backgroundColor: 'var(--popover)',
        border: '1px solid var(--border)',
        boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
    }),
    menuList: (base: Record<string, unknown>) => ({
        ...base,
        backgroundColor: 'var(--popover)',
        padding: 0,
    }),
    option: (base: Record<string, unknown>, state: { isSelected: boolean; isFocused: boolean }) => ({
        ...base,
        backgroundColor: state.isSelected ? 'var(--accent)' : state.isFocused ? 'var(--accent)' : 'var(--popover)',
        color: 'var(--foreground)',
        cursor: 'pointer',
        '&:active': { backgroundColor: 'var(--accent)' },
    }),
    singleValue: (base: Record<string, unknown>) => ({ ...base, color: 'var(--foreground)' }),
    input: (base: Record<string, unknown>) => ({ ...base, color: 'var(--foreground)' }),
    placeholder: (base: Record<string, unknown>) => ({ ...base, color: 'var(--muted-foreground)' }),
    indicatorSeparator: (base: Record<string, unknown>) => ({ ...base, backgroundColor: 'var(--border)' }),
    dropdownIndicator: (base: Record<string, unknown>) => ({
        ...base,
        color: 'var(--muted-foreground)',
        '&:hover': { color: 'var(--foreground)' },
    }),
};

export default function CampaignAdvancedSettings({
    maxConcurrency, onMaxConcurrencyChange, effectiveLimit, orgConcurrentLimit, fromNumbersCount,
    retryEnabled, onRetryEnabledChange, maxRetries, onMaxRetriesChange,
    retryDelaySeconds, onRetryDelaySecondsChange,
    retryOnBusy, onRetryOnBusyChange, retryOnNoAnswer, onRetryOnNoAnswerChange,
    retryOnVoicemail, onRetryOnVoicemailChange,
    scheduleEnabled, onScheduleEnabledChange, scheduleTimezone, onScheduleTimezoneChange,
    scheduleMode, onScheduleModeChange, scheduleStartAt, onScheduleStartAtChange,
    timeSlots, onTimeSlotsChange,
    circuitBreakerEnabled, onCircuitBreakerEnabledChange,
    circuitBreakerFailureThreshold, onCircuitBreakerFailureThresholdChange,
    circuitBreakerWindowSeconds, onCircuitBreakerWindowSecondsChange,
    circuitBreakerMinCalls, onCircuitBreakerMinCallsChange,
    reportTemplateEnabled = false, onReportTemplateEnabledChange,
    reportTemplate = '', onReportTemplateChange,
    reportVariables = [], onReportVariablesChange,
    mode = 'all',
}: CampaignAdvancedSettingsProps) {
    const timezoneSelectId = useId();
    const [isPreviewOpen, setIsPreviewOpen] = useState(false);

    const showControls = mode === 'all' || mode === 'controls';
    const showReport = mode === 'all' || mode === 'report';
    const showVariables = mode === 'all' || mode === 'variables';

    // Dedicated handler for template change with bidirectional Jinja variable extraction/pruning
    const handleReportTemplateValueChange = useCallback((newTmpl: string) => {
        const oldTmpl = reportTemplate;
        onReportTemplateChange?.(newTmpl);

        if (!onReportVariablesChange) return;

        const oldExtracted = new Set(extractJinjaVariables(oldTmpl).map(s => s.toLowerCase()));
        const newExtractedList = extractJinjaVariables(newTmpl);
        const newExtractedSet = new Set(newExtractedList.map(s => s.toLowerCase()));

        // Find tags removed from template
        const removedTags = new Set(Array.from(oldExtracted).filter(tag => !newExtractedSet.has(tag)));

        // 1. Filter out variables whose template tags were erased
        const updatedVars = reportVariables.filter(v => {
            const nameLower = v.name.trim().toLowerCase();
            return !removedTags.has(nameLower);
        });

        // 2. Append new extracted variables from template
        const existingNames = new Set(updatedVars.map(v => v.name.trim().toLowerCase()));
        let changed = updatedVars.length !== reportVariables.length;

        for (const name of newExtractedList) {
            if (!existingNames.has(name.toLowerCase())) {
                const defaultMatch = DEFAULT_REPORT_VARIABLE_ITEMS.find(
                    item => item.name.toLowerCase() === name.toLowerCase()
                );
                updatedVars.push({
                    name: name,
                    type: defaultMatch ? defaultMatch.type : 'text',
                    description: defaultMatch ? defaultMatch.description : '',
                });
                existingNames.add(name.toLowerCase());
                changed = true;
            }
        }

        if (changed) {
            onReportVariablesChange(updatedVars);
        }
    }, [reportTemplate, reportVariables, onReportTemplateChange, onReportVariablesChange]);

    const handleAddVariable = useCallback(() => {
        onReportVariablesChange?.([{ name: '', type: 'text', description: '' }, ...reportVariables]);
    }, [reportVariables, onReportVariablesChange]);

    const handleRemoveVariable = useCallback((indexToRemove: number) => {
        onReportVariablesChange?.(reportVariables.filter((_, i) => i !== indexToRemove));
    }, [reportVariables, onReportVariablesChange]);

    const handleUpdateVariableName = useCallback((index: number, newName: string) => {
        const updated = [...reportVariables];
        updated[index] = { ...updated[index], name: newName };
        onReportVariablesChange?.(updated);
    }, [reportVariables, onReportVariablesChange]);

    const handleUpdateVariableType = useCallback((index: number, newType: string) => {
        const updated = [...reportVariables];
        updated[index] = { ...updated[index], type: newType };
        onReportVariablesChange?.(updated);
    }, [reportVariables, onReportVariablesChange]);

    const handleUpdateVariableDescription = useCallback((index: number, newDesc: string) => {
        const updated = [...reportVariables];
        updated[index] = { ...updated[index], description: newDesc };
        onReportVariablesChange?.(updated);
    }, [reportVariables, onReportVariablesChange]);

    return (
        <div className="space-y-6">
            {/* ADVANCED CONTROLS SECTION */}
            {showControls && (
                <>
                    {/* Concurrency Settings */}
                    <div className="rounded-xl border border-border bg-card/70 p-4 space-y-3 shadow-xs">
                        <Label htmlFor="max-concurrency" className="font-semibold text-sm">Max Concurrency</Label>
                        <Input
                            id="max-concurrency"
                            type="number"
                            min="1"
                            max={orgConcurrentLimit}
                            value={maxConcurrency}
                            onChange={(e) => onMaxConcurrencyChange(e.target.value)}
                            placeholder={`Default: ${effectiveLimit}`}
                            className="h-8 text-xs"
                        />
                        <p className="text-[11px] text-muted-foreground">
                            Maximum number of simultaneous calls. Leave empty to use {effectiveLimit}. You have {fromNumbersCount} CLI{fromNumbersCount === 1 ? '' : 's'} and an org limit of {orgConcurrentLimit}.
                        </p>
                        {fromNumbersCount < orgConcurrentLimit && (
                            <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-2.5 text-xs text-amber-700 dark:text-amber-400">
                                Concurrency is limited to {fromNumbersCount} by your configured phone numbers. To use the full org limit of {orgConcurrentLimit}, add more CLIs in{' '}
                                <Link href="/telephony-configurations" className="underline font-medium hover:text-amber-800 dark:hover:text-amber-300">
                                    Telephony Configuration
                                </Link>.
                            </div>
                        )}
                    </div>

                    <Separator />

                    {/* Retry Settings */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <Label htmlFor="retry-enabled" className="font-semibold text-sm">Retry Calls</Label>
                                <p className="text-xs text-muted-foreground">
                                    Retry calls that failed due to busy signals, no answer, or voicemail
                                </p>
                            </div>
                            <Switch
                                id="retry-enabled"
                                checked={retryEnabled}
                                onCheckedChange={onRetryEnabledChange}
                            />
                        </div>

                        {retryEnabled && (
                            <div className="rounded-xl border border-border bg-card/70 p-4 space-y-4 shadow-xs animate-in fade-in-50 duration-200">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                        <Label htmlFor="max-retries" className="text-xs font-semibold">Max Retries Per Contact</Label>
                                        <Input
                                            id="max-retries"
                                            type="number"
                                            value={maxRetries}
                                            onChange={(e) => onMaxRetriesChange(e.target.value)}
                                            min={1}
                                            max={10}
                                            className="h-8 text-xs"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label htmlFor="retry-delay" className="text-xs font-semibold">Retry Delay (seconds)</Label>
                                        <Input
                                            id="retry-delay"
                                            type="number"
                                            value={retryDelaySeconds}
                                            onChange={(e) => onRetryDelaySecondsChange(e.target.value)}
                                            min={10}
                                            max={86400}
                                            className="h-8 text-xs"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2.5 pt-2 border-t border-border/60">
                                    <Label className="text-xs font-semibold">Retry On Triggers</Label>
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                                        <div className="flex items-center justify-between rounded-lg border border-border/70 bg-card/40 p-2.5 shadow-2xs">
                                            <Label htmlFor="retry-busy" className="text-xs font-medium cursor-pointer">Busy Signal</Label>
                                            <Switch id="retry-busy" checked={retryOnBusy} onCheckedChange={onRetryOnBusyChange} />
                                        </div>
                                        <div className="flex items-center justify-between rounded-lg border border-border/70 bg-card/40 p-2.5 shadow-2xs">
                                            <Label htmlFor="retry-no-answer" className="text-xs font-medium cursor-pointer">No Answer</Label>
                                            <Switch id="retry-no-answer" checked={retryOnNoAnswer} onCheckedChange={onRetryOnNoAnswerChange} />
                                        </div>
                                        <div className="flex items-center justify-between rounded-lg border border-border/70 bg-card/40 p-2.5 shadow-2xs">
                                            <Label htmlFor="retry-voicemail" className="text-xs font-medium cursor-pointer">Voicemail</Label>
                                            <Switch id="retry-voicemail" checked={retryOnVoicemail} onCheckedChange={onRetryOnVoicemailChange} />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    <Separator />

                    {/* Calling Schedule */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <Label htmlFor="schedule-enabled" className="font-semibold text-sm">Calling Schedule</Label>
                                <p className="text-xs text-muted-foreground">
                                    Restrict campaign calling to specific days and time windows
                                </p>
                            </div>
                            <Switch
                                id="schedule-enabled"
                                checked={scheduleEnabled}
                                onCheckedChange={onScheduleEnabledChange}
                            />
                        </div>

                        {scheduleEnabled && (
                            <div className="rounded-xl border border-border bg-card/70 p-4 space-y-4 shadow-xs animate-in fade-in-50 duration-200">
                                {/* Timezone Selection */}
                                <div className="space-y-1.5">
                                    <div className="flex items-center gap-1.5">
                                        <Clock className="h-3.5 w-3.5 text-primary" />
                                        <Label htmlFor={timezoneSelectId} className="text-xs font-semibold">
                                            Schedule Timezone
                                        </Label>
                                    </div>
                                    <TimezoneSelect
                                        id={timezoneSelectId}
                                        value={scheduleTimezone}
                                        onChange={onScheduleTimezoneChange}
                                        styles={timezoneSelectStyles}
                                    />
                                </div>

                                {/* Schedule Mode Selector */}
                                {scheduleMode !== undefined && onScheduleModeChange && (
                                    <div className="space-y-1.5 pt-1">
                                        <Label className="text-xs font-semibold">Schedule Type</Label>
                                        <Select
                                            value={scheduleMode}
                                            onValueChange={(val: 'window' | 'start_at') => onScheduleModeChange(val)}
                                        >
                                            <SelectTrigger className="h-8 text-xs font-medium">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="window">Call only during selected windows</SelectItem>
                                                <SelectItem value="start_at">Start campaign automatically at a date and time</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                )}

                                {scheduleMode === 'start_at' && onScheduleStartAtChange ? (
                                    <div className="space-y-1.5 pt-1">
                                        <Label htmlFor="schedule-start-at" className="text-xs font-semibold">Automatic Start</Label>
                                        <Input
                                            id="schedule-start-at"
                                            type="datetime-local"
                                            value={scheduleStartAt ?? ''}
                                            onChange={(e) => onScheduleStartAtChange(e.target.value)}
                                            className="h-8 text-xs font-mono"
                                        />
                                        <p className="text-[11px] text-muted-foreground">
                                            Interpreted in the selected timezone. The campaign starts automatically within one minute of this time.
                                        </p>
                                    </div>
                                ) : (
                                    /* Time Windows Card List */
                                    <div className="space-y-2.5 pt-1">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <Calendar className="h-3.5 w-3.5 text-primary" />
                                            <Label className="text-xs font-semibold">Active Time Windows</Label>
                                            <Badge variant="outline" className="text-[10px] font-mono py-0.5 px-2">
                                                {timeSlots.length} window{timeSlots.length === 1 ? '' : 's'}
                                            </Badge>
                                        </div>

                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() => onTimeSlotsChange([...timeSlots, { day_of_week: 0, start_time: '09:00', end_time: '17:00' }])}
                                            className="h-7 text-[11px] px-2.5 font-medium border-dashed hover:border-primary shrink-0"
                                        >
                                            <Plus className="h-3 w-3 mr-1 text-primary" />
                                            Add Time Window
                                        </Button>
                                    </div>

                                    {timeSlots.length === 0 ? (
                                        <div className="rounded-lg border border-dashed border-muted p-3 text-center text-xs text-muted-foreground bg-muted/20">
                                            No time windows added. Click &quot;Add Time Window&quot; above to specify allowed calling hours.
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            {timeSlots.map((slot, idx) => (
                                                <div
                                                    key={idx}
                                                    className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-card/40 p-2.5 shadow-2xs hover:border-border transition-colors"
                                                >
                                                    {/* Day Selector */}
                                                    <Select
                                                        value={slot.day_of_week.toString()}
                                                        onValueChange={(val) => {
                                                            const updated = [...timeSlots];
                                                            updated[idx] = { ...updated[idx], day_of_week: parseInt(val, 10) };
                                                            onTimeSlotsChange(updated);
                                                        }}
                                                    >
                                                        <SelectTrigger className="w-[125px] h-8 text-xs font-medium shrink-0">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="0">Monday</SelectItem>
                                                            <SelectItem value="1">Tuesday</SelectItem>
                                                            <SelectItem value="2">Wednesday</SelectItem>
                                                            <SelectItem value="3">Thursday</SelectItem>
                                                            <SelectItem value="4">Friday</SelectItem>
                                                            <SelectItem value="5">Saturday</SelectItem>
                                                            <SelectItem value="6">Sunday</SelectItem>
                                                        </SelectContent>
                                                    </Select>

                                                    {/* Start and End Time Range Inputs */}
                                                    <div className="flex items-center gap-2 shrink-0">
                                                        <Input
                                                            type="time"
                                                            value={slot.start_time}
                                                            onChange={(e) => {
                                                                const updated = [...timeSlots];
                                                                updated[idx] = { ...updated[idx], start_time: e.target.value };
                                                                onTimeSlotsChange(updated);
                                                            }}
                                                            className="w-[130px] h-8 text-xs font-mono px-2 shrink-0"
                                                        />
                                                        <span className="text-xs font-medium text-muted-foreground">to</span>
                                                        <Input
                                                            type="time"
                                                            value={slot.end_time}
                                                            onChange={(e) => {
                                                                const updated = [...timeSlots];
                                                                updated[idx] = { ...updated[idx], end_time: e.target.value };
                                                                onTimeSlotsChange(updated);
                                                            }}
                                                            className="w-[130px] h-8 text-xs font-mono px-2 shrink-0"
                                                        />
                                                    </div>

                                                    {/* Delete Window Button */}
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => onTimeSlotsChange(timeSlots.filter((_, i) => i !== idx))}
                                                        className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
                                                        title="Remove time window"
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </Button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                )}
                            </div>
                        )}
                    </div>

                    <Separator />

                    {/* Circuit Breaker */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <Label htmlFor="circuit-breaker-enabled" className="font-semibold text-sm">Circuit Breaker</Label>
                                <p className="text-xs text-muted-foreground">
                                    Auto-pause campaign on high failure rates
                                </p>
                            </div>
                            <Switch
                                id="circuit-breaker-enabled"
                                checked={circuitBreakerEnabled}
                                onCheckedChange={onCircuitBreakerEnabledChange}
                            />
                        </div>

                        {circuitBreakerEnabled && (
                            <div className="rounded-xl border border-border bg-card/70 p-4 space-y-4 shadow-xs animate-in fade-in-50 duration-200">
                                <div className="space-y-1.5">
                                    <Label htmlFor="cb-failure-threshold" className="text-xs font-semibold">Failure Threshold (%)</Label>
                                    <Input
                                        id="cb-failure-threshold"
                                        type="number"
                                        value={circuitBreakerFailureThreshold}
                                        onChange={(e) => onCircuitBreakerFailureThresholdChange(e.target.value)}
                                        min={1}
                                        max={100}
                                        className="h-8 text-xs"
                                    />
                                    <p className="text-[11px] text-muted-foreground">
                                        Pause when failure rate exceeds this percentage
                                    </p>
                                </div>
                                <div className="grid grid-cols-2 gap-4 pt-1">
                                    <div className="space-y-1.5">
                                        <Label htmlFor="cb-window" className="text-xs font-semibold">Window (seconds)</Label>
                                        <Input
                                            id="cb-window"
                                            type="number"
                                            value={circuitBreakerWindowSeconds}
                                            onChange={(e) => onCircuitBreakerWindowSecondsChange(e.target.value)}
                                            min={30}
                                            max={600}
                                            className="h-8 text-xs"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label htmlFor="cb-min-calls" className="text-xs font-semibold">Min Calls in Window</Label>
                                        <Input
                                            id="cb-min-calls"
                                            type="number"
                                            value={circuitBreakerMinCalls}
                                            onChange={(e) => onCircuitBreakerMinCallsChange(e.target.value)}
                                            min={1}
                                            max={100}
                                            className="h-8 text-xs"
                                        />
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </>
            )}

            {/* REPORT TEMPLATE SECTION */}
            {showReport && onReportTemplateEnabledChange && (
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <Label htmlFor="report-template-enabled" className="font-semibold">
                                HTML / Jinja2 Report Template
                            </Label>
                            <p className="text-sm text-muted-foreground">
                                Define custom HTML/Jinja report templates for post-call reporting
                            </p>
                        </div>
                        <Switch
                            id="report-template-enabled"
                            checked={reportTemplateEnabled}
                            onCheckedChange={(checked) => {
                                onReportTemplateEnabledChange(checked);
                                if (checked) {
                                    if (!reportTemplate && onReportTemplateChange) {
                                        onReportTemplateChange(DEFAULT_CAMPAIGN_REPORT_TEMPLATE);
                                    }
                                    if (onReportVariablesChange) {
                                        if (!reportVariables || reportVariables.length === 0) {
                                            onReportVariablesChange(DEFAULT_REPORT_VARIABLE_ITEMS);
                                        } else {
                                            const enriched = reportVariables.map((v) => {
                                                const match = DEFAULT_REPORT_VARIABLE_ITEMS.find(d => d.name.toLowerCase() === v.name.toLowerCase());
                                                if (match && (!v.description || v.type === 'text')) {
                                                    return { ...v, type: match.type, description: match.description };
                                                }
                                                return v;
                                            });
                                            onReportVariablesChange(enriched);
                                        }
                                    }
                                }
                            }}
                        />
                    </div>

                    {reportTemplateEnabled && (
                        <div className="pt-1 pb-3 mb-2">
                            {/* Unified Code Editor Container Card with Inner Header */}
                            <div className="rounded-xl border border-border bg-card/80 shadow-xs overflow-hidden flex flex-col">
                                {/* Inner Header Bar */}
                                <div className="flex items-center justify-between px-3.5 py-2.5 bg-muted/30 border-b border-border/70">
                                    <Label htmlFor="campaign-report-template" className="text-xs font-semibold text-foreground">
                                        Campaign Report
                                    </Label>

                                    <div className="flex items-center gap-2">
                                        <Badge variant="outline" className="text-[10px] font-mono gap-1 py-0.5 px-2 bg-background/50">
                                            <Code className="h-3 w-3 text-muted-foreground" />
                                            HTML / Jinja2 Code
                                        </Badge>

                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setIsPreviewOpen(true)}
                                            className="h-7 text-xs gap-1.5 px-2.5 font-medium hover:bg-accent cursor-pointer"
                                        >
                                            <Eye className="h-3.5 w-3.5 text-primary" />
                                            Preview
                                        </Button>
                                    </div>
                                </div>

                                {/* Monaco Code Editor Container */}
                                <div className="h-[300px] w-full bg-[#1e1e1e]">
                                    <MonacoEditor
                                        height="300px"
                                        defaultLanguage="html"
                                        theme="vs-dark"
                                        value={reportTemplate}
                                        onChange={(val) => handleReportTemplateValueChange(val || '')}
                                        options={{
                                            minimap: { enabled: false },
                                            fontSize: 12,
                                            lineNumbers: 'on',
                                            wordWrap: 'on',
                                            scrollBeyondLastLine: false,
                                            automaticLayout: true,
                                            tabSize: 2,
                                            padding: { top: 8, bottom: 8 },
                                            overviewRulerLanes: 0,
                                            hideCursorInOverviewRuler: true,
                                            scrollbar: {
                                                vertical: 'auto',
                                                horizontal: 'auto',
                                                verticalScrollbarSize: 8,
                                                horizontalScrollbarSize: 8,
                                            },
                                        }}
                                    />
                                </div>
                            </div>

                            {/* OFFCANVAS DRAWER (SHEET) FOR TEMPLATE PREVIEW */}
                            <Sheet open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
                                <SheetContent side="right" className="w-full sm:w-[45%] sm:max-w-[45%] p-0 flex flex-col">
                                    <SheetHeader className="px-4 py-2.5 border-b border-border shrink-0 space-y-0.5">
                                        <div className="flex items-center gap-2">
                                            <Eye className="h-4 w-4 text-primary" />
                                            <SheetTitle className="text-sm font-semibold leading-none">Campaign Report Preview</SheetTitle>
                                        </div>
                                        <SheetDescription className="text-[11px] text-muted-foreground leading-none">
                                            Live rendered HTML report output preview with sample call data variables.
                                        </SheetDescription>
                                    </SheetHeader>

                                    <div className="flex-1 p-2 flex flex-col min-h-0 overflow-hidden">
                                        <div className="w-full h-full rounded-md border border-border bg-white shadow-xs overflow-hidden flex flex-col flex-1">
                                            <iframe
                                                srcDoc={renderPreviewHtml(reportTemplate || DEFAULT_CAMPAIGN_REPORT_TEMPLATE)}
                                                className="w-full h-full flex-1 border-0 bg-white"
                                                title="Campaign Report Live Preview"
                                            />
                                        </div>
                                    </div>
                                </SheetContent>
                            </Sheet>
                        </div>
                    )}
                </div>
            )}

            {/* EXTRACTION VARIABLES SECTION */}
            {showVariables && onReportVariablesChange && (
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <div>
                            <Label className="text-sm font-semibold">Structured Extraction Variables</Label>
                            <p className="text-xs text-muted-foreground">
                                Extract specific structured fields (e.g. intent, sentiment, lead score) from call transcripts
                            </p>
                        </div>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleAddVariable}
                            className="h-7 text-xs font-medium"
                        >
                            <Plus className="h-3.5 w-3.5 mr-1" />
                            Add Variable
                        </Button>
                    </div>
                    {reportVariables.length === 0 ? (
                        <div className="rounded-md border border-dashed border-muted/80 p-4 text-center space-y-1 bg-muted/20">
                            <p className="text-xs text-muted-foreground italic">
                                No custom extraction variables added. Click &quot;Add Variable&quot; to extract specific fields like intent, sentiment, or lead score.
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {reportVariables.map((v, idx) => (
                                <div key={idx} className="bg-muted/40 p-3 rounded-md border border-muted space-y-2">
                                    {/* Top Row: Variable Name (70%), Data Type (30%), Delete Button */}
                                    <div className="flex items-center gap-2 w-full">
                                        <div className="flex-[7] min-w-0">
                                            <Input
                                                placeholder="Variable Name (e.g. lead_qualification)"
                                                value={v.name}
                                                onChange={(e) => handleUpdateVariableName(idx, e.target.value)}
                                                className="h-8 text-xs font-medium w-full"
                                            />
                                        </div>
                                        <div className="flex-[3] min-w-0">
                                            <Select
                                                value={v.type || 'text'}
                                                onValueChange={(val) => handleUpdateVariableType(idx, val)}
                                            >
                                                <SelectTrigger className="h-8 text-xs w-full">
                                                    <SelectValue placeholder="Data Type" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="text">Text</SelectItem>
                                                    <SelectItem value="number">Number</SelectItem>
                                                    <SelectItem value="yes_no">Yes / No</SelectItem>
                                                    <SelectItem value="list">List</SelectItem>
                                                    <SelectItem value="range">Range</SelectItem>
                                                    <SelectItem value="score">Score</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => handleRemoveVariable(idx)}
                                            className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                                            title="Remove variable"
                                        >
                                            <X className="h-4 w-4" />
                                        </Button>
                                    </div>

                                    {/* Bottom Row: Full width Textarea for description / extraction instructions */}
                                    <div>
                                        <Textarea
                                            placeholder="Prompt instruction for LLM variable extraction..."
                                            value={v.description || ''}
                                            onChange={(e) => handleUpdateVariableDescription(idx, e.target.value)}
                                            rows={2}
                                            className="text-xs resize-y min-h-[50px]"
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

