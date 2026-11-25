"use client";

import { ArrowLeft, ArrowRight, RefreshCw, Sparkles, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ITimezoneOption } from "react-timezone-select";
import { toast } from "sonner";

import CampaignAdvancedSettings, {
    DEFAULT_CAMPAIGN_REPORT_TEMPLATE,
    DEFAULT_REPORT_VARIABLE_ITEMS,
    getTimezoneValue,
    type ReportVariableItem,
    type TimeSlot,
} from "@/app/campaigns/CampaignAdvancedSettings";
import {
    createCampaignApiV1CampaignCreatePost,
    getCampaignDefaultsApiV1OrganizationsCampaignDefaultsGet,
    getCampaignSourceColumnsApiV1CampaignWorkflowWorkflowIdSourceColumnsGet,
    getWorkflowApiV1WorkflowFetchWorkflowIdGet,
    getWorkflowsSummaryApiV1WorkflowSummaryGet,
    listTelephonyConfigurationsApiV1OrganizationsTelephonyConfigsGet,
} from "@/client/sdk.gen";
import type {
    CampaignResponse,
    CreateCampaignRequest,
    TelephonyConfigurationListItem,
    WorkflowSummaryResponse,
} from "@/client/types.gen";
import { Button } from "@/components/ui/button";
import {
    Sheet,
    SheetBody,
    SheetContent,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { UnderlineTabs } from "@/components/ui/underline-tabs";
import { useAuth } from "@/lib/auth";

import { CampaignBasicDetailsSection } from "./CampaignBasicDetailsSection";
import { CampaignTelephonySection } from "./CampaignTelephonySection";
import { DetailSection } from "./DetailSection";

export type CampaignCreateTab = "basic" | "telephony" | "advanced" | "report" | "variables";

interface CreateCampaignDrawerProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onCampaignCreated?: (campaign: CampaignResponse) => void;
}

