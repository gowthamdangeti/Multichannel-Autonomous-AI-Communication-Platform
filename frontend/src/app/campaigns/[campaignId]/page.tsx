"use client";

import { format } from 'date-fns';
import { CalendarIcon, Download, FileText, Pause, Pencil, Phone, Play, RefreshCw, Trash2 } from 'lucide-react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { client } from '@/client/client.gen';
import {
    createCampaignCallTargetApiV1CampaignCampaignIdCallTargetsPost,
    deleteCampaignCallTargetApiV1CampaignCampaignIdCallTargetsTargetIdDelete,
    downloadCampaignReportApiV1CampaignCampaignIdReportGet,
    getCampaignApiV1CampaignCampaignIdGet,
    getCampaignCallTargetsApiV1CampaignCampaignIdCallTargetsGet,
    getCampaignSourceDownloadUrlApiV1CampaignCampaignIdSourceDownloadUrlGet,
    pauseCampaignApiV1CampaignCampaignIdPausePost,
    redialCampaignApiV1CampaignCampaignIdRedialPost,
    resumeCampaignApiV1CampaignCampaignIdResumePost,
    startCampaignApiV1CampaignCampaignIdStartPost,
    updateCampaignCallTargetApiV1CampaignCampaignIdCallTargetsTargetIdPatch,
} from '@/client/sdk.gen';
import type { CampaignCallTargetResponse, CampaignCallTargetsResponse, CampaignResponse } from '@/client/types.gen';
import { CAMPAIGN_TABS, CampaignActivityLog, CampaignCallTargetsCard, CampaignOverviewSidebar, CampaignSummaryCard, type CampaignTab } from '@/components/campaigns/detail';
import { DetailPanel } from '@/components/detail-panel/DetailPanel';
import { InlineReportViewer } from '@/components/InlineReportViewer';
import { RowAction, RowActionSeparator, RowActionsMenu } from '@/components/layout/RowActionsMenu';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { CampaignAnalytics, CampaignRuns } from '@/components/workflow-runs';
import { type Breadcrumb, PageHeader } from '@/context/HeaderContext';
import { getBackendApiUrl } from '@/lib/apiClient';
import { detailFromError } from '@/lib/apiError';
import { useAuth } from '@/lib/auth';

