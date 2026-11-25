"use client";

import {
    ArrowLeft,
    FileText,
    FolderPlus,
    Save,
    Sliders,
    Sparkles
} from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { ITimezoneOption } from 'react-timezone-select';
import { toast } from 'sonner';

import {
    getCampaignApiV1CampaignCampaignIdGet,
    getCampaignDefaultsApiV1OrganizationsCampaignDefaultsGet,
    updateCampaignApiV1CampaignCampaignIdPatch
} from '@/client/sdk.gen';
import type { CampaignResponse, UpdateCampaignRequest } from '@/client/types.gen';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { type Breadcrumb, PageHeader } from '@/context/HeaderContext';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';

import CampaignAdvancedSettings, { DEFAULT_REPORT_VARIABLE_ITEMS, getTimezoneValue, type ReportVariableItem, type TimeSlot } from '../../CampaignAdvancedSettings';

const EDIT_NAV_ITEMS = [
    { id: 1, name: 'Basic Details', icon: FolderPlus },
    { id: 2, name: 'Advanced Controls', icon: Sliders },
    { id: 3, name: 'Campaign Report', icon: FileText },
    { id: 4, name: 'Report Variables', icon: Sparkles },
];

export default function EditCampaignPage() {
    const { user, getAccessToken, redirectToLogin, loading } = useAuth();
    const router = useRouter();
    const params = useParams();
    const campaignId = parseInt(params.campaignId as string);

    // Active wizard step inside container
    const [currentStep, setCurrentStep] = useState<number>(1);

    // Loading state
    const [isLoading, setIsLoading] = useState(true);
    const [campaign, setCampaign] = useState<CampaignResponse | null>(null);

    const breadcrumbs = useMemo<Breadcrumb[]>(
        () => [
            { label: 'Campaigns', href: '/campaigns' },
            { label: campaign?.name || (campaignId ? `Campaign #${campaignId}` : 'Campaign'), href: `/campaigns/${campaignId}` },
            { label: 'Edit' },
        ],
        [campaign?.name, campaignId],
    );

    // Form state
    const [campaignName, setCampaignName] = useState('');
    const [maxConcurrency, setMaxConcurrency] = useState<string>('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);

    // Limits state
    const [orgConcurrentLimit, setOrgConcurrentLimit] = useState<number>(2);
    const [fromNumbersCount, setFromNumbersCount] = useState<number>(0);

    // Retry config state
    const [retryEnabled, setRetryEnabled] = useState(true);
    const [maxRetries, setMaxRetries] = useState<string>('2');
    const [retryDelaySeconds, setRetryDelaySeconds] = useState<string>('120');
    const [retryOnBusy, setRetryOnBusy] = useState(true);
    const [retryOnNoAnswer, setRetryOnNoAnswer] = useState(true);
    const [retryOnVoicemail, setRetryOnVoicemail] = useState(true);

    // Schedule config state
    const [scheduleEnabled, setScheduleEnabled] = useState(false);
    const [scheduleTimezone, setScheduleTimezone] = useState<ITimezoneOption | string>('UTC');
    const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([
        { day_of_week: 0, start_time: '09:00', end_time: '17:00' },
    ]);
    const [scheduleMode, setScheduleMode] = useState<'window' | 'start_at'>('window');
    const [scheduleStartAt, setScheduleStartAt] = useState('');
    // Circuit breaker config state
    const [circuitBreakerEnabled, setCircuitBreakerEnabled] = useState(true);
    const [circuitBreakerFailureThreshold, setCircuitBreakerFailureThreshold] = useState<string>('50');
    const [circuitBreakerWindowSeconds, setCircuitBreakerWindowSeconds] = useState<string>('120');
    const [circuitBreakerMinCalls, setCircuitBreakerMinCalls] = useState<string>('5');
    // Report template state
    const [reportTemplateEnabled, setReportTemplateEnabled] = useState(false);
    const [reportTemplate, setReportTemplate] = useState('');
    const [reportVariables, setReportVariables] = useState<ReportVariableItem[]>([]);

    // Redirect if not authenticated
    useEffect(() => {
        if (!loading && !user) {
            redirectToLogin();
        }
    }, [loading, user, redirectToLogin]);

    // Fetch campaign and populate form
    const fetchCampaign = useCallback(async () => {
        if (!user) return;
        try {
            const accessToken = await getAccessToken();
            const response = await getCampaignApiV1CampaignCampaignIdGet({
                path: { campaign_id: campaignId },
                headers: { 'Authorization': `Bearer ${accessToken}` },
            });

            if (response.data) {
                const c = response.data;

                // Redirect if campaign is completed or failed
                if (['completed', 'failed'].includes(c.state)) {
                    router.replace(`/campaigns/${campaignId}`);
                    return;
                }

                setCampaign(c);

                // Populate form state
                setCampaignName(c.name);
                setMaxConcurrency(c.max_concurrency ? String(c.max_concurrency) : '');

                // Retry config
                setRetryEnabled(c.retry_config.enabled);
                setMaxRetries(String(c.retry_config.max_retries));
                setRetryDelaySeconds(String(c.retry_config.retry_delay_seconds));
                setRetryOnBusy(c.retry_config.retry_on_busy);
                setRetryOnNoAnswer(c.retry_config.retry_on_no_answer);
                setRetryOnVoicemail(c.retry_config.retry_on_voicemail);

                // Schedule config
                if (c.schedule_config) {
                    setScheduleEnabled(c.schedule_config.enabled);
                    setScheduleTimezone(c.schedule_config.timezone);
                    setScheduleMode(c.schedule_config.mode ?? 'window');
                    setScheduleStartAt(c.schedule_config.start_at ?? '');
                    if (c.schedule_config.slots.length > 0) {
                        setTimeSlots(c.schedule_config.slots.map((s: TimeSlot) => ({ ...s })));
                    }
                }

                // Circuit breaker config
                const cb = (c as unknown as { circuit_breaker?: { enabled: boolean; failure_threshold: number; window_seconds: number; min_calls_in_window: number } }).circuit_breaker;
                if (cb) {
                    setCircuitBreakerEnabled(cb.enabled);
                    setCircuitBreakerFailureThreshold(String(Math.round(cb.failure_threshold * 100)));
                    setCircuitBreakerWindowSeconds(String(cb.window_seconds));
                    setCircuitBreakerMinCalls(String(cb.min_calls_in_window));
                }

                // Report template & variables
                const cExt = c as unknown as { report_template?: string; report_variables?: Array<{ name: string; type: string; description?: string }> };
                if (cExt.report_template) {
                    setReportTemplateEnabled(true);
                    setReportTemplate(cExt.report_template);
                }
                if (cExt.report_variables && Array.isArray(cExt.report_variables) && cExt.report_variables.length > 0) {
                    setReportVariables(cExt.report_variables.map((v) => {
                        const match = DEFAULT_REPORT_VARIABLE_ITEMS.find(d => d.name.toLowerCase() === v.name.toLowerCase());
                        return {
                            name: v.name,
                            type: v.type || (match ? match.type : 'text'),
                            description: v.description || (match ? match.description : ''),
                        };
                    }));
                } else if (cExt.report_template) {
                    setReportVariables(DEFAULT_REPORT_VARIABLE_ITEMS);
                }
            }
        } catch (error) {
            console.error('Failed to fetch campaign:', error);
            toast.error('Failed to load campaign');
            router.replace(`/campaigns/${campaignId}`);
        } finally {
            setIsLoading(false);
        }
    }, [user, getAccessToken, campaignId, router]);

    // Fetch campaign limits
    const fetchCampaignDefaults = useCallback(async () => {
        if (!user) return;
        try {
            const accessToken = await getAccessToken();
            const response = await getCampaignDefaultsApiV1OrganizationsCampaignDefaultsGet({
                headers: { 'Authorization': `Bearer ${accessToken}` },
            });

            if (response.data) {
                setOrgConcurrentLimit(response.data.concurrent_call_limit);
                setFromNumbersCount(response.data.from_numbers_count);
            }
        } catch (error) {
            console.error('Failed to fetch campaign limits:', error);
        }
    }, [user, getAccessToken]);

    // Initial load
    useEffect(() => {
        if (user) {
            fetchCampaign();
            fetchCampaignDefaults();
        }
    }, [fetchCampaign, fetchCampaignDefaults, user]);

    // Effective concurrency limit
    const effectiveLimit = fromNumbersCount > 0
        ? Math.min(orgConcurrentLimit, fromNumbersCount)
        : orgConcurrentLimit;

    // Handle form submission
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitError(null);

        if (!campaignName.trim()) {
            toast.error('Campaign name is required');
            return;
        }

        // Validate max_concurrency if provided
        const maxConcurrencyValue = maxConcurrency ? parseInt(maxConcurrency) : null;
        if (maxConcurrencyValue !== null) {
            if (isNaN(maxConcurrencyValue) || maxConcurrencyValue < 1 || maxConcurrencyValue > 100) {
                toast.error('Max concurrent calls must be between 1 and 100');
                return;
            }
            if (maxConcurrencyValue > effectiveLimit) {
                if (fromNumbersCount > 0 && fromNumbersCount < orgConcurrentLimit) {
                    toast.error(`Max concurrent calls cannot exceed ${effectiveLimit}. You have ${fromNumbersCount} phone number(s) configured - add more CLIs to increase concurrency.`);
                } else {
                    toast.error(`Max concurrent calls cannot exceed organization limit (${effectiveLimit})`);
                }
                return;
            }
        }

        // Validate schedule configuration
        if (scheduleEnabled && scheduleMode === 'window') {
            if (timeSlots.length === 0) {
                toast.error('Add at least one time slot');
                return;
            }
            for (const slot of timeSlots) {
                if (slot.start_time >= slot.end_time) {
                    toast.error('Start time must be before end time for each slot');
                    return;
                }
            }
        }
        if (scheduleEnabled && scheduleMode === 'start_at' && !scheduleStartAt) {
            toast.error('Choose the date and time to start the campaign');
            return;
        }

        setIsSubmitting(true);

        try {
            const accessToken = await getAccessToken();

            const retryConfig = {
                enabled: retryEnabled,
                max_retries: parseInt(maxRetries) || 2,
                retry_delay_seconds: parseInt(retryDelaySeconds) || 120,
                retry_on_busy: retryOnBusy,
                retry_on_no_answer: retryOnNoAnswer,
                retry_on_voicemail: retryOnVoicemail,
            };

            const timezoneValue = getTimezoneValue(scheduleTimezone);
            const scheduleConfig = !scheduleEnabled
                ? { enabled: false, mode: 'window' as const, timezone: timezoneValue, slots: [] }
                : scheduleMode === 'start_at'
                    ? { enabled: true, mode: 'start_at' as const, timezone: timezoneValue, start_at: scheduleStartAt, slots: [] }
                    : { enabled: true, mode: 'window' as const, timezone: timezoneValue, slots: timeSlots };

            const circuitBreakerConfig = {
                enabled: circuitBreakerEnabled,
                failure_threshold: (parseInt(circuitBreakerFailureThreshold) || 50) / 100,
                window_seconds: parseInt(circuitBreakerWindowSeconds) || 120,
                min_calls_in_window: parseInt(circuitBreakerMinCalls) || 5,
            };

            const response = await updateCampaignApiV1CampaignCampaignIdPatch({
                path: { campaign_id: campaignId },
                body: {
                    name: campaignName,
                    retry_config: retryConfig,
                    max_concurrency: maxConcurrencyValue,
                    schedule_config: scheduleConfig,
                    circuit_breaker: circuitBreakerConfig,
                    report_template: reportTemplateEnabled ? reportTemplate : "",
                    report_variables: reportTemplateEnabled && reportVariables.length > 0 ? reportVariables : [],
                } as unknown as UpdateCampaignRequest,
                headers: { 'Authorization': `Bearer ${accessToken}` },
            });

            if (response.error) {
                const errorDetail = (response.error as { detail?: string })?.detail;
                const errorMessage = errorDetail || 'Failed to update campaign';
                setSubmitError(errorMessage);
                toast.error(errorMessage);
                return;
            }

            if (response.data) {
                toast.success('Campaign updated successfully');
                router.push(`/campaigns/${campaignId}`);
            }
        } catch (error) {
            console.error('Failed to update campaign:', error);
            const errorMessage = 'Failed to update campaign';
            setSubmitError(errorMessage);
            toast.error(errorMessage);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleBack = () => {
        router.push(`/campaigns/${campaignId}`);
    };

    if (isLoading) {
        return (
            <div className="container mx-auto p-4 md:p-6 pb-12 space-y-4 max-w-4xl">
                <div className="animate-pulse">
                    <div className="h-8 bg-muted rounded w-1/4 mb-4"></div>
                    <div className="h-64 bg-muted rounded"></div>
                </div>
            </div>
        );
    }

    if (!campaign) {
        return (
            <div className="container mx-auto p-4 md:p-6 pb-12 space-y-4 max-w-4xl">
                <p className="text-center text-muted-foreground">Campaign not found</p>
            </div>
        );
    }

    return (
        <div className="container mx-auto p-4 md:p-6 pb-12 space-y-4 max-w-4xl">
            <PageHeader
                breadcrumbs={breadcrumbs}
                title={
                    <div className="flex items-center gap-3">
                        <Link href={`/campaigns/${campaignId}`} className="hover:opacity-70 transition-opacity shrink-0">
                            <ArrowLeft className="h-5 w-5" />
                        </Link>
                        <span>Edit Campaign: {campaign.name}</span>
                    </div>
                }
                subtitle="Modify campaign settings, pacing, schedule, and reporting"
            />

            {/* COMPACT SIDE-NAV CONTAINER CARD MATCHING NEW CAMPAIGN PAGE */}
            <Card className="border border-border/80 bg-card/95 shadow-lg backdrop-blur-md rounded-xl overflow-hidden flex flex-col">
                <div className="flex flex-col md:flex-row h-[520px]">

                    {/* SIDEBAR NAVIGATION ITEMS */}
                    <div className="w-full md:w-56 border-r border-border/60 bg-muted/10 p-2 flex md:flex-col gap-1 shrink-0 overflow-y-auto">
                        {EDIT_NAV_ITEMS.map((item) => {
                            const Icon = item.icon;
                            const isActive = currentStep === item.id;

                            return (
                                <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => setCurrentStep(item.id)}
                                    className={cn(
                                        "flex h-8 items-center gap-2.5 rounded-md px-2.5 py-1 text-sm text-left transition-all w-full font-medium cursor-pointer",
                                        isActive && "bg-accent text-accent-foreground shadow-xs font-semibold",
                                        !isActive && "text-muted-foreground hover:text-foreground hover:bg-accent/40"
                                    )}
                                >
                                    <Icon className={cn("h-4 w-4 shrink-0", isActive ? "text-primary" : "text-muted-foreground")} />
                                    <span className="truncate">{item.name}</span>
                                </button>
                            );
                        })}
                    </div>

                    {/* RIGHT FORM CONTENT CONTAINER */}
                    <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
                        {/* STATIC NON-SCROLLING STEP HEADER BAR */}
                        <div className="px-5 py-3 border-b border-border/40 bg-card/95 shrink-0">
                            {currentStep === 1 && (
                                <div>
                                    <h3 className="text-sm font-semibold text-foreground">Basic Details</h3>
                                    <p className="text-[11px] text-muted-foreground">Modify campaign identifier and view assigned agent details.</p>
                                </div>
                            )}
                            {currentStep === 2 && (
                                <div>
                                    <h3 className="text-sm font-semibold text-foreground">Advanced Controls</h3>
                                    <p className="text-[11px] text-muted-foreground">Pacing limits, calling schedule, circuit breaker, and retry strategy.</p>
                                </div>
                            )}
                            {currentStep === 3 && (
                                <div>
                                    <h3 className="text-sm font-semibold text-foreground">Campaign Report Template</h3>
                                    <p className="text-[11px] text-muted-foreground">Define HTML/Jinja2 report template for post-call reporting.</p>
                                </div>
                            )}
                            {currentStep === 4 && (
                                <div>
                                    <h3 className="text-sm font-semibold text-foreground">Custom Extraction Variables</h3>
                                    <p className="text-[11px] text-muted-foreground">Extract structured variables (intent, sentiment, lead score) from call transcripts.</p>
                                </div>
                            )}
                        </div>

                        {/* INSIDE SCROLLABLE FORM CONTENT AREA */}
                        <div className="flex-1 p-5 overflow-y-auto">
                            <form id="edit-campaign-form" onSubmit={handleSubmit} className="space-y-4">
                                {/* STEP 1: BASIC DETAILS */}
                                {currentStep === 1 && (
                                    <div className="space-y-4 animate-in fade-in-50 duration-200">
                                        <div className="space-y-1">
                                            <Label htmlFor="campaign-name" className="font-semibold text-xs">Campaign Name *</Label>
                                            <Input
                                                id="campaign-name"
                                                placeholder="Enter campaign name"
                                                value={campaignName}
                                                onChange={(e) => setCampaignName(e.target.value)}
                                                maxLength={255}
                                                className="h-8 text-xs"
                                                required
                                            />
                                            <p className="text-[10px] text-muted-foreground">
                                                Update the display name for your campaign
                                            </p>
                                        </div>

                                        <div className="rounded-lg border border-border/80 bg-muted/20 p-3.5 space-y-2">
                                            <div className="flex items-center justify-between text-xs">
                                                <span className="text-muted-foreground font-medium">Assigned Agent / Workflow:</span>
                                                <Badge variant="outline" className="font-medium text-[11px]">
                                                    {campaign.workflow_name} (#{campaign.workflow_id})
                                                </Badge>
                                            </div>
                                            <div className="flex items-center justify-between text-xs pt-1 border-t border-border/50">
                                                <span className="text-muted-foreground font-medium">Data Source:</span>
                                                <Badge variant="outline" className="font-medium text-[11px] capitalize">
                                                    {campaign.source_type} ({campaign.source_id.split('/').pop()})
                                                </Badge>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* STEP 2: ADVANCED CONTROLS */}
                                {currentStep === 2 && (
                                    <div className="space-y-4 animate-in fade-in-50 duration-200">
                                        <CampaignAdvancedSettings
                                            mode="controls"
                                            maxConcurrency={maxConcurrency}
                                            onMaxConcurrencyChange={setMaxConcurrency}
                                            effectiveLimit={effectiveLimit}
                                            orgConcurrentLimit={orgConcurrentLimit}
                                            fromNumbersCount={fromNumbersCount}
                                            retryEnabled={retryEnabled}
                                            onRetryEnabledChange={setRetryEnabled}
                                            maxRetries={maxRetries}
                                            onMaxRetriesChange={setMaxRetries}
                                            retryDelaySeconds={retryDelaySeconds}
                                            onRetryDelaySecondsChange={setRetryDelaySeconds}
                                            retryOnBusy={retryOnBusy}
                                            onRetryOnBusyChange={setRetryOnBusy}
                                            retryOnNoAnswer={retryOnNoAnswer}
                                            onRetryOnNoAnswerChange={setRetryOnNoAnswer}
                                            retryOnVoicemail={retryOnVoicemail}
                                            onRetryOnVoicemailChange={setRetryOnVoicemail}
                                            scheduleEnabled={scheduleEnabled}
                                            onScheduleEnabledChange={setScheduleEnabled}
                                            scheduleTimezone={scheduleTimezone}
                                            onScheduleTimezoneChange={setScheduleTimezone}
                                            scheduleMode={scheduleMode}
                                            onScheduleModeChange={setScheduleMode}
                                            scheduleStartAt={scheduleStartAt}
                                            onScheduleStartAtChange={setScheduleStartAt}
                                            timeSlots={timeSlots}
                                            onTimeSlotsChange={setTimeSlots}
                                            circuitBreakerEnabled={circuitBreakerEnabled}
                                            onCircuitBreakerEnabledChange={setCircuitBreakerEnabled}
                                            circuitBreakerFailureThreshold={circuitBreakerFailureThreshold}
                                            onCircuitBreakerFailureThresholdChange={setCircuitBreakerFailureThreshold}
                                            circuitBreakerWindowSeconds={circuitBreakerWindowSeconds}
                                            onCircuitBreakerWindowSecondsChange={setCircuitBreakerWindowSeconds}
                                            circuitBreakerMinCalls={circuitBreakerMinCalls}
                                            onCircuitBreakerMinCallsChange={setCircuitBreakerMinCalls}
                                        />
                                    </div>
                                )}

                                {/* STEP 3: CAMPAIGN REPORT TEMPLATE */}
                                {currentStep === 3 && (
                                    <div className="space-y-4 animate-in fade-in-50 duration-200">
                                        <CampaignAdvancedSettings
                                            mode="report"
                                            maxConcurrency={maxConcurrency}
                                            onMaxConcurrencyChange={setMaxConcurrency}
                                            effectiveLimit={effectiveLimit}
                                            orgConcurrentLimit={orgConcurrentLimit}
                                            fromNumbersCount={fromNumbersCount}
                                            retryEnabled={false}
                                            onRetryEnabledChange={() => { }}
                                            maxRetries={maxRetries}
                                            onMaxRetriesChange={() => { }}
                                            retryDelaySeconds={retryDelaySeconds}
                                            onRetryDelaySecondsChange={() => { }}
                                            retryOnBusy={false}
                                            onRetryOnBusyChange={() => { }}
                                            retryOnNoAnswer={false}
                                            onRetryOnNoAnswerChange={() => { }}
                                            retryOnVoicemail={false}
                                            onRetryOnVoicemailChange={() => { }}
                                            scheduleEnabled={false}
                                            onScheduleEnabledChange={() => { }}
                                            scheduleTimezone={scheduleTimezone}
                                            onScheduleTimezoneChange={() => { }}
                                            timeSlots={timeSlots}
                                            onTimeSlotsChange={() => { }}
                                            circuitBreakerEnabled={false}
                                            onCircuitBreakerEnabledChange={() => { }}
                                            circuitBreakerFailureThreshold={circuitBreakerFailureThreshold}
                                            onCircuitBreakerFailureThresholdChange={() => { }}
                                            circuitBreakerWindowSeconds={circuitBreakerWindowSeconds}
                                            onCircuitBreakerWindowSecondsChange={() => { }}
                                            circuitBreakerMinCalls={circuitBreakerMinCalls}
                                            onCircuitBreakerMinCallsChange={() => { }}
                                            reportTemplateEnabled={reportTemplateEnabled}
                                            onReportTemplateEnabledChange={setReportTemplateEnabled}
                                            reportTemplate={reportTemplate}
                                            onReportTemplateChange={setReportTemplate}
                                            reportVariables={reportVariables}
                                            onReportVariablesChange={setReportVariables}
                                        />
                                    </div>
                                )}

                                {/* STEP 4: EXTRACTION VARIABLES */}
                                {currentStep === 4 && (
                                    <div className="space-y-4 animate-in fade-in-50 duration-200">
                                        <CampaignAdvancedSettings
                                            mode="variables"
                                            maxConcurrency={maxConcurrency}
                                            onMaxConcurrencyChange={setMaxConcurrency}
                                            effectiveLimit={effectiveLimit}
                                            orgConcurrentLimit={orgConcurrentLimit}
                                            fromNumbersCount={fromNumbersCount}
                                            retryEnabled={false}
                                            onRetryEnabledChange={() => { }}
                                            maxRetries={maxRetries}
                                            onMaxRetriesChange={() => { }}
                                            retryDelaySeconds={retryDelaySeconds}
                                            onRetryDelaySecondsChange={() => { }}
                                            retryOnBusy={false}
                                            onRetryOnBusyChange={() => { }}
                                            retryOnNoAnswer={false}
                                            onRetryOnNoAnswerChange={() => { }}
                                            retryOnVoicemail={false}
                                            onRetryOnVoicemailChange={() => { }}
                                            scheduleEnabled={false}
                                            onScheduleEnabledChange={() => { }}
                                            scheduleTimezone={scheduleTimezone}
                                            onScheduleTimezoneChange={() => { }}
                                            timeSlots={timeSlots}
                                            onTimeSlotsChange={() => { }}
                                            circuitBreakerEnabled={false}
                                            onCircuitBreakerEnabledChange={() => { }}
                                            circuitBreakerFailureThreshold={circuitBreakerFailureThreshold}
                                            onCircuitBreakerFailureThresholdChange={() => { }}
                                            circuitBreakerWindowSeconds={circuitBreakerWindowSeconds}
                                            onCircuitBreakerWindowSecondsChange={() => { }}
                                            circuitBreakerMinCalls={circuitBreakerMinCalls}
                                            onCircuitBreakerMinCallsChange={() => { }}
                                            reportTemplateEnabled={false}
                                            onReportTemplateEnabledChange={() => { }}
                                            reportTemplate={reportTemplate}
                                            onReportTemplateChange={setReportTemplate}
                                            reportVariables={reportVariables}
                                            onReportVariablesChange={setReportVariables}
                                        />
                                    </div>
                                )}

                                {submitError && (
                                    <div className="rounded-md bg-destructive/15 p-2.5 text-xs text-destructive">
                                        {submitError}
                                    </div>
                                )}
                            </form>
                        </div>

                        {/* STATIC NON-SCROLLING STEP FOOTER CONTROL BAR */}
                        <div className="px-5 py-3 border-t border-border/40 bg-card/95 flex items-center justify-end gap-2.5 shrink-0">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={handleBack}
                                disabled={isSubmitting}
                                className="h-8 text-xs px-4 font-medium shrink-0 cursor-pointer"
                            >
                                Cancel
                            </Button>

                            <Button
                                type="submit"
                                form="edit-campaign-form"
                                size="sm"
                                disabled={isSubmitting || !campaignName.trim()}
                                className="h-8 text-xs px-4 font-medium gap-1.5 shrink-0 cursor-pointer"
                            >
                                <Save className="h-3.5 w-3.5 shrink-0" />
                                {isSubmitting ? 'Saving...' : 'Save Changes'}
                            </Button>
                        </div>
                    </div>
                </div>
            </Card>
        </div>
    );
}

