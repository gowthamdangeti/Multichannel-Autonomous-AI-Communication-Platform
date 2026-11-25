"use client";

import { Download, Loader2, Phone, RefreshCw, Video, VideoOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { getWorkflowRunApiV1WorkflowWorkflowIdRunsRunIdGet } from "@/client/sdk.gen";
import { Button } from "@/components/ui/button";
import { RealtimeFeedback } from "@/components/workflow/conversation";

import { ApiKeyErrorDialog, ConnectionStatus, WorkflowConfigErrorDialog } from "../../run/[runId]/components";
import { useWebSocketRTC } from "../../run/[runId]/hooks";
import type { WorkflowRuntimeNodeTransition } from "./types";
import { resolveArtifactUrl } from "./utils";

interface EmbeddedVoiceTesterProps {
    workflowId: number;
    workflowRunId: number;
    initialContextVariables?: Record<string, string>;
    accessToken: string;
    enableVideo?: boolean;
    onReset: () => void;
    onNodeTransition?: (transition: WorkflowRuntimeNodeTransition) => void;
    onCallActiveChange?: (active: boolean) => void;
    onStopRef?: React.MutableRefObject<(() => void) | null>;
}

export function EmbeddedVoiceTester({
    workflowId,
    workflowRunId,
    initialContextVariables,
    accessToken,
    enableVideo = false,
    onReset,
    onNodeTransition,
    onCallActiveChange,
    onStopRef,
}: EmbeddedVoiceTesterProps) {
    const router = useRouter();
    const {
        audioRef,
        connectionActive,
        permissionError,
        cameraError,
        localStream: localCameraStream,
        isCompleted,
        apiKeyModalOpen,
        setApiKeyModalOpen,
        apiKeyError,
        apiKeyErrorCode,
        workflowConfigError,
        workflowConfigModalOpen,
        setWorkflowConfigModalOpen,
        connectionStatus,
        start,
        stop,
        isStarting,
        feedbackMessages,
    } = useWebSocketRTC({
        workflowId,
        workflowRunId,
        accessToken,
        initialContextVariables,
        onNodeTransition,
        enableVideo,
    });
    const autoStartedRef = useRef(false);
    const [videoRecordingUrl, setVideoRecordingUrl] = useState<string | null>(null);
    const [isLoadingRecording, setIsLoadingRecording] = useState(false);
    const [recordingError, setRecordingError] = useState<string | null>(null);
    const [cameraNotSendingFrames, setCameraNotSendingFrames] = useState(false);
    const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    // Bind local camera stream to preview <video> when stream has active video tracks.
    // Handles React mount timing via requestAnimationFrame/setTimeout retry fallback.
    useEffect(() => {
        if (!localCameraStream || localCameraStream.getVideoTracks().length === 0) {
            setCameraNotSendingFrames((prev) => (prev ? false : prev));
            if (videoPreviewRef.current) {
                videoPreviewRef.current.srcObject = null;
            }
            return;
        }

        let animationFrameId: number;
        let timeoutId: NodeJS.Timeout;
        let attempts = 0;
        const maxAttempts = 15;

        const videoTrack = localCameraStream?.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = true; // Ensure track enabled
        }

        const handleUnmute = () => {
            setCameraNotSendingFrames((prev) => (prev ? false : prev));
            const videoEl = videoPreviewRef.current;
            if (videoEl) {
                if (videoTrack) {
                    videoTrack.enabled = true;
                }
                videoEl.muted = true;
                if (videoEl.srcObject !== localCameraStream) {
                    videoEl.srcObject = localCameraStream;
                }
                videoEl.play().catch((err) => console.warn("Play on unmute failed:", err));
            }
        };

        if (videoTrack) {
            videoTrack.addEventListener("unmute", handleUnmute);
        }

        const assignStream = () => {
            const videoEl = videoPreviewRef.current;
            if (videoEl) {
                if (videoTrack) {
                    videoTrack.enabled = true; // Explicitly ensure enabled
                }

                videoEl.muted = true;
                videoEl.defaultMuted = true;
                videoEl.playsInline = true;

                if (videoEl.srcObject !== localCameraStream) {
                    videoEl.srcObject = localCameraStream;
                }
                if (videoTrack) {
                    videoTrack.enabled = true;
                }
                const playPromise = videoEl.play();
                if (playPromise !== undefined) {
                    playPromise.catch((err) => {
                        if (err?.name !== "AbortError") {
                            console.warn("Autoplay prevented:", err);
                        }
                    });
                }
            } else if (attempts < maxAttempts) {
                attempts++;
                animationFrameId = requestAnimationFrame(() => {
                    timeoutId = setTimeout(assignStream, 50);
                });
            }
        };

        assignStream();

        // Detection timer: if video element has no dimensions or track is muted after 2.5s, display warning
        const fallbackTimer = setTimeout(() => {
            const videoEl = videoPreviewRef.current;
            const currentVideoTrack = localCameraStream?.getVideoTracks()[0];
            const hasDimensions = videoEl && videoEl.videoWidth > 0 && videoEl.videoHeight > 0;
            const isMuted = !currentVideoTrack || currentVideoTrack.muted || !currentVideoTrack.enabled;

            if (!hasDimensions || isMuted) {
                setCameraNotSendingFrames(true);
            } else {
                setCameraNotSendingFrames((prev) => (prev ? false : prev));
            }
        }, 2500);

        return () => {
            cancelAnimationFrame(animationFrameId);
            clearTimeout(timeoutId);
            clearTimeout(fallbackTimer);
            if (videoTrack) {
                videoTrack.removeEventListener("unmute", handleUnmute);
            }
        };
    }, [localCameraStream]);

    // Canvas frame-drawing loop via requestAnimationFrame.
    // Chromium DirectComposition bug workaround: on certain Chromium versions and GPU combinations (especially
    // Windows DirectComposition overlays), WebRTC video elements decode frames but fail to paint them to the screen,
    // leaving a black box. Drawing the video frames directly onto an HTML5 <canvas> element using a 2D rendering context
    // bypasses the underlying compositor glitch and ensures smooth, reliable live camera preview playback.
    useEffect(() => {
        if (!localCameraStream || localCameraStream.getVideoTracks().length === 0) return;

        let animId: number;
        let isRunning = true;

        const drawFrame = () => {
            if (!isRunning) return;
            const videoEl = videoPreviewRef.current;
            const canvasEl = canvasRef.current;

            if (videoEl && canvasEl) {
                if (videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
                    if (canvasEl.width !== videoEl.videoWidth || canvasEl.height !== videoEl.videoHeight) {
                        canvasEl.width = videoEl.videoWidth;
                        canvasEl.height = videoEl.videoHeight;
                    }
                    const ctx = canvasEl.getContext("2d");
                    if (ctx) {
                        ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
                    }
                    setCameraNotSendingFrames((prev) => (prev ? false : prev));
                } else if (videoEl.paused) {
                    videoEl.play().catch(() => { });
                }
            }

            animId = requestAnimationFrame(drawFrame);
        };

        animId = requestAnimationFrame(drawFrame);

        return () => {
            isRunning = false;
            cancelAnimationFrame(animId);
        };
    }, [localCameraStream]);

    const setVideoPreviewRef = useCallback(
        (el: HTMLVideoElement | null) => {
            videoPreviewRef.current = el;
            if (el && localCameraStream && localCameraStream.getVideoTracks().length > 0) {
                const videoTrack = localCameraStream.getVideoTracks()[0];
                if (videoTrack) {
                    videoTrack.enabled = true; // Explicitly ensure enabled
                    videoTrack.onunmute = () => {
                        videoTrack.enabled = true;
                        el.play().catch((err) => console.warn("Play on unmute failed:", err));
                    };
                }

                el.muted = true;
                el.defaultMuted = true;
                el.playsInline = true;
                if (el.srcObject !== localCameraStream) {
                    el.srcObject = localCameraStream;
                }
                const playPromise = el.play();
                if (playPromise !== undefined) {
                    playPromise.catch((err) => {
                        if (err?.name !== "AbortError") {
                            console.warn("Autoplay prevented:", err);
                        }
                    });
                }
            }
        },
        [localCameraStream],
    );

    useEffect(() => {
        onCallActiveChange?.(connectionActive);
    }, [connectionActive, onCallActiveChange]);

    useEffect(() => {
        if (onStopRef) {
            onStopRef.current = stop;
        }
        return () => {
            if (onStopRef) {
                onStopRef.current = null;
            }
        };
    }, [stop, onStopRef]);

    useEffect(() => {
        if (autoStartedRef.current) {
            return;
        }
        autoStartedRef.current = true;
        void start();
    }, [start]);

    // Retrieve recorded video artifact after test completes
    useEffect(() => {
        if (!isCompleted || !enableVideo || !workflowRunId) {
            return;
        }

        let isMounted = true;
        let attempts = 0;
        const maxAttempts = 15;
        setIsLoadingRecording(true);
        setRecordingError(null);

        const pollRecording = async () => {
            try {
                const res = await getWorkflowRunApiV1WorkflowWorkflowIdRunsRunIdGet({
                    path: {
                        workflow_id: workflowId,
                        run_id: workflowRunId,
                    },
                });

                if (!isMounted) return;

                const publicUrl = (res.data as { video_recording_public_url?: string | null })?.video_recording_public_url;
                if (publicUrl) {
                    setVideoRecordingUrl(resolveArtifactUrl(publicUrl));
                    setIsLoadingRecording(false);
                    return;
                }

                if (attempts >= maxAttempts) {
                    setIsLoadingRecording(false);
                    setRecordingError("Recording processing timed out or no video track was recorded.");
                    return;
                }

                attempts++;
                setTimeout(pollRecording, 1500);
            } catch {
                if (!isMounted) return;
                if (attempts >= maxAttempts) {
                    setIsLoadingRecording(false);
                    setRecordingError("Failed to retrieve recorded video.");
                } else {
                    attempts++;
                    setTimeout(pollRecording, 1500);
                }
            }
        };

        // Allow ARQ worker a brief moment before first poll
        const timer = setTimeout(pollRecording, 1000);
        return () => {
            isMounted = false;
            clearTimeout(timer);
        };
    }, [isCompleted, enableVideo, workflowId, workflowRunId]);

    const endButtonLabel = connectionActive
        ? "End Call"
        : isCompleted
            ? "Start Another Test"
            : connectionStatus === "failed"
                ? "Retry Call"
                : "Starting Test...";

    const handleFooterAction = async () => {
        if (connectionActive) {
            stop();
            return;
        }
        if (isCompleted) {
            onReset();
            return;
        }
        if (connectionStatus === "failed") {
            await start();
        }
    };

    return (
        <>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/70 bg-background">
                <div className="min-h-0 flex-1 flex flex-col overflow-hidden">
                    {/* Video Area when Video Recording is enabled */}
                    {enableVideo && (
                        <div className="p-3 pb-0 shrink-0">
                            {connectionActive ? (
                                cameraError ? (
                                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-500 flex items-center gap-2">
                                        <VideoOff className="h-4 w-4 shrink-0" />
                                        <span>No camera found. Please check your permissions.</span>
                                    </div>
                                ) : localCameraStream && localCameraStream.getVideoTracks().length > 0 ? (
                                    <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black border border-border/70 shadow-sm">
                                        <video
                                            key={localCameraStream?.id}
                                            ref={setVideoPreviewRef}
                                            autoPlay
                                            playsInline
                                            muted
                                            onLoadedMetadata={(e) => {
                                                const video = e.currentTarget;
                                                video.muted = true; // Force DOM property
                                                video.play().catch((err) => console.warn("Autoplay prevented:", err));
                                            }}
                                            className="absolute inset-0 h-full w-full opacity-0 pointer-events-none -z-10"
                                        />
                                        <canvas
                                            ref={canvasRef}
                                            width={640}
                                            height={480}
                                            className="absolute inset-0 h-full w-full object-cover z-10"
                                        />
                                        {cameraNotSendingFrames && (
                                            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/85 p-4 text-center backdrop-blur-sm">
                                                <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-amber-500/20 text-amber-400">
                                                    <VideoOff className="h-4 w-4" />
                                                </div>
                                                <p className="max-w-[280px] text-xs font-medium text-amber-200 leading-relaxed">
                                                    Camera is active but not sending frames. Please check if another app is using your camera or if your privacy shutter is closed.
                                                </p>
                                            </div>
                                        )}
                                        <div className="absolute top-2 left-2 flex items-center gap-1.5 rounded-full bg-black/60 backdrop-blur-sm px-2 py-0.5 text-[10px] font-medium text-white border border-white/10 z-20">
                                            <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                                            <span>REC</span>
                                        </div>
                                        <div className="absolute bottom-2 left-2 text-[10px] font-medium text-white/80 bg-black/50 backdrop-blur-sm px-2 py-0.5 rounded flex items-center gap-1.5 z-20">
                                            <span>Live Camera Preview</span>
                                        </div>
                                    </div>
                                ) : localCameraStream && localCameraStream.getVideoTracks().length === 0 ? (
                                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-500 flex items-center gap-2">
                                        <VideoOff className="h-4 w-4 shrink-0" />
                                        <span>No camera found. Please check your permissions.</span>
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center justify-center aspect-video w-full rounded-lg bg-muted/20 border border-dashed border-border/60 text-muted-foreground gap-2">
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        <span className="text-xs">Connecting camera feed...</span>
                                    </div>
                                )
                            ) : isCompleted ? (
                                isLoadingRecording ? (
                                    <div className="flex flex-col items-center justify-center p-4 rounded-lg bg-muted/20 border border-border/50 text-center gap-2 aspect-video">
                                        <Loader2 className="h-5 w-5 animate-spin text-primary" />
                                        <div className="space-y-0.5">
                                            <p className="text-xs font-medium">Processing video recording...</p>
                                            <p className="text-[10px] text-muted-foreground">Preparing MP4 video stream</p>
                                        </div>
                                    </div>
                                ) : videoRecordingUrl ? (
                                    <div className="space-y-1.5">
                                        <div className="flex items-center justify-between text-xs font-medium px-0.5 text-muted-foreground">
                                            <span className="flex items-center gap-1.5 text-foreground">
                                                <Video className="h-3.5 w-3.5 text-primary" /> Recorded Video
                                            </span>
                                            <a
                                                href={videoRecordingUrl}
                                                download={`test-video-${workflowRunId}.mp4`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="flex items-center gap-1 text-primary hover:underline text-xs"
                                            >
                                                <Download className="h-3 w-3" /> Download MP4
                                            </a>
                                        </div>
                                        <div className="overflow-hidden rounded-lg bg-black border border-border shadow-sm">
                                            <video
                                                controls
                                                src={videoRecordingUrl}
                                                className="w-full aspect-video rounded-lg"
                                                preload="metadata"
                                            />
                                        </div>
                                    </div>
                                ) : recordingError ? (
                                    <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5 text-xs text-muted-foreground text-center">
                                        <span>{recordingError}</span>
                                    </div>
                                ) : null
                            ) : (
                                <div className="flex flex-col items-center justify-center aspect-video w-full rounded-lg bg-muted/20 border border-dashed border-border/60 text-muted-foreground gap-2">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    <span className="text-xs">Preparing test session...</span>
                                </div>
                            )}
                        </div>
                    )}

                    <div className="min-h-0 flex-1 overflow-hidden bg-muted/15 p-3">
                        <RealtimeFeedback
                            mode="live"
                            messages={feedbackMessages}
                            isCallActive={connectionActive}
                            isCallCompleted={isCompleted}
                        />
                    </div>
                </div>

                <div className="border-t border-border/70 bg-background px-4 py-3">
                    <div className="flex flex-col gap-3">
                        <ConnectionStatus connectionStatus={connectionStatus} />
                        {permissionError ? (
                            <p className="text-center text-sm text-destructive">{permissionError}</p>
                        ) : null}
                        <Button
                            onClick={handleFooterAction}
                            disabled={isStarting && connectionStatus !== "failed"}
                            variant={connectionActive ? "destructive" : "default"}
                            className="w-full"
                        >
                            {isStarting && connectionStatus !== "failed" ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Starting Test...
                                </>
                            ) : connectionActive ? (
                                <>
                                    <Phone className="h-4 w-4" />
                                    {endButtonLabel}
                                </>
                            ) : connectionStatus === "failed" ? (
                                <>
                                    <RefreshCw className="h-4 w-4" />
                                    {endButtonLabel}
                                </>
                            ) : isCompleted ? (
                                <>
                                    <RefreshCw className="h-4 w-4" />
                                    {endButtonLabel}
                                </>
                            ) : (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    {endButtonLabel}
                                </>
                            )}
                        </Button>
                    </div>
                </div>

                <audio ref={audioRef} autoPlay playsInline className="hidden" />
            </div>

                <ApiKeyErrorDialog
                    open={apiKeyModalOpen}
                    onOpenChange={setApiKeyModalOpen}
                    error={apiKeyError}
                    errorCode={apiKeyErrorCode}
                    onNavigateToBilling={() => router.push("/billing")}
                    onNavigateToModelConfig={() => router.push("/model-configurations")}
                />

                <WorkflowConfigErrorDialog
                    open={workflowConfigModalOpen}
                    onOpenChange={setWorkflowConfigModalOpen}
                    error={workflowConfigError}
                    onNavigateToWorkflow={() => router.push(`/workflow/${workflowId}`)}
                />
            </>
            );
}