export function CreateCampaignDrawer({
    open,
    onOpenChange,
    onCampaignCreated,
}: CreateCampaignDrawerProps) {
    const { user, getAccessToken } = useAuth();
    const router = useRouter();

    const [activeTab, setActiveTab] = useState<CampaignCreateTab>("basic");

    // Form fields
    const [campaignName, setCampaignName] = useState("");
    const [selectedWorkflowId, setSelectedWorkflowId] = useState("");
    const [sourceType] = useState<"csv">("csv");
    const [sourceId, setSourceId] = useState("");
    const [selectedFileName, setSelectedFileName] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);

    // Workflows
    const [workflows, setWorkflows] = useState<WorkflowSummaryResponse[]>([]);
    const [isLoadingWorkflows, setIsLoadingWorkflows] = useState(false);
    const [requiredCsvColumns, setRequiredCsvColumns] = useState<string[]>([]);
    const [isLoadingRequiredCsvColumns, setIsLoadingRequiredCsvColumns] = useState(false);

    // Telephony
    const [telephonyConfigs, setTelephonyConfigs] = useState<TelephonyConfigurationListItem[]>([]);
    const [selectedTelephonyConfigId, setSelectedTelephonyConfigId] = useState("");
    const [isLoadingTelephonyConfigs, setIsLoadingTelephonyConfigs] = useState(false);

    // Advanced & pacing limits
    const [orgConcurrentLimit, setOrgConcurrentLimit] = useState(2);
    const [fromNumbersCount, setFromNumbersCount] = useState(0);
    const [maxConcurrency, setMaxConcurrency] = useState("");

    // Retry settings
    const [retryEnabled, setRetryEnabled] = useState(true);
    const [maxRetries, setMaxRetries] = useState("2");
    const [retryDelaySeconds, setRetryDelaySeconds] = useState("120");
    const [retryOnBusy, setRetryOnBusy] = useState(true);
    const [retryOnNoAnswer, setRetryOnNoAnswer] = useState(true);
    const [retryOnVoicemail, setRetryOnVoicemail] = useState(true);

    // Schedule settings
    const [scheduleEnabled, setScheduleEnabled] = useState(false);
    const [scheduleTimezone, setScheduleTimezone] = useState<ITimezoneOption | string>(() => {
        try {
            return Intl.DateTimeFormat().resolvedOptions().timeZone;
        } catch {
            return "UTC";
        }
    });
    const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([
        { day_of_week: 0, start_time: "09:00", end_time: "17:00" },
    ]);
    const [scheduleMode, setScheduleMode] = useState<"window" | "start_at">("window");
    const [scheduleStartAt, setScheduleStartAt] = useState("");

    // Circuit breaker
    const [circuitBreakerEnabled, setCircuitBreakerEnabled] = useState(true);
    const [circuitBreakerFailureThreshold, setCircuitBreakerFailureThreshold] = useState("50");
    const [circuitBreakerWindowSeconds, setCircuitBreakerWindowSeconds] = useState("120");
    const [circuitBreakerMinCalls, setCircuitBreakerMinCalls] = useState("5");

    // Report template & variables
    const [reportTemplateEnabled, setReportTemplateEnabled] = useState(true);
    const [reportTemplate, setReportTemplate] = useState(DEFAULT_CAMPAIGN_REPORT_TEMPLATE);
    const [reportVariables, setReportVariables] = useState<ReportVariableItem[]>(DEFAULT_REPORT_VARIABLE_ITEMS);

    const resetForm = useCallback(() => {
        setCampaignName("");
        setSelectedWorkflowId("");
        setSourceId("");
        setSelectedFileName("");
        setMaxConcurrency("");
        setCreateError(null);
        setActiveTab("basic");
        setReportTemplate(DEFAULT_CAMPAIGN_REPORT_TEMPLATE);
        setReportVariables(DEFAULT_REPORT_VARIABLE_ITEMS);
    }, []);

    // Load initial data whenever drawer is opened
    useEffect(() => {
        if (!open || !user) return;

        let active = true;
        const fetchInitialData = async () => {
            setIsLoadingWorkflows(true);
            setIsLoadingTelephonyConfigs(true);
            try {
                const token = await getAccessToken();

                const [wfRes, teleRes, defRes] = await Promise.all([
                    getWorkflowsSummaryApiV1WorkflowSummaryGet({
                        headers: { Authorization: `Bearer ${token}` },
                        query: { status: "active" },
                    }),
                    listTelephonyConfigurationsApiV1OrganizationsTelephonyConfigsGet({
                        headers: { Authorization: `Bearer ${token}` },
                    }),
                    getCampaignDefaultsApiV1OrganizationsCampaignDefaultsGet({
                        headers: { Authorization: `Bearer ${token}` },
                    }),
                ]);

                if (!active) return;

                if (wfRes.data) setWorkflows(wfRes.data);
                if (teleRes.data?.configurations) {
                    const configs = teleRes.data.configurations;
                    setTelephonyConfigs(configs);
                    const defConfig = configs.find((c) => c.is_default_outbound) ?? configs[0];
                    if (defConfig) setSelectedTelephonyConfigId(String(defConfig.id));
                }
                if (defRes.data) {
                    setOrgConcurrentLimit(defRes.data.concurrent_call_limit);
                    setFromNumbersCount(defRes.data.from_numbers_count);
                }
            } catch (err) {
                console.error("Failed to fetch campaign presets:", err);
            } finally {
                if (active) {
                    setIsLoadingWorkflows(false);
                    setIsLoadingTelephonyConfigs(false);
                }
            }
        };

        void fetchInitialData();
        return () => { active = false; };
    }, [open, user, getAccessToken]);

    // Fetch required CSV headers for selected workflow
    useEffect(() => {
        if (!user || !selectedWorkflowId) {
            setRequiredCsvColumns([]);
            return;
        }
        let cancelled = false;
        const loadRequiredColumns = async () => {
            setIsLoadingRequiredCsvColumns(true);
            try {
                const token = await getAccessToken();
                const res = await getCampaignSourceColumnsApiV1CampaignWorkflowWorkflowIdSourceColumnsGet({
                    path: { workflow_id: Number(selectedWorkflowId) },
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (!cancelled) {
                    setRequiredCsvColumns(res.data?.required_columns ?? []);
                }
            } catch {
                if (!cancelled) setRequiredCsvColumns([]);
            } finally {
                if (!cancelled) setIsLoadingRequiredCsvColumns(false);
            }
        };
        void loadRequiredColumns();
        return () => { cancelled = true; };
    }, [user, selectedWorkflowId, getAccessToken]);

    const handleImportFromWorkflow = useCallback(async () => {
        if (!selectedWorkflowId) {
            toast.error("Please select an agent/workflow first in Basic Details");
            return;
        }
        try {
            const token = await getAccessToken();
            const res = await getWorkflowApiV1WorkflowFetchWorkflowIdGet({
                path: { workflow_id: Number(selectedWorkflowId) },
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.data) {
                const configs = (res.data.workflow_configurations ?? {}) as Record<string, unknown>;
                const tmpl = typeof configs.report_template === "string" ? configs.report_template : "";
                const rawVars = Array.isArray(configs.report_variables)
                    ? configs.report_variables
                    : Array.isArray(configs.extracted_variables)
                        ? configs.extracted_variables
                        : Array.isArray(configs.variables)
                            ? configs.variables
                            : [];

                const vars: ReportVariableItem[] = rawVars.map((item: unknown) => {
                    if (typeof item === "string") return { name: item, type: "text", description: "" };
                    const obj = (item || {}) as Record<string, unknown>;
                    return {
                        name: String(obj.name || obj.key || ""),
                        type: String(obj.type || "text"),
                        description: String(obj.description || obj.prompt || obj.instruction || ""),
                    };
                }).filter((v) => v.name.trim().length > 0);

                if (tmpl || vars.length > 0) {
                    setReportTemplateEnabled(true);
                    setReportTemplate(tmpl || DEFAULT_CAMPAIGN_REPORT_TEMPLATE);
                    setReportVariables(vars);
                    toast.success("Imported report template & variables from agent");
                } else {
                    toast.info("Selected agent does not have a custom report template or variables.");
                }
            }
        } catch {
            toast.error("Failed to import report template from agent");
        }
    }, [selectedWorkflowId, getAccessToken]);

    const selectedTelephonyConfig = telephonyConfigs.find(
        (c) => String(c.id) === selectedTelephonyConfigId,
    );
    const availableFromNumbersCount = selectedTelephonyConfig?.phone_number_count ?? fromNumbersCount;
    const effectiveLimit = availableFromNumbersCount > 0
        ? Math.min(orgConcurrentLimit, availableFromNumbersCount)
        : orgConcurrentLimit;

    const canSubmit = Boolean(
        campaignName.trim() &&
        selectedWorkflowId &&
        selectedTelephonyConfigId &&
        sourceId
    );

    const handleNextTab = () => {
        setCreateError(null);
        if (activeTab === "basic") {
            if (!campaignName.trim() || !selectedWorkflowId) {
                toast.error("Please enter a campaign name and select a workflow.");
                return;
            }
            setActiveTab("telephony");
        } else if (activeTab === "telephony") {
            if (!selectedTelephonyConfigId || !sourceId) {
                toast.error("Please select a telephony configuration and upload a CSV contact list.");
                return;
            }
            setActiveTab("advanced");
        } else if (activeTab === "advanced") {
            setActiveTab("report");
        } else if (activeTab === "report") {
            setActiveTab("variables");
        }
    };

    const handlePrevTab = () => {
        setCreateError(null);
        if (activeTab === "variables") setActiveTab("report");
        else if (activeTab === "report") setActiveTab("advanced");
        else if (activeTab === "advanced") setActiveTab("telephony");
        else if (activeTab === "telephony") setActiveTab("basic");
    };

    const handleSubmit = async () => {
        setCreateError(null);
        if (!canSubmit) {
            toast.error("Please complete all required fields (Name, Workflow, Telephony, CSV Audience)");
            return;
        }

        const maxConcurrencyValue = maxConcurrency ? parseInt(maxConcurrency) : null;
        if (maxConcurrencyValue !== null) {
            if (isNaN(maxConcurrencyValue) || maxConcurrencyValue < 1 || maxConcurrencyValue > 100) {
                toast.error("Max concurrent calls must be between 1 and 100");
                return;
            }
            if (maxConcurrencyValue > effectiveLimit) {
                toast.error(`Max concurrent calls cannot exceed ${effectiveLimit}`);
                return;
            }
        }

        if (scheduleEnabled && scheduleMode === "start_at" && !scheduleStartAt) {
            toast.error("Please select date and time to start the campaign");
            return;
        }

        setIsSubmitting(true);
        try {
            const token = await getAccessToken();
            const timezoneValue = getTimezoneValue(scheduleTimezone);

            const scheduleConfig = !scheduleEnabled
                ? undefined
                : scheduleMode === "start_at"
                    ? { enabled: true, mode: "start_at" as const, timezone: timezoneValue, start_at: scheduleStartAt, slots: [] }
                    : { enabled: true, mode: "window" as const, timezone: timezoneValue, slots: timeSlots };

            const response = await createCampaignApiV1CampaignCreatePost({
                body: {
                    name: campaignName.trim(),
                    workflow_id: parseInt(selectedWorkflowId),
                    source_type: sourceType,
                    source_id: sourceId,
                    telephony_configuration_id: parseInt(selectedTelephonyConfigId),
                    retry_config: {
                        enabled: retryEnabled,
                        max_retries: parseInt(maxRetries) || 2,
                        retry_delay_seconds: parseInt(retryDelaySeconds) || 120,
                        retry_on_busy: retryOnBusy,
                        retry_on_no_answer: retryOnNoAnswer,
                        retry_on_voicemail: retryOnVoicemail,
                    },
                    max_concurrency: maxConcurrencyValue,
                    schedule_config: scheduleConfig,
                    circuit_breaker: {
                        enabled: circuitBreakerEnabled,
                        failure_threshold: (parseInt(circuitBreakerFailureThreshold) || 50) / 100,
                        window_seconds: parseInt(circuitBreakerWindowSeconds) || 120,
                        min_calls_in_window: parseInt(circuitBreakerMinCalls) || 5,
                    },
                    report_template: reportTemplateEnabled ? reportTemplate : "",
                    report_variables: reportTemplateEnabled && reportVariables.length > 0 ? reportVariables : [],
                } as unknown as CreateCampaignRequest,
                headers: { Authorization: `Bearer ${token}` },
            });

            if (response.error) {
                const errDetail = (response.error as { detail?: string })?.detail;
                const msg = errDetail || "Failed to create campaign";
                setCreateError(msg);
                toast.error(msg);
                return;
            }

            if (response.data) {
                toast.success("Campaign created successfully!");
                resetForm();
                onOpenChange(false);
                if (onCampaignCreated) {
                    onCampaignCreated(response.data);
                } else {
                    router.push(`/campaigns/${response.data.id}`);
                }
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Failed to create campaign";
            setCreateError(msg);
            toast.error(msg);
        } finally {
            setIsSubmitting(false);
        }
    };

    const tabItems = useMemo(() => [
        { value: "basic", label: "Basic Details", dirty: Boolean(campaignName || selectedWorkflowId) },
        { value: "telephony", label: "Telephony & Audience", dirty: Boolean(sourceId) },
        { value: "advanced", label: "Advanced Controls", dirty: scheduleEnabled || !retryEnabled },
        { value: "report", label: "Campaign Report", dirty: reportTemplateEnabled && reportTemplate !== DEFAULT_CAMPAIGN_REPORT_TEMPLATE },
        { value: "variables", label: "Report Variables", dirty: reportVariables.length !== DEFAULT_REPORT_VARIABLE_ITEMS.length },
    ], [campaignName, selectedWorkflowId, sourceId, scheduleEnabled, retryEnabled, reportTemplateEnabled, reportTemplate, reportVariables.length]);

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="right" className="w-full sm:w-[560px] md:w-[640px] lg:w-[720px] sm:max-w-none">
                <SheetHeader>
                    <SheetTitle className="text-base font-semibold">
                        Create Campaign
                    </SheetTitle>
                </SheetHeader>

                <Tabs
                    value={activeTab}
                    onValueChange={(v) => { setCreateError(null); setActiveTab(v as CampaignCreateTab); }}
                    className="flex min-h-0 flex-1 flex-col gap-0"
                >
                    <div className="shrink-0 border-b border-border px-4 pb-3">
                        <UnderlineTabs
                            value={activeTab}
                            onValueChange={(v) => { setCreateError(null); setActiveTab(v as CampaignCreateTab); }}
                            items={tabItems}
                        />
                    </div>

                    <SheetBody className="px-4 py-4 space-y-4">
                        <TabsContent value="basic" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
                            <CampaignBasicDetailsSection
                                campaignName={campaignName}
                                onCampaignNameChange={(v) => { setCampaignName(v); setCreateError(null); }}
                                selectedWorkflowId={selectedWorkflowId}
                                onSelectedWorkflowIdChange={(v) => { setSelectedWorkflowId(v); setCreateError(null); }}
                                workflows={workflows}
                                isLoadingWorkflows={isLoadingWorkflows}
                                requiredCsvColumns={requiredCsvColumns}
                                isLoadingRequiredCsvColumns={isLoadingRequiredCsvColumns}
                            />
                        </TabsContent>

                        <TabsContent value="telephony" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
                            <CampaignTelephonySection
                                telephonyConfigs={telephonyConfigs}
                                selectedTelephonyConfigId={selectedTelephonyConfigId}
                                onSelectedTelephonyConfigIdChange={(v) => { setSelectedTelephonyConfigId(v); setCreateError(null); }}
                                isLoadingTelephonyConfigs={isLoadingTelephonyConfigs}
                                onFileUploaded={(key, name) => {
                                    setSourceId(key);
                                    setSelectedFileName(name);
                                    setCreateError(null);
                                }}
                                selectedFileName={selectedFileName}
                                sourceId={sourceId}
                                effectiveLimit={effectiveLimit}
                                orgConcurrentLimit={orgConcurrentLimit}
                                availableFromNumbersCount={availableFromNumbersCount}
                            />
                        </TabsContent>

                        <TabsContent value="advanced" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
                            <CampaignAdvancedSettings
                                mode="controls"
                                maxConcurrency={maxConcurrency}
                                onMaxConcurrencyChange={setMaxConcurrency}
                                effectiveLimit={effectiveLimit}
                                orgConcurrentLimit={orgConcurrentLimit}
                                fromNumbersCount={availableFromNumbersCount}
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
                                reportTemplateEnabled={reportTemplateEnabled}
                                onReportTemplateEnabledChange={setReportTemplateEnabled}
                                reportTemplate={reportTemplate}
                                onReportTemplateChange={setReportTemplate}
                                reportVariables={reportVariables}
                                onReportVariablesChange={setReportVariables}
                                onImportFromWorkflow={handleImportFromWorkflow}
                            />
                        </TabsContent>

                        <TabsContent value="report" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
                            <DetailSection
                                title="Post-Call Report Template"
                                description="Define an HTML/Jinja2 template for summarizing completed calls."
                                action={
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={handleImportFromWorkflow}
                                        className="h-7 text-xs gap-1.5 cursor-pointer"
                                    >
                                        <Sparkles className="h-3 w-3 text-primary" />
                                        Import from Agent
                                    </Button>
                                }
                            >
                                <CampaignAdvancedSettings
                                    mode="report"
                                    maxConcurrency={maxConcurrency}
                                    onMaxConcurrencyChange={setMaxConcurrency}
                                    effectiveLimit={effectiveLimit}
                                    orgConcurrentLimit={orgConcurrentLimit}
                                    fromNumbersCount={availableFromNumbersCount}
                                    retryEnabled={false}
                                    onRetryEnabledChange={() => {}}
                                    maxRetries={maxRetries}
                                    onMaxRetriesChange={() => {}}
                                    retryDelaySeconds={retryDelaySeconds}
                                    onRetryDelaySecondsChange={() => {}}
                                    retryOnBusy={false}
                                    onRetryOnBusyChange={() => {}}
                                    retryOnNoAnswer={false}
                                    onRetryOnNoAnswerChange={() => {}}
                                    retryOnVoicemail={false}
                                    onRetryOnVoicemailChange={() => {}}
                                    scheduleEnabled={false}
                                    onScheduleEnabledChange={() => {}}
                                    scheduleTimezone={scheduleTimezone}
                                    onScheduleTimezoneChange={() => {}}
                                    timeSlots={timeSlots}
                                    onTimeSlotsChange={() => {}}
                                    circuitBreakerEnabled={false}
                                    onCircuitBreakerEnabledChange={() => {}}
                                    circuitBreakerFailureThreshold={circuitBreakerFailureThreshold}
                                    onCircuitBreakerFailureThresholdChange={() => {}}
                                    circuitBreakerWindowSeconds={circuitBreakerWindowSeconds}
                                    onCircuitBreakerWindowSecondsChange={() => {}}
                                    circuitBreakerMinCalls={circuitBreakerMinCalls}
                                    onCircuitBreakerMinCallsChange={() => {}}
                                    reportTemplateEnabled={reportTemplateEnabled}
                                    onReportTemplateEnabledChange={setReportTemplateEnabled}
                                    reportTemplate={reportTemplate}
                                    onReportTemplateChange={setReportTemplate}
                                    reportVariables={reportVariables}
                                    onReportVariablesChange={setReportVariables}
                                    onImportFromWorkflow={handleImportFromWorkflow}
                                />
                            </DetailSection>
                        </TabsContent>

                        <TabsContent value="variables" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
                            <DetailSection
                                title="Custom Extraction Variables"
                                description="Extract structured data points (intent, sentiment, disposition) from call transcripts."
                                action={
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={handleImportFromWorkflow}
                                        className="h-7 text-xs gap-1.5 cursor-pointer"
                                    >
                                        <Sparkles className="h-3 w-3 text-primary" />
                                        Import from Agent
                                    </Button>
                                }
                            >
                                <CampaignAdvancedSettings
                                    mode="variables"
                                    maxConcurrency={maxConcurrency}
                                    onMaxConcurrencyChange={setMaxConcurrency}
                                    effectiveLimit={effectiveLimit}
                                    orgConcurrentLimit={orgConcurrentLimit}
                                    fromNumbersCount={availableFromNumbersCount}
                                    retryEnabled={false}
                                    onRetryEnabledChange={() => {}}
                                    maxRetries={maxRetries}
                                    onMaxRetriesChange={() => {}}
                                    retryDelaySeconds={retryDelaySeconds}
                                    onRetryDelaySecondsChange={() => {}}
                                    retryOnBusy={false}
                                    onRetryOnBusyChange={() => {}}
                                    retryOnNoAnswer={false}
                                    onRetryOnNoAnswerChange={() => {}}
                                    retryOnVoicemail={false}
                                    onRetryOnVoicemailChange={() => {}}
                                    scheduleEnabled={false}
                                    onScheduleEnabledChange={() => {}}
                                    scheduleTimezone={scheduleTimezone}
                                    onScheduleTimezoneChange={() => {}}
                                    timeSlots={timeSlots}
                                    onTimeSlotsChange={() => {}}
                                    circuitBreakerEnabled={false}
                                    onCircuitBreakerEnabledChange={() => {}}
                                    circuitBreakerFailureThreshold={circuitBreakerFailureThreshold}
                                    onCircuitBreakerFailureThresholdChange={() => {}}
                                    circuitBreakerWindowSeconds={circuitBreakerWindowSeconds}
                                    onCircuitBreakerWindowSecondsChange={() => {}}
                                    circuitBreakerMinCalls={circuitBreakerMinCalls}
                                    onCircuitBreakerMinCallsChange={() => {}}
                                    reportTemplateEnabled={reportTemplateEnabled}
                                    onReportTemplateEnabledChange={setReportTemplateEnabled}
                                    reportTemplate={reportTemplate}
                                    onReportTemplateChange={setReportTemplate}
                                    reportVariables={reportVariables}
                                    onReportVariablesChange={setReportVariables}
                                    onImportFromWorkflow={handleImportFromWorkflow}
                                />
                            </DetailSection>
                        </TabsContent>
                    </SheetBody>

                    <SheetFooter className="justify-between border-t border-border px-4 py-3 bg-card/95">
                        <div className="flex items-center gap-2 min-w-0">
                            {activeTab !== "basic" && (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={handlePrevTab}
                                    disabled={isSubmitting}
                                    className="h-8 text-xs font-medium cursor-pointer"
                                >
                                    <ArrowLeft className="h-3.5 w-3.5 mr-1" />
                                    Previous
                                </Button>
                            )}
                            {createError && (
                                <p className="text-[11px] text-destructive truncate max-w-[200px]" title={createError}>
                                    {createError}
                                </p>
                            )}
                        </div>

                        <div className="flex items-center gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => onOpenChange(false)}
                                disabled={isSubmitting}
                                className="h-8 text-xs font-medium cursor-pointer"
                            >
                                Cancel
                            </Button>

                            {activeTab !== "variables" ? (
                                <>
                                    <Button
                                        type="button"
                                        variant={canSubmit ? "outline" : "default"}
                                        size="sm"
                                        onClick={handleNextTab}
                                        disabled={isSubmitting}
                                        className="h-8 text-xs font-medium gap-1 cursor-pointer"
                                    >
                                        Next Step
                                        <ArrowRight className="h-3.5 w-3.5 ml-1" />
                                    </Button>
                                    {canSubmit && (
                                        <Button
                                            type="button"
                                            size="sm"
                                            onClick={handleSubmit}
                                            disabled={isSubmitting}
                                            className="h-8 text-xs font-medium gap-1.5 cursor-pointer"
                                        >
                                            {isSubmitting ? (
                                                <>
                                                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                                    Creating…
                                                </>
                                            ) : (
                                                <>
                                                    <Zap className="h-3.5 w-3.5" />
                                                    Create Campaign
                                                </>
                                            )}
                                        </Button>
                                    )}
                                </>
                            ) : (
                                <Button
                                    type="button"
                                    size="sm"
                                    onClick={handleSubmit}
                                    disabled={isSubmitting || !canSubmit}
                                    className="h-8 text-xs font-medium gap-1.5 cursor-pointer"
                                >
                                    {isSubmitting ? (
                                        <>
                                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                            Creating…
                                        </>
                                    ) : (
                                        <>
                                            <Zap className="h-3.5 w-3.5" />
                                            Create Campaign
                                        </>
                                    )}
                                </Button>
                            )}
                        </div>
                    </SheetFooter>
                </Tabs>
            </SheetContent>
        </Sheet>
    );
}
