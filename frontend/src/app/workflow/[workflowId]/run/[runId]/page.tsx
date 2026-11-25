'use client';

import {
    Bot,
    Calendar,
    Check,
    Clock,
    Copy,
    Cpu,
    Download,
    Eye,
    Headphones,
    Loader2,
    MessageSquare,
    Pause,
    Pencil,
    Play,
    RefreshCw,
    UserRound,
    Video,
} from 'lucide-react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import posthog from 'posthog-js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import WorkflowLayout from '@/app/workflow/WorkflowLayout';
import {
    getCampaignApiV1CampaignCampaignIdGet,
    getModelConfigurationOptionsApiV1OrganizationsModelConfigurationOptionsGet,
    getWorkflowApiV1WorkflowFetchWorkflowIdGet,
    getWorkflowRunApiV1WorkflowWorkflowIdRunsRunIdGet,
} from '@/client/sdk.gen';
import { InlineReportViewer } from '@/components/InlineReportViewer';
import { MediaPreviewDialog } from '@/components/MediaPreviewDialog';
import { OnboardingTooltip } from '@/components/onboarding/OnboardingTooltip';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { UnderlineTabs } from '@/components/ui/underline-tabs';
import { RealtimeFeedback, WorkflowRunLogs } from '@/components/workflow/conversation';
import { ConversationCompleteness, ConversationCompletenessCard } from '@/components/workflow/ConversationCompleteness';
import { PostHogEvent } from '@/constants/posthog-events';
import { WORKFLOW_RUN_MODES } from '@/constants/workflowRunModes';
import { type Breadcrumb, PageHeader } from '@/context/HeaderContext';
import { useOnboarding } from '@/context/OnboardingContext';
import { useOrgConfig } from '@/context/OrgConfigContext';
import { accountHolderName } from '@/lib/accountHolder';
import { getBackendApiUrl, resolveArtifactUrl } from '@/lib/apiClient';
import { useAuth } from '@/lib/auth';
import { displayConversationTitle } from '@/lib/conversationDisplay';
import { downloadFile, getSignedUrl } from '@/lib/files';
import { readReturnTo } from '@/lib/returnTo';
import { cn } from '@/lib/utils';

import { AnalyticsSidebar, extractPresetName } from './components/AnalyticsSidebar';
import { ConversationAnalyticsTab } from './components/ConversationAnalyticsTab';
import { DashboardMetricsAndTurns, TurnMetricsCard } from './components/DashboardMetricsAndTurns';
import { MediaRecordingPlayer } from './components/MediaRecordingPlayer';
import { SessionOverviewSidebar } from './components/SessionOverviewSidebar';
import type { WorkflowRunResponse } from './components/types';

const RUN_SHELL_HEIGHT_CLASS = "h-full min-h-0 flex-1";
const WAVEFORM_BAR_COUNT = 96;

type RunTab = 'analytics' | 'dashboard' | 'transcript' | 'recording' | 'report';


function formatDurationTimestamp(seconds?: number | null) {
    if (seconds == null || Number.isNaN(seconds) || seconds <= 0) return '0:00';
    const totalSecs = Math.round(seconds);
    const hours = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    if (hours > 0) {
        return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatRunDateShort(dateString?: string | null) {
    if (!dateString) return null;
    try {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return null;
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: '2-digit',
            year: 'numeric',
        });
    } catch {
        return null;
    }
}


function getTranscriptMetrics(logs: WorkflowRunLogs | null, gatheredContext: Record<string, string | number | boolean | object> | null) {
    const events = logs?.realtime_feedback_events ?? [];
    const userTurns = events.filter((event) => event.type === 'rtf-user-transcription' && event.payload.final).length;
    const botTurns = events.filter((event) => event.type === 'rtf-bot-text').length;
    const toolCalls = events.filter((event) => event.type === 'rtf-function-call-end').length;
    const nodeNames = new Set(
        events
            .map((event) => event.payload.node_name)
            .filter((nodeName): nodeName is string => Boolean(nodeName))
    );
    const visitedNodes = Array.isArray(gatheredContext?.nodes_visited)
        ? gatheredContext.nodes_visited.length
        : nodeNames.size;

    return { userTurns, botTurns, toolCalls, visitedNodes };
}


function buildWaveformPeaks(audioBuffer: AudioBuffer) {
    const channel = audioBuffer.getChannelData(0);
    const samplesPerBar = Math.max(1, Math.floor(channel.length / WAVEFORM_BAR_COUNT));

    return Array.from({ length: WAVEFORM_BAR_COUNT }, (_, index) => {
        const start = index * samplesPerBar;
        const end = Math.min(start + samplesPerBar, channel.length);
        let sum = 0;

        for (let i = start; i < end; i += 1) {
            sum += channel[i] * channel[i];
        }

        const rms = Math.sqrt(sum / Math.max(1, end - start));
        return Math.max(0.08, Math.min(1, rms * 5));
    });
}

async function loadWaveformPeaks(url: string) {
    const response = await fetch(url);
    const audioData = await response.arrayBuffer();
    const AudioContextConstructor =
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;

    if (!AudioContextConstructor) return null;

    const audioContext = new AudioContextConstructor();
    try {
        const decoded = await audioContext.decodeAudioData(audioData);
        return buildWaveformPeaks(decoded);
    } finally {
        void audioContext.close();
    }
}

function WaveformLane({
    peaks,
    track,
    position,
}: {
    peaks: number[] | null;
    track: 'user' | 'bot';
    position: 'top' | 'bottom';
}) {
    return (
        <div
            className={cn(
                'absolute left-3 right-3 flex gap-0.5',
                position === 'top' ? 'top-5 h-12 items-end' : 'bottom-5 h-12 items-start'
            )}
        >
            {peaks ? (
                peaks.map((peak, index) => (
                    <span
                        key={`${track}-${index}`}
                        className={cn(
                            'min-h-1 flex-1 rounded-full opacity-85',
                            track === 'user' ? 'bg-sky-500' : 'bg-emerald-500'
                        )}
                        style={{ height: `${Math.round(peak * 100)}%` }}
                    />
                ))
            ) : (
                <div className="my-auto h-px w-full bg-border" />
            )}
        </div>
    );
}