export default function CampaignDetailPage() {
    const { user, getAccessToken, redirectToLogin, loading } = useAuth();
    const router = useRouter();
    const params = useParams();
    const searchParams = useSearchParams();
    const campaignId = parseInt(params.campaignId as string);

    // Redirect if not authenticated
    useEffect(() => {
        if (!loading && !user) {
            redirectToLogin();
        }
    }, [loading, user, redirectToLogin]);

    // Section tab, kept in the URL so Back and shared links return to it.
    const tabParam = searchParams.get('tab');
    const activeTab: CampaignTab = CAMPAIGN_TABS.some((tab) => tab.id === tabParam) ? (tabParam as CampaignTab) : 'overview';
    const handleTabChange = (tab: CampaignTab) => {
        const params = new URLSearchParams(searchParams.toString());
        if (tab === 'overview') params.delete('tab');
        else params.set('tab', tab);
        const query = params.toString();
        router.replace(`/campaigns/${campaignId}${query ? `?${query}` : ''}`, { scroll: false });
    };

    // Campaign state
    const [campaign, setCampaign] = useState<CampaignResponse | null>(null);
    const breadcrumbs = useMemo<Breadcrumb[]>(
        () => [
            { label: 'Campaigns', href: '/campaigns' },
            { label: campaign?.name || (campaignId ? `Campaign #${campaignId}` : 'Campaign Details') },
        ],
        [campaign?.name, campaignId],
    );
    const [isLoadingCampaign, setIsLoadingCampaign] = useState(true);
    const [isReportReady, setIsReportReady] = useState(false);
    const [callTargets, setCallTargets] = useState<CampaignCallTargetsResponse | null>(null);
    const [isLoadingCallTargets, setIsLoadingCallTargets] = useState(true);
    const [callTargetsPage, setCallTargetsPage] = useState(1);

    // Action state
    const [isExecutingAction, setIsExecutingAction] = useState(false);
    const [isDownloadingReport, setIsDownloadingReport] = useState(false);
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    // Report date range state
    const [reportStartDate, setReportStartDate] = useState<Date | undefined>(undefined);
    const [reportStartTime, setReportStartTime] = useState('00:00');
    const [reportEndDate, setReportEndDate] = useState<Date | undefined>(undefined);
    const [reportEndTime, setReportEndTime] = useState('23:59');
    const [isReportPopoverOpen, setIsReportPopoverOpen] = useState(false);

    // Redial dialog state
    const [isRedialDialogOpen, setIsRedialDialogOpen] = useState(false);
    const [redialName, setRedialName] = useState('');
    const [redialOnVoicemail, setRedialOnVoicemail] = useState(true);
    const [redialOnNoAnswer, setRedialOnNoAnswer] = useState(true);
    const [redialOnBusy, setRedialOnBusy] = useState(true);
    const [isRedialing, setIsRedialing] = useState(false);

    // Editable call target dialog state
    const [isTargetDialogOpen, setIsTargetDialogOpen] = useState(false);
    const [editingTarget, setEditingTarget] = useState<CampaignCallTargetResponse | null>(null);
    const [targetPhoneNumber, setTargetPhoneNumber] = useState('');
    const [targetContext, setTargetContext] = useState('{}');
    const [isSavingTarget, setIsSavingTarget] = useState(false);

    // Card refresh: campaign, numbers and the open tab, without the page skeleton.
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [refreshKey, setRefreshKey] = useState(0);

    // Height sync for right sidebar and left content in report tab
    const [sidebarHeight, setSidebarHeight] = useState<number | null>(null);
    const [isDesktop, setIsDesktop] = useState(true);
    const resizeObserverRef = useRef<ResizeObserver | null>(null);

    useEffect(() => {
        const checkDesktop = () => setIsDesktop(window.innerWidth >= 1024);
        checkDesktop();
        window.addEventListener('resize', checkDesktop);
        return () => window.removeEventListener('resize', checkDesktop);
    }, []);

    const handleRightSidebarRef = useCallback((node: HTMLDivElement | null) => {
        if (resizeObserverRef.current) {
            resizeObserverRef.current.disconnect();
            resizeObserverRef.current = null;
        }
        if (!node) return;

        const updateHeight = () => {
            const h = node.offsetHeight;
            if (h > 0) {
                setSidebarHeight(h);
            }
        };
        updateHeight();

        const ro = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const h = Math.round(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height);
                if (h > 0) {
                    setSidebarHeight(h);
                }
            }
        });
        ro.observe(node);
        resizeObserverRef.current = ro;
    }, []);

    // Fetch campaign details
    // `silent`: reload in place (card refresh) instead of showing the page skeleton.
    const fetchCampaign = useCallback(async (silent = false) => {
        if (!user) return;
        if (!silent) setIsLoadingCampaign(true);
        try {
            const accessToken = await getAccessToken();
            if (!accessToken) return;

            const response = await getCampaignApiV1CampaignCampaignIdGet({
                path: {
                    campaign_id: campaignId,
                },
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                }
            });

            if (response.data) {
                setCampaign(response.data);
                const rawData = response.data as unknown as {
                    orchestrator_metadata?: Record<string, unknown>;
                    report_generation_status?: string;
                    report_generated_at?: string;
                    report_s3_key?: string;
                };
                const meta = (rawData.orchestrator_metadata || {}) as Record<string, unknown>;
                if (
                    rawData.report_generation_status === 'completed' ||
                    rawData.report_generated_at ||
                    rawData.report_s3_key ||
                    meta.report_generation_status === 'completed' ||
                    meta.report_variables_values ||
                    meta.report_generated_at ||
                    meta.report_s3_key
                ) {
                    setIsReportReady(true);
                }
            }

            // Also check report status endpoint if report not already detected
            try {
                const baseUrl = getBackendApiUrl();
                const statusRes = await fetch(`${baseUrl}/api/v1/campaign/${campaignId}/report/status`, {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'ngrok-skip-browser-warning': 'true',
                        'Accept': 'application/json',
                    },
                });
                const contentType = statusRes.headers.get('content-type') || '';
                if (statusRes.ok && contentType.includes('application/json')) {
                    const statusData = await statusRes.json();
                    if (statusData.status === 'completed' || statusData.generated_at) {
                        setIsReportReady(true);
                    }
                }
            } catch {
                // Secondary check error ignored since metadata from SDK is authoritative
            }
        } catch (error) {
            console.error('Failed to fetch campaign:', error);
            toast.error('Failed to load campaign details');
        } finally {
            setIsLoadingCampaign(false);
        }
    }, [user, getAccessToken, campaignId]);

    // Initial load
    useEffect(() => {
        fetchCampaign();
    }, [fetchCampaign]);

    const fetchCallTargets = useCallback(async (page: number) => {
        if (!user) return;
        setIsLoadingCallTargets(true);
        try {
            const accessToken = await getAccessToken();
            const response = await getCampaignCallTargetsApiV1CampaignCampaignIdCallTargetsGet({
                path: { campaign_id: campaignId },
                query: { page, limit: 50 },
                headers: { 'Authorization': `Bearer ${accessToken}` },
            });
            if (response.data) {
                setCallTargets(response.data);
            }
        } catch (error) {
            console.error('Failed to fetch campaign call targets:', error);
            toast.error('Failed to load campaign call targets');
        } finally {
            setIsLoadingCallTargets(false);
        }
    }, [user, getAccessToken, campaignId]);

    const handleRefresh = async () => {
        setIsRefreshing(true);
        try {
            await Promise.all([fetchCampaign(true), fetchCallTargets(callTargetsPage)]);
            setRefreshKey((key) => key + 1); // Analytics / Runs / Report reload their own data
        } finally {
            setIsRefreshing(false);
        }
    };

    const canEditCallTargets = campaign?.state === 'created' && callTargets !== null && callTargets.targets.every((target) => target.id !== null && target.id !== undefined);

    const openTargetDialog = (target?: CampaignCallTargetResponse) => {
        setEditingTarget(target ?? null);
        setTargetPhoneNumber(target?.phone_number ?? '');
        setTargetContext(JSON.stringify(target?.context_variables ?? {}, null, 2));
        setIsTargetDialogOpen(true);
    };

    const saveTarget = async () => {
        if (!user) return;
        let contextVariables: Record<string, unknown>;
        try {
            const parsed = JSON.parse(targetContext);
            if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
                throw new Error('Context must be a JSON object');
            }
            contextVariables = parsed;
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Context must be valid JSON');
            return;
        }

        setIsSavingTarget(true);
        try {
            const accessToken = await getAccessToken();
            const response = editingTarget?.id === undefined || editingTarget?.id === null
                ? await createCampaignCallTargetApiV1CampaignCampaignIdCallTargetsPost({
                    path: { campaign_id: campaignId },
                    body: { phone_number: targetPhoneNumber, context_variables: contextVariables },
                    headers: { 'Authorization': `Bearer ${accessToken}` },
                })
                : await updateCampaignCallTargetApiV1CampaignCampaignIdCallTargetsTargetIdPatch({
                    path: { campaign_id: campaignId, target_id: editingTarget.id },
                    body: { phone_number: targetPhoneNumber, context_variables: contextVariables },
                    headers: { 'Authorization': `Bearer ${accessToken}` },
                });
            if (response.data) {
                toast.success(editingTarget ? 'Number updated' : 'Number added');
                setCallTargetsPage(1);
                await fetchCallTargets(1);
                setIsTargetDialogOpen(false);
            } else {
                toast.error('Unable to save number');
            }
        } catch (error) {
            console.error('Failed to save campaign call target:', error);
            toast.error('Unable to save number');
        } finally {
            setIsSavingTarget(false);
        }
    };

    const deleteTarget = async (target: CampaignCallTargetResponse) => {
        if (!user || target.id === undefined || target.id === null || !window.confirm(`Remove ${target.phone_number} from this campaign?`)) return;
        try {
            const accessToken = await getAccessToken();
            const response = await deleteCampaignCallTargetApiV1CampaignCampaignIdCallTargetsTargetIdDelete({
                path: { campaign_id: campaignId, target_id: target.id },
                headers: { 'Authorization': `Bearer ${accessToken}` },
            });
            if (!response.error) {
                toast.success('Number removed');
                await fetchCallTargets(callTargetsPage);
            } else {
                toast.error('Unable to remove number');
            }
        } catch (error) {
            console.error('Failed to delete campaign call target:', error);
            toast.error('Unable to remove number');
        }
    };

    const handleDeleteCampaign = async () => {
        if (!campaign) return;

        setIsDeleting(true);
        try {
            const accessToken = await getAccessToken();
            const response = await client.delete({
                url: '/api/v1/campaign/{campaign_id}',
                path: { campaign_id: campaign.id },
                headers: { Authorization: `Bearer ${accessToken}` },
            });
            if (response.error) throw new Error(detailFromError(response.error));

            toast.success('Campaign deleted and scheduled calls cancelled');
            router.push('/campaigns');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to delete campaign');
        } finally {
            setIsDeleting(false);
        }
    };

    useEffect(() => {
        fetchCallTargets(callTargetsPage);
    }, [fetchCallTargets, callTargetsPage]);

    // Handle workflow link click
    const handleWorkflowClick = () => {
        if (campaign) {
            router.push(`/workflow/${campaign.workflow_id}`);
        }
    };

    // Handle CSV download
    const handleDownloadCsv = async () => {
        if (!user || !campaign || campaign.source_type !== 'csv') return;

        try {
            const accessToken = await getAccessToken();
            const response = await getCampaignSourceDownloadUrlApiV1CampaignCampaignIdSourceDownloadUrlGet({
                path: {
                    campaign_id: campaignId,
                },
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                }
            });

            if (response.data?.download_url) {
                // Open download URL in new tab
                window.open(response.data.download_url, '_blank');
            } else {
                toast.error('Failed to get download URL');
            }
        } catch (error) {
            console.error('Failed to download CSV:', error);
            toast.error('Failed to download CSV file');
        }
    };

    // Build ISO datetime string from date + time
    const buildDateTime = (date: Date | undefined, time: string): string | undefined => {
        if (!date) return undefined;
        const [hours, minutes] = time.split(':').map(Number);
        const combined = new Date(date);
        combined.setHours(hours, minutes, 0, 0);
        return combined.toISOString();
    };

    // Handle download report
    const handleDownloadReport = async () => {
        if (!user) return;
        setIsDownloadingReport(true);
        setIsReportPopoverOpen(false);
        try {
            const accessToken = await getAccessToken();
            const startDate = buildDateTime(reportStartDate, reportStartTime);
            const endDate = buildDateTime(reportEndDate, reportEndTime);

            const response = await downloadCampaignReportApiV1CampaignCampaignIdReportGet({
                path: {
                    campaign_id: campaignId,
                },
                query: {
                    start_date: startDate,
                    end_date: endDate,
                },
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                },
                parseAs: 'blob',
            });

            if (response.data) {
                const blob = response.data as Blob;
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `campaign_${campaignId}_report.csv`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                window.URL.revokeObjectURL(url);
            } else {
                toast.error('Failed to download report');
            }
        } catch (error) {
            console.error('Failed to download report:', error);
            toast.error('Failed to download report');
        } finally {
            setIsDownloadingReport(false);
        }
    };

    const [isGeneratingReport, setIsGeneratingReport] = useState(false);

    // Handle Campaign Report Preview button click (opens offcanvas drawer with campaign report)
    // Handle manual "Generate Campaign Report" button click
    const handleGenerateCampaignReport = async () => {
        if (!user || !campaign) return;
        setIsGeneratingReport(true);
        try {
            const accessToken = await getAccessToken();
            const baseUrl = getBackendApiUrl();
            const res = await fetch(`${baseUrl}/api/v1/campaign/${campaignId}/report/generate?force_refresh=true`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'ngrok-skip-browser-warning': 'true',
                    'Accept': 'application/json',
                },
            });
            if (res.ok) {
                toast.success('Generating the campaign report');
                let attempts = 0;
                const pollInterval = setInterval(async () => {
                    attempts++;
                    if (attempts > 60) {
                        clearInterval(pollInterval);
                        setIsGeneratingReport(false);
                        return;
                    }
                    try {
                        let isCompleted = false;

                        // Check status endpoint
                        const statusRes = await fetch(`${baseUrl}/api/v1/campaign/${campaignId}/report/status`, {
                            headers: {
                                'Authorization': `Bearer ${accessToken}`,
                                'ngrok-skip-browser-warning': 'true',
                                'Accept': 'application/json',
                            },
                        });
                        const contentType = statusRes.headers.get('content-type') || '';
                        if (statusRes.ok && contentType.includes('application/json')) {
                            const statusData = await statusRes.json();
                            if (statusData.status === 'completed') {
                                isCompleted = true;
                            } else if (statusData.status === 'failed') {
                                clearInterval(pollInterval);
                                setIsGeneratingReport(false);
                                toast.error(`Report generation failed: ${statusData.error || 'Unknown error'}`);
                                return;
                            }
                        }

                        // Also verify campaign metadata directly
                        const campRes = await getCampaignApiV1CampaignCampaignIdGet({
                            path: { campaign_id: campaignId },
                            headers: { 'Authorization': `Bearer ${accessToken}` },
                        });
                        if (campRes.data) {
                            const rawData = campRes.data as unknown as {
                                orchestrator_metadata?: Record<string, unknown>;
                                report_generation_status?: string;
                                report_generated_at?: string;
                            };
                            const meta = rawData.orchestrator_metadata || {};
                            if (
                                rawData.report_generation_status === 'completed' ||
                                rawData.report_generated_at ||
                                meta.report_generation_status === 'completed' ||
                                meta.report_variables_values ||
                                meta.report_generated_at
                            ) {
                                isCompleted = true;
                            }
                        }

                        if (isCompleted) {
                            clearInterval(pollInterval);
                            setIsGeneratingReport(false);
                            setIsReportReady(true);
                            await fetchCampaign();
                            toast.success('Campaign report ready');
                            handleTabChange('report');
                        }
                    } catch (e) {
                        console.error('Polling report status error:', e);
                    }
                }, 2000);
            } else {
                const errData = await res.json().catch(() => ({}));
                toast.error(errData.detail || 'Failed to trigger report generation');
                setIsGeneratingReport(false);
            }
        } catch (error) {
            console.error('Failed to trigger campaign report generation:', error);
            toast.error('Failed to trigger campaign report generation');
            setIsGeneratingReport(false);
        }
    };

    const handleClearDateRange = () => {
        setReportStartDate(undefined);
        setReportStartTime('00:00');
        setReportEndDate(undefined);
        setReportEndTime('23:59');
    };

    // Handle start campaign
    const handleStart = async () => {
        if (!user) return;
        setIsExecutingAction(true);
        try {
            const accessToken = await getAccessToken();
            const response = await startCampaignApiV1CampaignCampaignIdStartPost({
                path: {
                    campaign_id: campaignId,
                },
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                }
            });

            if (response.data) {
                setCampaign(response.data);
                toast.success('Campaign started');
                fetchCallTargets(callTargetsPage);
            } else if (response.error) {
                // Extract error message from response
                let errorMsg = 'Failed to start campaign';
                if (typeof response.error === 'string') {
                    errorMsg = response.error;
                } else if (response.error && typeof response.error === 'object') {
                    errorMsg = (response.error as unknown as { detail?: string }).detail || JSON.stringify(response.error);
                }
                toast.error(errorMsg);
            }
        } catch (error) {
            console.error('Failed to start campaign:', error);
            toast.error('Failed to start campaign');
        } finally {
            setIsExecutingAction(false);
        }
    };

    // Handle resume campaign
    const handleResume = async () => {
        if (!user) return;
        setIsExecutingAction(true);
        try {
            const accessToken = await getAccessToken();
            const response = await resumeCampaignApiV1CampaignCampaignIdResumePost({
                path: {
                    campaign_id: campaignId,
                },
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                }
            });

            if (response.data) {
                setCampaign(response.data);
                toast.success('Campaign resumed');
            } else if (response.error) {
                // Extract error message from response
                let errorMsg = 'Failed to resume campaign';
                if (typeof response.error === 'string') {
                    errorMsg = response.error;
                } else if (response.error && typeof response.error === 'object') {
                    errorMsg = (response.error as unknown as { detail?: string }).detail || JSON.stringify(response.error);
                }
                toast.error(errorMsg);
            }
        } catch (error) {
            console.error('Failed to resume campaign:', error);
            toast.error('Failed to resume campaign');
        } finally {
            setIsExecutingAction(false);
        }
    };

    // Open redial dialog with default name
    const openRedialDialog = () => {
        if (!campaign) return;
        setRedialName(`${campaign.name} (Redial)`);
        setRedialOnVoicemail(true);
        setRedialOnNoAnswer(true);
        setRedialOnBusy(true);
        setIsRedialDialogOpen(true);
    };

    // Handle redial campaign
    const handleRedial = async () => {
        if (!user || !campaign) return;
        if (!redialOnVoicemail && !redialOnNoAnswer && !redialOnBusy) {
            toast.error('Select at least one reason to redial');
            return;
        }
        setIsRedialing(true);
        try {
            const accessToken = await getAccessToken();
            const response = await redialCampaignApiV1CampaignCampaignIdRedialPost({
                path: {
                    campaign_id: campaignId,
                },
                body: {
                    name: redialName || null,
                    retry_on_voicemail: redialOnVoicemail,
                    retry_on_no_answer: redialOnNoAnswer,
                    retry_on_busy: redialOnBusy,
                },
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                }
            });

            if (response.data) {
                toast.success('Redial campaign created');
                setIsRedialDialogOpen(false);
                router.push(`/campaigns/${response.data.id}`);
            } else if (response.error) {
                let errorMsg = 'Failed to create redial campaign';
                if (typeof response.error === 'string') {
                    errorMsg = response.error;
                } else if (response.error && typeof response.error === 'object') {
                    errorMsg = (response.error as unknown as { detail?: string }).detail || JSON.stringify(response.error);
                }
                toast.error(errorMsg);
            }
        } catch (error) {
            console.error('Failed to redial campaign:', error);
            toast.error('Failed to create redial campaign');
        } finally {
            setIsRedialing(false);
        }
    };

    // Handle pause campaign
    const handlePause = async () => {
        if (!user) return;
        setIsExecutingAction(true);
        try {
            const accessToken = await getAccessToken();
            const response = await pauseCampaignApiV1CampaignCampaignIdPausePost({
                path: {
                    campaign_id: campaignId,
                },
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                }
            });

            if (response.data) {
                setCampaign(response.data);
                toast.success('Campaign paused');
            }
        } catch (error) {
            console.error('Failed to pause campaign:', error);
            toast.error('Failed to pause campaign');
        } finally {
            setIsExecutingAction(false);
        }
    };

    const canEdit = campaign && ['created', 'running', 'paused'].includes(campaign.state);


    const campaignMeta = campaign as unknown as {
        has_report_template?: boolean;
        report_template?: string;
        report_generation_status?: string;
        report_generated_at?: string;
        orchestrator_metadata?: Record<string, unknown>;
    } | null;
    const orchestratorMeta = campaignMeta?.orchestrator_metadata;
    const hasReportTemplate = Boolean(
        campaignMeta?.has_report_template ||
        (campaignMeta?.report_template && campaignMeta.report_template.trim() !== '') ||
        orchestratorMeta?.report_template
    );
    const hasGeneratedReport = Boolean(
        isReportReady ||
        campaignMeta?.report_generation_status === 'completed' ||
        campaignMeta?.report_generated_at ||
        orchestratorMeta?.report_generation_status === 'completed' ||
        orchestratorMeta?.report_variables_values ||
        orchestratorMeta?.report_generated_at ||
        orchestratorMeta?.report_s3_key
    );

    const visibleTabs = CAMPAIGN_TABS.filter((tab) => tab.id !== 'report' || hasReportTemplate);
    const shownTab: CampaignTab = visibleTabs.some((tab) => tab.id === activeTab) ? activeTab : 'overview';

    // The one primary action for the campaign's state.
    const renderPrimaryAction = () => {
        if (!campaign || isExecutingAction) return null;
        switch (campaign.state) {
            case 'created':
                return (
                    <Button onClick={handleStart} size="sm" className="h-8" disabled={isExecutingAction}>
                        <Play className="h-4 w-4" />
                        Start campaign
                    </Button>
                );
            case 'running':
                return (
                    <Button onClick={handlePause} size="sm" className="h-8" disabled={isExecutingAction}>
                        <Pause className="h-4 w-4" />
                        Pause campaign
                    </Button>
                );
            case 'paused':
                return (
                    <Button onClick={handleResume} size="sm" className="h-8" disabled={isExecutingAction}>
                        <RefreshCw className="h-4 w-4" />
                        Resume campaign
                    </Button>
                );
            case 'completed':
                if (campaign.redialed_campaign_id) return null;
                return (
                    <Button onClick={openRedialDialog} size="sm" className="h-8">
                        <Phone className="h-4 w-4" />
                        Redial campaign
                    </Button>
                );
            default:
                return null;
        }
    };

    if (isLoadingCampaign) {
        return (
            <div className="space-y-4 px-4 pt-2 pb-6 lg:px-6">
                <Skeleton className="h-44 w-full rounded-xl" />
                <div className="grid gap-4 lg:grid-cols-3">
                    <Skeleton className="h-72 rounded-xl lg:col-span-2" />
                    <Skeleton className="h-72 rounded-xl" />
                </div>
            </div>
        );
    }

    if (!campaign) {
        return (
            <div className="px-4 pt-2 pb-6 lg:px-6">
                <p className="py-12 text-center text-sm text-muted-foreground">Campaign not found</p>
            </div>
        );
    }

    return (
        // data-detail-page: same detail-page theme rules as the conversation page,
        // so the cards here and there render identically.
        <div data-detail-page className="space-y-4 px-4 pt-4 pb-6 lg:px-6">
            <PageHeader
                breadcrumbs={breadcrumbs}
                title={campaign.name}
                actions={
                    <div className="flex items-center gap-2">
                        <Popover open={isReportPopoverOpen} onOpenChange={setIsReportPopoverOpen}>
                            <PopoverTrigger asChild>
                                <Button variant="outline" size="sm" disabled={isDownloadingReport} className="h-8">
                                    <Download className="h-4 w-4" />
                                    Download report
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-4" align="end">
                                <div className="space-y-4">
                                    <div className="text-sm font-medium">Filter by date range</div>
                                    <div className="grid gap-3">
                                        <div className="space-y-1.5">
                                            <Label className="text-xs">From</Label>
                                            <div className="flex gap-2">
                                                <Popover>
                                                    <PopoverTrigger asChild>
                                                        <Button variant="outline" size="sm" className="h-8 w-[140px] justify-start text-left font-normal">
                                                            <CalendarIcon className="h-4 w-4" />
                                                            {reportStartDate ? format(reportStartDate, 'MMM dd, yyyy') : 'Start date'}
                                                        </Button>
                                                    </PopoverTrigger>
                                                    <PopoverContent className="w-auto p-0" align="start">
                                                        <Calendar
                                                            mode="single"
                                                            selected={reportStartDate}
                                                            onSelect={setReportStartDate}
                                                            disabled={(date) => reportEndDate ? date > reportEndDate : false}
                                                        />
                                                    </PopoverContent>
                                                </Popover>
                                                <Input
                                                    type="time"
                                                    value={reportStartTime}
                                                    onChange={(e) => setReportStartTime(e.target.value)}
                                                    className="h-8 w-[100px] text-xs"
                                                />
                                            </div>
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label className="text-xs">To</Label>
                                            <div className="flex gap-2">
                                                <Popover>
                                                    <PopoverTrigger asChild>
                                                        <Button variant="outline" size="sm" className="h-8 w-[140px] justify-start text-left font-normal">
                                                            <CalendarIcon className="h-4 w-4" />
                                                            {reportEndDate ? format(reportEndDate, 'MMM dd, yyyy') : 'End date'}
                                                        </Button>
                                                    </PopoverTrigger>
                                                    <PopoverContent className="w-auto p-0" align="start">
                                                        <Calendar
                                                            mode="single"
                                                            selected={reportEndDate}
                                                            onSelect={setReportEndDate}
                                                            disabled={(date) => reportStartDate ? date < reportStartDate : false}
                                                        />
                                                    </PopoverContent>
                                                </Popover>
                                                <Input
                                                    type="time"
                                                    value={reportEndTime}
                                                    onChange={(e) => setReportEndTime(e.target.value)}
                                                    className="h-8 w-[100px] text-xs"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                    <Separator />
                                    <div className="flex justify-between">
                                        <Button variant="ghost" size="sm" onClick={handleClearDateRange}>
                                            Clear
                                        </Button>
                                        <Button size="sm" onClick={handleDownloadReport} disabled={isDownloadingReport}>
                                            <Download className="h-4 w-4" />
                                            {reportStartDate || reportEndDate ? 'Download filtered' : 'Download all'}
                                        </Button>
                                    </div>
                                </div>
                            </PopoverContent>
                        </Popover>
                        {renderPrimaryAction()}
                    </div>
                }
            />

            <CampaignSummaryCard
                campaign={campaign}
                actions={
                    <>
                        <RowActionsMenu label="More campaign actions" busy={isRefreshing}>
                            <RowAction icon={<RefreshCw />} onClick={() => void handleRefresh()} disabled={isRefreshing}>
                                {isRefreshing ? 'Refreshing' : 'Refresh'}
                            </RowAction>
                            <RowActionSeparator />
                            {canEdit && (
                                <RowAction icon={<Pencil />} href={`/campaigns/${campaignId}/edit`}>Edit campaign</RowAction>
                            )}
                            {canEdit && <RowActionSeparator />}
                            <RowAction icon={<Trash2 />} onClick={() => setIsDeleteDialogOpen(true)} destructive>
                                Delete campaign
                            </RowAction>
                        </RowActionsMenu>
                    </>
                }
                activeTab={shownTab}
                tabs={visibleTabs}
                onTabChange={handleTabChange}
                onOpenWorkflow={handleWorkflowClick}
            />

            {shownTab === 'overview' && (
            <div className="grid gap-4 lg:grid-cols-3 lg:items-start">
                <div className="min-w-0 space-y-4 lg:col-span-2">
                    <CampaignCallTargetsCard
                        callTargets={callTargets}
                        isLoading={isLoadingCallTargets}
                        canEdit={canEditCallTargets}
                        onAdd={() => openTargetDialog()}
                        onEdit={(target) => openTargetDialog(target)}
                        onDelete={(target) => void deleteTarget(target)}
                        onPageChange={setCallTargetsPage}
                    />
                    <CampaignActivityLog campaign={campaign} />
                </div>
                <div className="min-w-0 space-y-4">
                    <CampaignOverviewSidebar
                        campaign={campaign}
                        onDownloadCsv={() => void handleDownloadCsv()}
                        onOpenTelephony={(id) => router.push(`/telephony-configurations/${id}`)}
                        onOpenCampaign={(id) => router.push(`/campaigns/${id}`)}
                    />
                </div>
            </div>
            )}

            {shownTab === 'analytics' && (
                <CampaignAnalytics
                    key={`analytics-${refreshKey}`}
                    campaignId={campaignId}
                    workflowId={campaign.workflow_id}
                    dialedCount={campaign.executed_count ?? 0}
                    queuedCount={campaign.total_queued_count ?? 0}
                />
            )}

            {shownTab === 'runs' && (
                <CampaignRuns
                    key={`runs-${refreshKey}`}
                    campaignId={campaignId}
                    workflowId={campaign.workflow_id}
                    searchParams={searchParams}
                />
            )}

            {/* Report: same layout as the conversation page — viewer left, details right. */}
            {shownTab === 'report' && (
                <div className="grid gap-4 lg:grid-cols-3 lg:items-stretch">
                    <div
                        className="min-w-0 lg:col-span-2 flex flex-col h-full"
                        style={isDesktop && sidebarHeight && sidebarHeight > 200 ? { height: `${sidebarHeight}px` } : undefined}
                    >
                        {hasGeneratedReport || isGeneratingReport ? (
                            <InlineReportViewer
                                key={`report-${refreshKey}`}
                                source={{ kind: 'campaign', campaignId }}
                                title="Campaign Report"
                                subtitle="Summary report across every call in this campaign"
                                agentName={campaign.name}
                                reportS3Key={typeof orchestratorMeta?.report_s3_key === 'string' ? orchestratorMeta.report_s3_key : null}
                                reportVariables={(orchestratorMeta?.report_variables_values as Record<string, unknown> | undefined) ?? null}
                                onRegenerate={handleGenerateCampaignReport}
                                isRegenerating={isGeneratingReport}
                                style={isDesktop && sidebarHeight && sidebarHeight > 200 ? { height: `${sidebarHeight}px` } : undefined}
                                className="h-full min-h-0 flex-1"
                            />
                        ) : (
                            <DetailPanel
                                title="Campaign Report"
                                description="Summary report across every call in this campaign"
                                style={isDesktop && sidebarHeight && sidebarHeight > 200 ? { height: `${sidebarHeight}px` } : undefined}
                                className="h-full min-h-0 flex-1"
                            >
                                <div className="flex flex-col items-center justify-center flex-1 gap-3 py-10 text-center h-full">
                                    <FileText className="h-6 w-6 text-muted-foreground" />
                                    <p className="max-w-sm text-xs text-muted-foreground">
                                        No report yet. Generate it from this campaign&apos;s calls using its report template.
                                    </p>
                                    <Button size="sm" className="h-8" onClick={handleGenerateCampaignReport} disabled={isGeneratingReport}>
                                        <RefreshCw className="h-4 w-4" />
                                        Generate report
                                    </Button>
                                </div>
                            </DetailPanel>
                        )}
                    </div>
                    <div ref={handleRightSidebarRef} className="min-w-0">
                        <CampaignOverviewSidebar
                            campaign={campaign}
                            onDownloadCsv={() => void handleDownloadCsv()}
                            onOpenTelephony={(id) => router.push(`/telephony-configurations/${id}`)}
                            onOpenCampaign={(id) => router.push(`/campaigns/${id}`)}
                        />
                    </div>
                </div>
            )}

            <Dialog open={isTargetDialogOpen} onOpenChange={setIsTargetDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{editingTarget ? 'Edit Phone Number' : 'Add Phone Number'}</DialogTitle>
                        <DialogDescription>
                            Configure the recipient number and optional context variables used in the prompt.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-1.5">
                            <Label htmlFor="target-phone">Phone Number</Label>
                            <Input
                                id="target-phone"
                                value={targetPhoneNumber}
                                onChange={(e) => setTargetPhoneNumber(e.target.value)}
                                placeholder="+15551234567"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="target-context">Context Variables (JSON object)</Label>
                            <Textarea
                                id="target-context"
                                value={targetContext}
                                onChange={(e) => setTargetContext(e.target.value)}
                                rows={6}
                                className="font-mono text-xs"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsTargetDialogOpen(false)} disabled={isSavingTarget}>
                            Cancel
                        </Button>
                        <Button onClick={saveTarget} disabled={isSavingTarget}>
                            {isSavingTarget ? 'Saving...' : editingTarget ? 'Update Number' : 'Add Number'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={isRedialDialogOpen} onOpenChange={setIsRedialDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Redial Campaign</DialogTitle>
                        <DialogDescription>
                            Creates a new campaign that re-dials unique subscribers whose
                            last call ended with one of the selected outcomes. Subscribers
                            who were successfully reached on a retry are skipped.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-1.5">
                            <Label htmlFor="redial-name">Name</Label>
                            <Input
                                id="redial-name"
                                value={redialName}
                                onChange={(e) => setRedialName(e.target.value)}
                                placeholder="Campaign name"
                            />
                        </div>
                        <div className="space-y-3">
                            <Label>Redial when last call was</Label>
                            <div className="flex items-center gap-2">
                                <Checkbox
                                    id="redial-voicemail"
                                    checked={redialOnVoicemail}
                                    onCheckedChange={(v) => setRedialOnVoicemail(v === true)}
                                />
                                <Label htmlFor="redial-voicemail" className="font-normal">
                                    Voicemail
                                </Label>
                            </div>
                            <div className="flex items-center gap-2">
                                <Checkbox
                                    id="redial-no-answer"
                                    checked={redialOnNoAnswer}
                                    onCheckedChange={(v) => setRedialOnNoAnswer(v === true)}
                                />
                                <Label htmlFor="redial-no-answer" className="font-normal">
                                    No Answer
                                </Label>
                            </div>
                            <div className="flex items-center gap-2">
                                <Checkbox
                                    id="redial-busy"
                                    checked={redialOnBusy}
                                    onCheckedChange={(v) => setRedialOnBusy(v === true)}
                                />
                                <Label htmlFor="redial-busy" className="font-normal">
                                    Busy
                                </Label>
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setIsRedialDialogOpen(false)}
                            disabled={isRedialing}
                        >
                            Cancel
                        </Button>
                        <Button onClick={handleRedial} disabled={isRedialing}>
                            {isRedialing ? 'Creating...' : 'Create Redial Campaign'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <AlertDialog
                open={isDeleteDialogOpen}
                onOpenChange={(open) => !open && !isDeleting && setIsDeleteDialogOpen(false)}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete &ldquo;{campaign.name}&rdquo;?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This permanently deletes the campaign and cancels all of its queued and scheduled calls. Calls already in progress are not interrupted.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            disabled={isDeleting}
                            onClick={(event) => {
                                event.preventDefault();
                                void handleDeleteCampaign();
                            }}
                            className="bg-destructive text-white hover:bg-destructive/90"
                        >
                            Delete campaign
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

        </div>
    );
}