function VideoRecordingSection({ videoUrl }: { videoUrl: string }) {
    const [playableUrl, setPlayableUrl] = useState<string | null>(
        videoUrl.startsWith('http://') || videoUrl.startsWith('https://') ? videoUrl : null
    );
    const [isLoading, setIsLoading] = useState(
        !videoUrl.startsWith('http://') && !videoUrl.startsWith('https://')
    );

    useEffect(() => {
        let isMounted = true;
        if (!videoUrl) return;

        if (videoUrl.startsWith('http://') || videoUrl.startsWith('https://')) {
            setPlayableUrl(videoUrl);
            setIsLoading(false);
            return;
        }

        setIsLoading(true);
        void getSignedUrl(videoUrl, true).then((url) => {
            if (isMounted) {
                setPlayableUrl(url);
                setIsLoading(false);
            }
        });

        return () => {
            isMounted = false;
        };
    }, [videoUrl]);

    return (
        <Card className="border-border shadow-sm">
            <CardHeader className="p-4 sm:p-5 pb-3">
                <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-semibold flex items-center gap-2">
                        <Video className="h-4 w-4 text-primary" />
                        Video Recording
                    </CardTitle>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => downloadFile(videoUrl)}
                        className="gap-2"
                    >
                        <Download className="h-4 w-4" />
                        Download Video
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="p-4 sm:p-5 pt-0">
                <div className="overflow-hidden rounded-lg border border-border/70 bg-black aspect-video max-w-2xl mx-auto flex items-center justify-center">
                    {isLoading ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Loading video...
                        </div>
                    ) : playableUrl ? (
                        <video
                            src={playableUrl}
                            controls
                            className="w-full h-full object-contain"
                            preload="metadata"
                        />
                    ) : (
                        <span className="text-sm text-muted-foreground">Video recording unavailable</span>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}

function SplitTracksSection({
    userRecordingUrl,
    botRecordingUrl,
}: {
    userRecordingUrl: string;
    botRecordingUrl: string;
}) {
    const userAudioRef = useRef<HTMLAudioElement | null>(null);
    const botAudioRef = useRef<HTMLAudioElement | null>(null);
    const [signedUrls, setSignedUrls] = useState<{ user: string | null; bot: string | null }>({
        user: null,
        bot: null,
    });
    const [peaks, setPeaks] = useState<{ user: number[] | null; bot: number[] | null }>({
        user: null,
        bot: null,
    });
    const [isLoading, setIsLoading] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [progress, setProgress] = useState(0);

    useEffect(() => {
        let isActive = true;
        const userAudio = userAudioRef.current;
        const botAudio = botAudioRef.current;

        userAudio?.pause();
        botAudio?.pause();
        setSignedUrls({ user: null, bot: null });
        setPeaks({ user: null, bot: null });
        setIsPlaying(false);
        setProgress(0);
        setIsLoading(true);

        async function loadTracks() {
            try {
                const [userUrl, botUrl] = await Promise.all([
                    getSignedUrl(userRecordingUrl, true),
                    getSignedUrl(botRecordingUrl, true),
                ]);
                if (!isActive) return;

                setSignedUrls({ user: userUrl, bot: botUrl });
                if (!userUrl || !botUrl) return;

                const [userPeaks, botPeaks] = await Promise.all([
                    loadWaveformPeaks(userUrl),
                    loadWaveformPeaks(botUrl),
                ]);

                if (isActive) {
                    setPeaks({ user: userPeaks, bot: botPeaks });
                }
            } catch (error) {
                console.error('Error loading split track waveforms:', error);
            } finally {
                if (isActive) {
                    setIsLoading(false);
                }
            }
        }

        void loadTracks();

        return () => {
            isActive = false;
            userAudio?.pause();
            botAudio?.pause();
        };
    }, [userRecordingUrl, botRecordingUrl]);

    useEffect(() => {
        if (!isPlaying) return;

        let frameId: number;
        const updateProgress = () => {
            const userAudio = userAudioRef.current;
            const botAudio = botAudioRef.current;
            const userDuration = Number.isFinite(userAudio?.duration) ? userAudio?.duration ?? 0 : 0;
            const botDuration = Number.isFinite(botAudio?.duration) ? botAudio?.duration ?? 0 : 0;
            const duration = Math.max(userDuration, botDuration);
            const currentTime = Math.max(userAudio?.currentTime ?? 0, botAudio?.currentTime ?? 0);

            setProgress(duration > 0 ? Math.min(1, currentTime / duration) : 0);
            frameId = window.requestAnimationFrame(updateProgress);
        };

        frameId = window.requestAnimationFrame(updateProgress);
        return () => window.cancelAnimationFrame(frameId);
    }, [isPlaying]);

    const pauseTracks = () => {
        userAudioRef.current?.pause();
        botAudioRef.current?.pause();
        setIsPlaying(false);
    };

    const handleTrackEnded = () => {
        const userAudio = userAudioRef.current;
        const botAudio = botAudioRef.current;
        const userDone = !userAudio || userAudio.ended;
        const botDone = !botAudio || botAudio.ended;

        if (userDone && botDone) {
            setIsPlaying(false);
            setProgress(1);
        }
    };

    const togglePlayback = async () => {
        const userAudio = userAudioRef.current;
        const botAudio = botAudioRef.current;
        if (!userAudio || !botAudio || !signedUrls.user || !signedUrls.bot) return;

        if (isPlaying) {
            pauseTracks();
            return;
        }

        const userDuration = Number.isFinite(userAudio.duration) ? userAudio.duration : 0;
        const botDuration = Number.isFinite(botAudio.duration) ? botAudio.duration : 0;
        const duration = Math.max(userDuration, botDuration);
        const currentTime = Math.max(userAudio.currentTime, botAudio.currentTime);
        const startTime = duration > 0 && currentTime >= duration - 0.1 ? 0 : currentTime;

        userAudio.currentTime = Math.min(startTime, userDuration || startTime);
        botAudio.currentTime = Math.min(startTime, botDuration || startTime);

        try {
            await Promise.all([userAudio.play(), botAudio.play()]);
            setIsPlaying(true);
        } catch (error) {
            pauseTracks();
            console.error('Error playing split tracks:', error);
        }
    };

    const canPlay = Boolean(signedUrls.user && signedUrls.bot);
    const progressPercent = Math.round(progress * 1000) / 10;

    return (
        <Card className="border-border/70 bg-card/60 backdrop-blur-sm shadow-sm overflow-hidden">
            <audio
                ref={userAudioRef}
                src={signedUrls.user ?? undefined}
                preload="metadata"
                className="hidden"
                onEnded={handleTrackEnded}
            />
            <audio
                ref={botAudioRef}
                src={signedUrls.bot ?? undefined}
                preload="metadata"
                className="hidden"
                onEnded={handleTrackEnded}
            />
            <CardHeader className="p-4 pb-3 border-b border-border/40">
                <div className="flex items-center gap-2">
                    <Headphones className="h-3.5 w-3.5 text-sky-400" />
                    <CardTitle className="text-xs font-bold uppercase tracking-wider text-foreground">
                        Split Tracks
                    </CardTitle>
                </div>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-sky-600">
                            <UserRound className="h-4 w-4" />
                            User
                        </span>
                        <span className="h-4 w-px bg-border" />
                        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-600">
                            <Bot className="h-4 w-4" />
                            Bot
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => downloadFile(userRecordingUrl)}
                            className="gap-2"
                        >
                            <Download className="h-4 w-4" />
                            User
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => downloadFile(botRecordingUrl)}
                            className="gap-2"
                        >
                            <Download className="h-4 w-4" />
                            Bot
                        </Button>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    <Button
                        type="button"
                        size="icon"
                        variant={isPlaying ? 'default' : 'outline'}
                        onClick={togglePlayback}
                        disabled={!canPlay}
                        aria-label={isPlaying ? 'Pause split tracks' : 'Play split tracks'}
                        className="h-10 w-10 shrink-0"
                    >
                        {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    </Button>
                    <div className="relative h-36 min-w-0 flex-1 overflow-hidden rounded-lg border border-border/70 bg-background">
                        <div className="absolute left-3 right-3 top-1/2 h-px bg-border/80" />
                        <WaveformLane peaks={peaks.user} track="user" position="top" />
                        <WaveformLane peaks={peaks.bot} track="bot" position="bottom" />
                        {canPlay && (
                            <div className="pointer-events-none absolute inset-x-3 inset-y-3">
                                <div
                                    className="absolute top-0 bottom-0 w-px bg-foreground/50"
                                    style={{ left: `${progressPercent}%` }}
                                />
                            </div>
                        )}
                        {isLoading && (
                            <div className="absolute inset-0 flex items-center justify-center bg-background/70 text-xs text-muted-foreground">
                                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                                Loading
                            </div>
                        )}
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}


function ContextDisplay({
    title,
    subtitle,
    context,
    className,
}: {
    title: string;
    subtitle?: string;
    context: Record<string, string | number | boolean | object> | null;
    className?: string;
}) {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        if (!context) return;
        navigator.clipboard.writeText(JSON.stringify(context, null, 2));
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    if (!context || Object.keys(context).length === 0) {
        return (
            <Card className={cn("border-border overflow-hidden shadow-sm bg-card/60 backdrop-blur-sm", className)}>
                <CardHeader className="px-4 py-3 border-b border-border shrink-0">
                    <div className="leading-snug">
                        <CardTitle className="text-sm font-bold uppercase tracking-wide text-foreground">{title}</CardTitle>
                        {subtitle && <p className="text-xs text-muted-foreground mt-1 font-medium">{subtitle}</p>}
                    </div>
                </CardHeader>
                <CardContent className="p-4">
                    <p className="text-sm text-muted-foreground">No data available</p>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className={cn("border-border overflow-hidden shadow-sm bg-card/60 backdrop-blur-sm", className)}>
            <CardHeader className="flex flex-row items-center justify-between px-4 py-3 border-b border-border shrink-0">
                <div className="leading-snug">
                    <CardTitle className="text-sm font-bold uppercase tracking-wide text-foreground">{title}</CardTitle>
                    {subtitle && <p className="text-xs text-muted-foreground mt-1 font-medium">{subtitle}</p>}
                </div>
                <Button variant="ghost" size="sm" onClick={handleCopy} className="gap-1 h-7 text-xs px-2.5">
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied ? 'Copied' : 'Copy'}
                </Button>
            </CardHeader>
            <CardContent className="p-4">
                <pre className="text-xs sm:text-sm font-mono bg-muted border border-border p-3.5 rounded-lg overflow-auto max-h-80 text-foreground/90 leading-relaxed">
                    {JSON.stringify(context, null, 2)}
                </pre>
            </CardContent>
        </Card>
    );
}


export default function WorkflowRunPage() {
    const params = useParams();
    const searchParams = useSearchParams();
    const [isLoading, setIsLoading] = useState(true);
    const auth = useAuth();
    const { modelPricingRules } = useOrgConfig();
    const [workflowRun, setWorkflowRun] = useState<WorkflowRunResponse | null>(null);
    const [activeTab, setActiveTab] = useState<RunTab>('dashboard');
    const [isRegeneratingReport, setIsRegeneratingReport] = useState(false);
    const [isEvaluatingCompleteness, setIsEvaluatingCompleteness] = useState(false);
    const { hasSeenTooltip, markTooltipSeen } = useOnboarding();
    const customizeButtonRef = useRef<HTMLButtonElement>(null);

    // Redirect if not authenticated
    useEffect(() => {
        if (!auth.loading && !auth.isAuthenticated) {
            auth.redirectToLogin();
        }
    }, [auth]);

    const { openPreview, dialog } = MediaPreviewDialog();
    const [workflowName, setWorkflowName] = useState<string | null>(null);
    const [hasReportTemplate, setHasReportTemplate] = useState<boolean>(false);
    const [maxCallDuration, setMaxCallDuration] = useState<number>(600);
    const [totalWorkflowNodes, setTotalWorkflowNodes] = useState<number>(0);

    const rawWorkflowId = params?.workflowId;
    const workflowIdParam = Array.isArray(rawWorkflowId) ? rawWorkflowId[0] : (rawWorkflowId || "0");
    const rawRunId = params?.runId;
    const runIdParam = Array.isArray(rawRunId) ? rawRunId[0] : (rawRunId || "0");

    const loadWorkflowRun = useCallback(async (showFullLoading = true) => {
        if (!auth.isAuthenticated || auth.loading) return;

        if (showFullLoading) setIsLoading(true);
        try {
            const workflowId = workflowIdParam;
            const runId = runIdParam;
            const response = await getWorkflowRunApiV1WorkflowWorkflowIdRunsRunIdGet({
                path: {
                    workflow_id: Number(workflowId),
                    run_id: Number(runId),
                },
            });
            if (response.error || !response.data) {
                setIsLoading(false);
                return;
            }
            const payload = response.data as unknown as Partial<WorkflowRunResponse>;
            const runData = {
                workflow_id: response.data?.workflow_id,
                name: response.data?.name ?? null,
                conversation_title: response.data?.conversation_title ?? null,
                workflow_name: (response.data as { workflow_name?: string })?.workflow_name ?? null,
                mode: response.data?.mode ?? '',
                call_type: response.data?.call_type ?? null,
                is_completed: response.data?.is_completed ?? false,
                created_at: response.data?.created_at ?? null,
                transcript_url: response.data?.transcript_url ?? null,
                recording_url: response.data?.recording_url ?? null,
                video_recording_url: (response.data as { video_recording_url?: string | null })?.video_recording_url ?? null,
                video_recording_public_url: (response.data as { video_recording_public_url?: string | null })?.video_recording_public_url ?? null,
                user_recording_url: response.data?.user_recording_url ?? null,
                bot_recording_url: response.data?.bot_recording_url ?? null,
                cost_info: response.data?.cost_info ?? null,
                usage_info: payload.usage_info ?? null,
                initial_context: response.data?.initial_context as Record<string, string> | null ?? null,
                gathered_context: response.data?.gathered_context as Record<string, string> | null ?? null,
                logs: payload.logs ?? null,
                annotations: payload.annotations ?? null,
                report_s3_key: response.data?.report_s3_key ?? null,
                report_generation_status: response.data?.report_generation_status ?? null,
                has_report_template: (response.data as { has_report_template?: boolean })?.has_report_template ?? false,
                completeness: payload.completeness ?? null,
            };
            setWorkflowRun(runData);

            const effectiveWorkflowId = response.data?.workflow_id || Number(workflowId);
            try {
                const token = await auth.getAccessToken();
                const usageResponse = await fetch(
                    `${getBackendApiUrl()}/api/v1/workflow/${effectiveWorkflowId}/runs/${runId}/usage`,
                    { headers: { Authorization: `Bearer ${token}` } },
                );
                if (usageResponse.ok) {
                    const canonicalUsage = await usageResponse.json();
                    setWorkflowRun((current) => current ? { ...current, canonical_usage: canonicalUsage } : current);
                }
            } catch {
                // Legacy usage_info remains available if canonical usage is unavailable.
            }

            const targetWfId = Number(workflowIdParam || response.data?.workflow_id || 0);
            if (targetWfId > 0) {
                try {
                    const wfRes = await getWorkflowApiV1WorkflowFetchWorkflowIdGet({
                        path: { workflow_id: targetWfId },
                    });
                    if (wfRes.data?.name) {
                        setWorkflowName(wfRes.data.name);
                    }
                    const workflowUuid = wfRes.data?.workflow_uuid;
                    if (workflowUuid) {
                        setWorkflowRun((current) => current ? { ...current, workflow_uuid: workflowUuid } : current);
                    }
                    const wfDef = wfRes.data?.workflow_definition as { nodes?: unknown[] } | undefined;
                    if (Array.isArray(wfDef?.nodes)) {
                        setTotalWorkflowNodes(wfDef.nodes.length);
                    }
                    const wfConfigs = wfRes.data?.workflow_configurations as { report_template?: string; max_call_duration?: number } | undefined;
                    if (wfConfigs?.report_template) {
                        setHasReportTemplate(true);
                    }
                    if (wfConfigs?.max_call_duration && wfConfigs.max_call_duration > 0) {
                        setMaxCallDuration(wfConfigs.max_call_duration);
                    }
                } catch {
                    // Ignore workflow fetch fallback
                }
            }

            posthog.capture(PostHogEvent.WORKFLOW_RUN_DETAILS_VIEWED, {
                workflow_id: Number(workflowId),
                run_id: Number(runId),
                is_completed: runData.is_completed,
                has_recording: !!runData.recording_url,
                has_split_recordings: !!runData.user_recording_url && !!runData.bot_recording_url,
                has_transcript: !!runData.transcript_url,
            });
        } finally {
            if (showFullLoading) setIsLoading(false);
        }
    }, [auth, workflowIdParam, runIdParam]);

    useEffect(() => {
        void loadWorkflowRun();
    }, [loadWorkflowRun]);

    useEffect(() => {
        const reportStatus = workflowRun?.report_generation_status;
        if (!auth.isAuthenticated || (reportStatus !== 'pending' && reportStatus !== 'processing')) return;

        let isActive = true;
        const refreshReportStatus = async () => {
            try {
                const response = await getWorkflowRunApiV1WorkflowWorkflowIdRunsRunIdGet({
                    path: {
                        workflow_id: Number(workflowIdParam),
                        run_id: Number(runIdParam),
                    },
                });
                if (!isActive || !response.data) return;

                setWorkflowRun((current) => current ? {
                    ...current,
                    report_s3_key: response.data.report_s3_key ?? null,
                    report_generation_status: response.data.report_generation_status ?? null,
                    has_report_template: (response.data as { has_report_template?: boolean })?.has_report_template ?? current.has_report_template,
                    workflow_name: (response.data as { workflow_name?: string })?.workflow_name ?? current.workflow_name,
                } : current);
            } catch (error) {
                console.error('Failed to refresh report status:', error);
            }
        };

        void refreshReportStatus();
        const intervalId = window.setInterval(() => void refreshReportStatus(), 5000);
        return () => {
            isActive = false;
            window.clearInterval(intervalId);
        };
    }, [auth.isAuthenticated, runIdParam, workflowIdParam, workflowRun?.report_generation_status]);

    // Live usage polling: while the call is still in progress, refetch
    // cost/usage every 5s so the Run Metrics Duration + Token Usage tick in
    // near-real-time (backend flushes usage_info every 15s mid-call).
    // Stops automatically once the run completes. Poll failures are ignored.
    useEffect(() => {
        if (!auth.isAuthenticated) return;
        const reportProcessing = workflowRun?.report_generation_status === 'processing' || workflowRun?.report_generation_status === 'pending';
        if (workflowRun?.is_completed && !reportProcessing) return;
        if (workflowRun?.mode === WORKFLOW_RUN_MODES.TEXTCHAT && !reportProcessing) return;

        let isActive = true;
        const refreshLiveUsage = async () => {
            try {
                const response = await getWorkflowRunApiV1WorkflowWorkflowIdRunsRunIdGet({
                    path: {
                        workflow_id: Number(workflowIdParam),
                        run_id: Number(runIdParam),
                    },
                });
                if (!isActive || !response.data) return;

                // The generated client omits usage_info/logs/annotations/completeness
                // from this response type; cast once instead of per field.
                const payload = response.data as unknown as Partial<WorkflowRunResponse>;

                setWorkflowRun((current) => current ? {
                    ...current,
                    is_completed: response.data.is_completed ?? current.is_completed,
                    cost_info: (response.data.cost_info as WorkflowRunResponse['cost_info']) ?? current.cost_info,
                    usage_info: payload.usage_info ?? current.usage_info,
                    logs: payload.logs ?? current.logs,
                    report_generation_status: response.data.report_generation_status ?? current.report_generation_status,
                    report_s3_key: response.data.report_s3_key ?? current.report_s3_key,
                    completeness: payload.completeness ?? current.completeness,
                    annotations: payload.annotations ?? current.annotations,
                } : current);

                const pollWfId = response.data?.workflow_id || Number(workflowIdParam);
                try {
                    const token = await auth.getAccessToken();
                    const usageResponse = await fetch(
                        `${getBackendApiUrl()}/api/v1/workflow/${pollWfId}/runs/${runIdParam}/usage`,
                        { headers: { Authorization: `Bearer ${token}` } },
                    );
                    if (usageResponse.ok) {
                        const canonicalUsage = await usageResponse.json();
                        setWorkflowRun((current) => current ? { ...current, canonical_usage: canonicalUsage } : current);
                    }
                } catch {
                    // Legacy usage_info remains the fallback during polling failures.
                }
            } catch {
                // Transient poll failure — next tick retries.
            }
        };

        const intervalId = window.setInterval(() => void refreshLiveUsage(), 5000);
        return () => {
            isActive = false;
            window.clearInterval(intervalId);
        };
    }, [auth, runIdParam, workflowIdParam, workflowRun?.is_completed, workflowRun?.mode, workflowRun?.report_generation_status]);

    let returnValue = null;
    const isTextChatRun = workflowRun?.mode === WORKFLOW_RUN_MODES.TEXTCHAT;
    const showRunDetailsView = Boolean(workflowRun?.is_completed || isTextChatRun);
    const userSplitRecordingUrl = workflowRun?.user_recording_url ?? null;
    const botSplitRecordingUrl = workflowRun?.bot_recording_url ?? null;
    const hasSplitTracks = Boolean(userSplitRecordingUrl && botSplitRecordingUrl);
    const rawVideoUrl = typeof workflowRun?.video_recording_url === 'string'
        ? workflowRun.video_recording_url
        : typeof workflowRun?.video_recording_public_url === 'string'
            ? workflowRun.video_recording_public_url
            : null;
    const videoRecordingUrl = resolveArtifactUrl(rawVideoUrl);
    const targetWorkflowId = workflowRun?.workflow_id || (workflowIdParam !== "0" ? Number(workflowIdParam) : null) || 0;

    const transcriptMetrics = getTranscriptMetrics(workflowRun?.logs ?? null, workflowRun?.gathered_context ?? null);
    const agentName =
        workflowRun?.workflow_name ||
        workflowName ||
        (workflowRun?.initial_context?.agent_name as string) ||
        (workflowRun?.initial_context?.name as string) ||
        (workflowRun?.gathered_context?.agent_name as string) ||
        (targetWorkflowId ? `Voice Agent #${targetWorkflowId}` : 'Voice Agent');
    const showReportSection = Boolean(
        workflowRun?.report_s3_key ||
        workflowRun?.has_report_template ||
        hasReportTemplate ||
        (workflowRun?.report_generation_status && workflowRun.report_generation_status !== 'failed')
    );

    // A deep link (`?tab=report`, e.g. from the usage list) opens the Report tab once
    // the run payload is in, and only when this run actually has a report — otherwise
    // it falls back to the dashboard. Applied once so later tab choices stick.
    const reportDeepLinkApplied = useRef(false);
    useEffect(() => {
        if (reportDeepLinkApplied.current || workflowRun === null) return;
        if (searchParams.get('tab') !== 'report') return;
        reportDeepLinkApplied.current = true;
        setActiveTab(showReportSection ? 'report' : 'dashboard');
    }, [searchParams, workflowRun, showReportSection]);

    const totalMessagesCount = transcriptMetrics.userTurns + transcriptMetrics.botTurns;
    const formattedDateShort = formatRunDateShort(workflowRun?.created_at);

    const initialPresetName = useMemo(() => extractPresetName(workflowRun), [workflowRun]);
    const [modelStackName, setModelStackName] = useState<string | null>(initialPresetName);

    useEffect(() => {
        const direct = extractPresetName(workflowRun);
        if (direct) {
            setModelStackName(direct);
            return;
        }

        let isActive = true;
        getModelConfigurationOptionsApiV1OrganizationsModelConfigurationOptionsGet()
            .then(async (res) => {
                if (!isActive || !res.data || res.data.length === 0) return;
                const options = res.data;

                const initCtx = workflowRun?.initial_context as Record<string, unknown> | undefined;
                const gathCtx = workflowRun?.gathered_context as Record<string, unknown> | undefined;
                const rtConf = (initCtx?.runtime_configuration || workflowRun?.runtime_configuration) as Record<string, unknown> | undefined;

                const runPresetId =
                    workflowRun?.platform_model_configuration_id ??
                    initCtx?.platform_model_configuration_id ??
                    rtConf?.platform_model_configuration_id ??
                    gathCtx?.platform_model_configuration_id;

                if (runPresetId != null) {
                    const match = options.find((p) => p.id === Number(runPresetId));
                    if (match?.name) {
                        setModelStackName(match.name);
                        return;
                    }
                }

                const targetWfId = workflowRun?.workflow_id;
                if (targetWfId) {
                    try {
                        const wfRes = await getWorkflowApiV1WorkflowFetchWorkflowIdGet({
                            path: { workflow_id: Number(targetWfId) },
                        });
                        if (!isActive) return;
                        const wfConfigs = (wfRes.data?.workflow_configurations ?? {}) as Record<string, unknown>;
                        const wfPresetId = wfConfigs.platform_model_configuration_id;
                        if (wfPresetId != null) {
                            const match = options.find((p) => p.id === Number(wfPresetId));
                            if (match?.name) {
                                setModelStackName(match.name);
                                return;
                            }
                        }
                    } catch {
                        // ignore
                    }
                }

                if (!isActive) return;
                const def = options.find((p) => (p as { is_default?: boolean }).is_default) || options[0];
                if (def?.name) {
                    setModelStackName(def.name);
                }
            })
            .catch(() => {});

        return () => {
            isActive = false;
        };
    }, [workflowRun]);

    const displayStackName =
        modelStackName ||
        ((workflowRun?.initial_context?.runtime_configuration || workflowRun?.runtime_configuration) as { llm_model?: string } | undefined)?.llm_model ||
        null;

    const conversationTitle =
        displayConversationTitle({
            conversation_title: workflowRun?.conversation_title ?? null,
            workflow_name: workflowRun?.workflow_name ?? workflowName,
            name: workflowRun?.name ?? null,
        }) || agentName;

    // The trail follows where the user came from (`?returnTo=` set by the list
    // they clicked in), so Back and every crumb lead back the way they came.
    const returnTo = readReturnTo(searchParams);

    // Opened from a campaign's Runs tab: name the campaign in the trail.
    const returnCampaignId = returnTo?.match(/^\/campaigns\/(\d+)(?=[/?]|$)/)?.[1] ?? null;
    const [returnCampaignName, setReturnCampaignName] = useState<string | null>(null);
    const { isAuthenticated, getAccessToken } = auth;
    useEffect(() => {
        if (!returnCampaignId || !isAuthenticated) return;
        let active = true;
        (async () => {
            const token = await getAccessToken();
            const response = await getCampaignApiV1CampaignCampaignIdGet({
                path: { campaign_id: Number(returnCampaignId) },
                headers: token ? { Authorization: `Bearer ${token}` } : undefined,
            }).catch(() => null);
            if (active && response?.data) setReturnCampaignName(response.data.name);
        })();
        return () => {
            active = false;
        };
    }, [returnCampaignId, isAuthenticated, getAccessToken]);

    const breadcrumbs = useMemo<Breadcrumb[]>(() => {
        const current = { label: conversationTitle || (runIdParam ? `Run #${runIdParam}` : 'Run Details') };
        if (returnCampaignId && returnTo) {
            // Campaigns › <campaign> › Campaign Runs › <conversation>; it returns to the same tab, page and filters.
            return [
                { label: 'Campaigns', href: '/campaigns' },
                { label: returnCampaignName ?? `Campaign #${returnCampaignId}`, href: `/campaigns/${returnCampaignId}` },
                { label: 'Campaign Runs', href: returnTo },
                current,
            ];
        }
        const fromConversationsList = returnTo !== null && /^\/(voice\/conversations|usage)(?=[/?]|$)/.test(returnTo);
        if (fromConversationsList) {
            return [{ label: 'Voice conversations', href: returnTo }, current];
        }
        const agentConversations = targetWorkflowId
            ? `/voice/agents/${targetWorkflowId}/view?tab=conversations`
            : '/voice/conversations';
        return [
            { label: 'Voice agents', href: '/voice/agents' },
            ...(targetWorkflowId
                ? [{ label: agentName, href: `/voice/agents/${targetWorkflowId}/view` }]
                : []),
            { label: 'Conversations', href: returnTo ?? agentConversations },
            current,
        ];
    }, [agentName, targetWorkflowId, conversationTitle, runIdParam, returnTo, returnCampaignId, returnCampaignName]);

    const rightSidebarRef = useRef<HTMLDivElement>(null);
    const [sidebarHeight, setSidebarHeight] = useState<number | null>(null);
    const [isDesktop, setIsDesktop] = useState(true);

    useEffect(() => {
        const checkDesktop = () => {
            setIsDesktop(window.innerWidth >= 1024);
        };
        checkDesktop();
        window.addEventListener('resize', checkDesktop);
        return () => window.removeEventListener('resize', checkDesktop);
    }, []);

    useEffect(() => {
        const el = rightSidebarRef.current;
        if (!el) return;

        const updateHeight = () => {
            const h = el.offsetHeight;
            if (h > 0) {
                setSidebarHeight(h);
            }
        };

        updateHeight();

        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const h = Math.round(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height);
                if (h > 0) {
                    setSidebarHeight(h);
                }
            }
        });

        observer.observe(el);
        return () => observer.disconnect();
    }, [activeTab, workflowRun]);

    const handleRegenerateReport = async () => {
        if (!auth.isAuthenticated || isRegeneratingReport) return;

        setIsRegeneratingReport(true);
        try {
            const token = await auth.getAccessToken();
            const baseUrl = getBackendApiUrl();
            const response = await fetch(
                `${baseUrl}/api/v1/workflow/${targetWorkflowId}/runs/${runIdParam}/report/regenerate`,
                { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
            );
            if (!response.ok) {
                const body = await response.json().catch(() => null);
                throw new Error(body?.detail || 'Failed to queue report regeneration');
            }

            setWorkflowRun((current) => current ? {
                ...current,
                report_s3_key: null,
                report_generation_status: 'pending',
            } : current);
            toast.success('Report regeneration queued');
        } catch (error) {
            console.error('Failed to regenerate report:', error);
            toast.error(error instanceof Error ? error.message : 'Failed to queue report regeneration');
        } finally {
            setIsRegeneratingReport(false);
        }
    };

    // Refetch only this conversation's data (run, usage, report status,
    // completeness) in place — no full browser reload, no loading screen.
    const [isRefreshingRun, setIsRefreshingRun] = useState(false);
    const handleRefreshRun = async () => {
        if (isRefreshingRun) return;
        setIsRefreshingRun(true);
        try {
            await loadWorkflowRun(false);
        } catch (error) {
            console.error('Failed to refresh conversation:', error);
            toast.error('Failed to refresh conversation');
        } finally {
            setIsRefreshingRun(false);
        }
    };

    const handleEvaluateCompleteness = async () => {
        if (!auth.isAuthenticated || isEvaluatingCompleteness) return;

        setIsEvaluatingCompleteness(true);
        try {
            const token = await auth.getAccessToken();
            const baseUrl = getBackendApiUrl();
            const response = await fetch(
                `${baseUrl}/api/v1/workflow/${targetWorkflowId}/runs/${runIdParam}/completeness/evaluate`,
                { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
            );
            if (!response.ok) {
                const body = await response.json().catch(() => null);
                throw new Error(body?.detail || 'Failed to evaluate completeness');
            }
            const result = (await response.json()) as ConversationCompleteness;
            setWorkflowRun((current) => current ? {
                ...current,
                completeness: result,
                annotations: {
                    ...(current.annotations || {}),
                    completeness: result,
                },
            } : current);
            toast.success('Completeness evaluated');
            // Refetch usage so the new Completeness / Re-eval entry shows in the
            // Token Usage Breakdown without a page reload (polling is off for
            // completed runs).
            void loadWorkflowRun(false);
        } catch (error) {
            console.error('Failed to evaluate completeness:', error);
            toast.error(error instanceof Error ? error.message : 'Failed to evaluate completeness');
        } finally {
            setIsEvaluatingCompleteness(false);
        }
    };

    if (isLoading) {
        returnValue = (
            <div className="h-full flex items-center justify-center">
                <div className="w-full p-6">
                    <Card>
                        <CardHeader>
                            <Skeleton className="h-6 w-48" />
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <Skeleton className="h-4 w-full" />
                            <Skeleton className="h-4 w-3/4" />
                            <Skeleton className="h-4 w-1/2" />
                        </CardContent>
                        <CardFooter className="flex gap-4">
                            <Skeleton className="h-10 w-32" />
                            <Skeleton className="h-10 w-32" />
                        </CardFooter>
                    </Card>
                </div>
            </div>
        );
    }
    else if (showRunDetailsView) {
        const organizationName = accountHolderName(auth.user) ?? undefined;

        returnValue = (
            <div data-detail-page className={`flex ${RUN_SHELL_HEIGHT_CLASS} min-h-0 w-full overflow-hidden bg-background`}>
                <div className="min-w-0 flex-1 overflow-y-auto">
                    <div className="w-full space-y-4 p-4 pb-6 md:px-6">

                        {/* Top Header Card */}
                        <Card className="border-border shadow-sm overflow-hidden bg-card/60 backdrop-blur-sm">
                            <CardHeader className="p-4 sm:p-5 pb-0 space-y-3">
                                {/* Title & Subtitle */}
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <h1
                                            className="text-lg sm:text-xl font-bold font-sans tracking-tight text-foreground uppercase truncate leading-none"
                                            title={conversationTitle}
                                        >
                                            {conversationTitle}
                                        </h1>
                                    </div>

                                    <p className="text-xs text-muted-foreground leading-relaxed">
                                        {workflowRun?.workflow_name || agentName || 'AI-Powered Customer Support and Lead Qualification'}
                                    </p>
                                </div>

                                {/* Badges Row: Created Date | Duration | Messages Count | Stack */}
                                <div className="flex flex-wrap items-center gap-2.5 pt-0.5 text-xs text-muted-foreground">
                                    {formattedDateShort && (
                                        <span className="inline-flex items-center gap-1.5">
                                            <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                            <span>Created {formattedDateShort}</span>
                                        </span>
                                    )}
                                    <span className="text-muted-foreground/40 select-none" aria-hidden="true">|</span>
                                    <span className="inline-flex items-center gap-1.5">
                                        <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                        <span>Duration {formatDurationTimestamp(workflowRun?.cost_info?.call_duration_seconds)}</span>
                                    </span>
                                    <span className="text-muted-foreground/40 select-none" aria-hidden="true">|</span>
                                    <span className="inline-flex items-center gap-1.5">
                                        <MessageSquare className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                        <span>{totalMessagesCount} messages</span>
                                    </span>
                                    {displayStackName && (
                                        <>
                                            <span className="text-muted-foreground/40 select-none" aria-hidden="true">|</span>
                                            <span className="inline-flex items-center gap-1.5">
                                                <Cpu className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                                <span>Stack: {displayStackName}</span>
                                            </span>
                                        </>
                                    )}
                                </div>

                                {/* Tabs Navigation Row */}
                                <div className="flex items-center gap-6 pt-3 text-xs font-medium">
                                    <UnderlineTabs
                                        value={activeTab}
                                        onValueChange={(v) => setActiveTab(v as RunTab)}
                                        items={[
                                            { value: 'dashboard', label: 'Dashboard View' },
                                            { value: 'transcript', label: 'Transcript Only' },
                                            { value: 'recording', label: 'Media Recording' },
                                            { value: 'analytics', label: 'Analytics' },
                                            ...(showReportSection ? [{ value: 'report' as const, label: 'Report' }] : []),
                                        ]}
                                    />
                                </div>
                            </CardHeader>
                        </Card>

                        {/* ── Tab Content: Analytics ── */}
                        {activeTab === 'analytics' && (
                            <ConversationAnalyticsTab
                                workflowRun={workflowRun}
                                targetWorkflowId={targetWorkflowId}
                                runId={runIdParam}
                                organizationName={organizationName}
                                agentName={agentName}
                                modelPricingRules={modelPricingRules}
                                maxCallDuration={maxCallDuration}
                                totalWorkflowNodes={totalWorkflowNodes}
                            />
                        )}

                        {/* ── Tab Content: Transcript Only ── */}
                        {activeTab === 'transcript' && (
                            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
                                <div className="space-y-4 lg:col-span-8 flex flex-col">
                                    <Card
                                        style={isDesktop && sidebarHeight && sidebarHeight > 200 ? { height: `${sidebarHeight}px` } : undefined}
                                        className={cn(
                                            "border-border/70 bg-card/60 backdrop-blur-sm shadow-sm overflow-hidden flex flex-col",
                                            (!sidebarHeight || !isDesktop) && "min-h-[600px] h-full"
                                        )}
                                    >
                                        <RealtimeFeedback
                                            mode="historical"
                                            logs={workflowRun?.logs ?? null}
                                            transcriptUrl={workflowRun?.transcript_url ?? null}
                                            runId={runIdParam}
                                        />
                                    </Card>
                                </div>
                                <div ref={rightSidebarRef} className="space-y-4 lg:col-span-4">
                                    <SessionOverviewSidebar
                                        workflowRun={workflowRun}
                                        runId={runIdParam}
                                        organizationName={organizationName}
                                    />
                                </div>
                            </div>
                        )}

                        {/* ── Tab Content: Media Recording ── */}
                        {activeTab === 'recording' && (
                            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                                <div className="space-y-4 lg:col-span-8">
                                    <MediaRecordingPlayer
                                        recordingUrl={workflowRun?.recording_url ?? null}
                                        fallbackRecordingUrl={workflowRun?.user_recording_url ?? workflowRun?.bot_recording_url ?? null}
                                        transcriptUrl={workflowRun?.transcript_url ?? null}
                                        runId={Number(params.runId)}
                                        agentName={agentName}
                                        conversationTitle={conversationTitle}
                                        durationSeconds={workflowRun?.cost_info?.call_duration_seconds}
                                        traceUrl={workflowRun?.gathered_context?.trace_url ? String(workflowRun.gathered_context.trace_url) : null}
                                        onOpenPreview={openPreview}
                                        downloadFile={downloadFile}
                                        isAuthenticated={auth.isAuthenticated}
                                    />
                                    {videoRecordingUrl && (
                                        <VideoRecordingSection videoUrl={videoRecordingUrl} />
                                    )}

                                    <TurnMetricsCard workflowRun={workflowRun} />

                                    {!isTextChatRun && hasSplitTracks && (
                                        <SplitTracksSection
                                            userRecordingUrl={userSplitRecordingUrl as string}
                                            botRecordingUrl={botSplitRecordingUrl as string}
                                        />
                                    )}
                                </div>

                                <div className="space-y-4 lg:col-span-4">
                                    <SessionOverviewSidebar
                                        workflowRun={workflowRun}
                                        runId={runIdParam}
                                        organizationName={organizationName}
                                    />
                                </div>
                            </div>
                        )}

                        {/* ── Tab Content: Dashboard View ── */}
                        {activeTab === 'dashboard' && (
                            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                                {/* Left 8 cols: Run Metrics, Per-Node Performance, Turn Metrics, Completeness, Contexts */}
                                <div className="space-y-4 lg:col-span-8">
                                    <DashboardMetricsAndTurns
                                        workflowRun={workflowRun}
                                        onRefresh={loadWorkflowRun}
                                    />

                                    <ConversationCompletenessCard
                                        completeness={workflowRun?.completeness ?? null}
                                        onRetry={handleEvaluateCompleteness}
                                        retrying={isEvaluatingCompleteness}
                                        logs={workflowRun?.logs ?? null}
                                    />

                                    <div className="grid gap-6 md:grid-cols-2">
                                        <ContextDisplay
                                            title="Initial Context"
                                            subtitle="Session parameters and variables passed at start"
                                            context={workflowRun?.initial_context ?? null}
                                        />
                                        <ContextDisplay
                                            title="Gathered Context"
                                            subtitle="Extracted variables and values captured during session"
                                            context={workflowRun?.gathered_context ?? null}
                                        />
                                    </div>

                                    {workflowRun?.annotations && Object.keys(workflowRun.annotations).length > 0 && (
                                        <ContextDisplay
                                            title="QA Results"
                                            subtitle="Quality assurance annotations and evaluation flags"
                                            context={workflowRun.annotations as Record<string, string | number | boolean | object>}
                                        />
                                    )}
                                </div>

                                {/* Right 4 cols: Session Overview Sidebar */}
                                <div className="space-y-4 lg:col-span-4">
                                    <SessionOverviewSidebar
                                        workflowRun={workflowRun}
                                        runId={runIdParam}
                                        organizationName={organizationName}
                                    />
                                </div>
                            </div>
                        )}

                        {/* ── Tab Content: Report ── */}
                        {activeTab === 'report' && showReportSection && (
                            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
                                <div className="space-y-4 lg:col-span-8 flex flex-col">
                                    <InlineReportViewer
                                        source={{ kind: "run", workflowId: targetWorkflowId, runId: Number(runIdParam) }}
                                        agentName={agentName}
                                        reportS3Key={workflowRun?.report_s3_key ?? null}
                                        reportVariables={
                                            (workflowRun?.gathered_context?.report_variables as
                                                | Record<string, unknown>
                                                | undefined) ?? null
                                        }
                                        reportStatus={(workflowRun?.report_generation_status as 'pending' | 'processing' | 'completed' | 'failed' | null) ?? null}
                                        onRegenerate={handleRegenerateReport}
                                        isRegenerating={isRegeneratingReport}
                                        style={isDesktop && sidebarHeight && sidebarHeight > 200 ? { height: `${sidebarHeight}px` } : undefined}
                                        className={cn((!sidebarHeight || !isDesktop) && "h-[820px]")}
                                    />
                                </div>
                                <div ref={rightSidebarRef} className="space-y-4 lg:col-span-4">
                                    <AnalyticsSidebar
                                        workflowRun={workflowRun}
                                        runId={runIdParam}
                                        organizationName={organizationName}
                                        modelPricingRules={modelPricingRules}
                                        maxCallDuration={maxCallDuration}
                                        totalWorkflowNodes={totalWorkflowNodes}
                                    />
                                </div>
                            </div>
                        )}

                    </div>
                </div>
            </div>
        );
    }
    else {
        returnValue = (
            <div className="flex h-full items-center justify-center p-6">
                <Card className="w-full max-w-xl border-border">
                    <CardHeader className="space-y-2">
                        <CardTitle className="text-2xl">Run Details Unavailable</CardTitle>
                        <p className="text-sm text-muted-foreground">
                            This run does not have a details view yet. Go back to the workflow to continue testing or make changes.
                        </p>
                    </CardHeader>
                    <CardFooter>
                        <Button asChild className="gap-2">
                            <Link href={`/voice/agents/${targetWorkflowId}`}>
                                Customize Agent
                            </Link>
                        </Button>
                    </CardFooter>
                </Card>
            </div>
        );
    }

    return (
        <WorkflowLayout>
            <PageHeader
                title={conversationTitle || (runIdParam ? `Run #${runIdParam}` : 'Run Details')}
                breadcrumbs={breadcrumbs}
                actions={
                    <div className="flex items-center gap-2">
                        {targetWorkflowId > 0 && (
                            <Link href={`/workflow/${targetWorkflowId}`}>
                                <Button
                                    ref={customizeButtonRef}
                                    size="sm"
                                    variant="outline"
                                    className="h-8 gap-1.5 text-xs"
                                    onClick={() => {
                                        if (!hasSeenTooltip('customize_workflow')) {
                                            markTooltipSeen('customize_workflow');
                                        }
                                    }}
                                >
                                    <Pencil className="h-3.5 w-3.5" />
                                    Customize Agent
                                </Button>
                            </Link>
                        )}
                        {targetWorkflowId > 0 && (
                            <Button asChild size="sm" variant="outline" className="h-8 gap-1.5 text-xs">
                                <Link href={`/voice/agents/${targetWorkflowId}/view`}>
                                    <Eye className="h-3.5 w-3.5" />
                                    View Agent
                                </Link>
                            </Button>
                        )}
                        <Button
                            size="sm"
                            variant="outline"
                            className="h-8 w-8 p-0"
                            aria-label="Refresh conversation"
                            title="Refresh"
                            onClick={() => void handleRefreshRun()}
                            disabled={isRefreshingRun}
                        >
                            <RefreshCw className={cn("h-3.5 w-3.5", isRefreshingRun && "animate-spin")} />
                        </Button>
                    </div>
                }
            />
            {returnValue}
            {dialog}

            {/* Onboarding Tooltip for Customize Workflow */}
            {showRunDetailsView && (
                <OnboardingTooltip
                    title='Customize Your Workflow'
                    targetRef={customizeButtonRef}
                    message="Edit your workflow to adjust the voice agent's behavior, add new steps, or modify the conversation flow."
                    onDismiss={() => markTooltipSeen('customize_workflow')}
                    showNext={false}
                    isVisible={!hasSeenTooltip('customize_workflow')}
                />
            )}
        </WorkflowLayout>
    );
}
