'use client';

import {
    AlertCircle,
    Clock,
    Download,
    ExternalLink,
    Headphones,
    Loader2,
    Maximize,
    Minimize,
    Pause,
    Play,
    Radio,
    RotateCcw,
    RotateCw,
    Video,
    VideoOff,
    Volume1,
    Volume2,
    VolumeX,
} from 'lucide-react';
import posthog from 'posthog-js';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { PostHogEvent } from '@/constants/posthog-events';
import { getSignedUrl } from '@/lib/files';
import { cn } from '@/lib/utils';

interface MediaRecordingPlayerProps {
    recordingUrl: string | null;
    fallbackRecordingUrl?: string | null;
    transcriptUrl: string | null;
    runId: number;
    agentName?: string;
    conversationTitle?: string;
    durationSeconds?: number | null;
    traceUrl?: string | null;
    onOpenPreview?: (recordingUrl: string | null, transcriptUrl: string | null, runId: number) => void;
    downloadFile: (url: string | null) => void;
    isAuthenticated?: boolean;
}

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 2];

function formatTime(seconds: number): string {
    if (isNaN(seconds) || !Number.isFinite(seconds) || seconds < 0) return '0:00';
    const totalSecs = Math.floor(seconds);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    const hours = Math.floor(mins / 60);
    if (hours > 0) {
        const remainingMins = mins % 60;
        return `${hours}:${remainingMins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function MediaRecordingPlayer({
    recordingUrl,
    fallbackRecordingUrl,
    transcriptUrl,
    runId,


    durationSeconds,
    traceUrl,
    onOpenPreview,
    downloadFile,
    isAuthenticated = true,
}: MediaRecordingPlayerProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const effectiveUrl = useMemo(
        () => recordingUrl || fallbackRecordingUrl || null,
        [recordingUrl, fallbackRecordingUrl]
    );

    const [signedMediaUrl, setSignedMediaUrl] = useState<string | null>(null);
    const [isLoadingMedia, setIsLoadingMedia] = useState(false);
    const [mediaError, setMediaError] = useState<string | null>(null);

    // Player state
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(durationSeconds ?? 0);
    const [bufferedPercent, setBufferedPercent] = useState(0);
    const [volume, setVolume] = useState(1);
    const [isMuted, setIsMuted] = useState(false);
    const [playbackSpeed, setPlaybackSpeed] = useState(1);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [showControls, setShowControls] = useState(true);
    const [isAudioOnly, setIsAudioOnly] = useState(false);
    const [waveTick, setWaveTick] = useState(0);

    // Determine initial audio-only hint from file extension
    useEffect(() => {
        if (!effectiveUrl) return;
        const lower = effectiveUrl.toLowerCase();
        const hasAudioExt = /\.(wav|mp3|m4a|ogg|aac|flac)(\?.*)?$/i.test(lower);
        if (hasAudioExt) {
            setIsAudioOnly(true);
        }
    }, [effectiveUrl]);

    // Fetch signed URL
    useEffect(() => {
        let isActive = true;
        if (!effectiveUrl) {
            setSignedMediaUrl(null);
            setIsLoadingMedia(false);
            setMediaError(null);
            return;
        }

        setIsLoadingMedia(true);
        setMediaError(null);

        getSignedUrl(effectiveUrl, true)
            .then((url) => {
                if (!isActive) return;
                if (url) {
                    setSignedMediaUrl(url);
                } else {
                    setMediaError('Recording file not found in storage.');
                }
            })
            .catch((err) => {
                if (!isActive) return;
                console.error('Failed to get signed media URL:', err);
                setMediaError('Failed to load secure media stream.');
            })
            .finally(() => {
                if (isActive) setIsLoadingMedia(false);
            });

        return () => {
            isActive = false;
        };
    }, [effectiveUrl]);

    // Fullscreen listener
    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(Boolean(document.fullscreenElement));
        };
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => {
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
        };
    }, []);

    // Waveform animation tick when audio is playing
    useEffect(() => {
        if (!isPlaying || !isAudioOnly) return;
        const interval = setInterval(() => {
            setWaveTick((prev) => (prev + 1) % 100);
        }, 120);
        return () => clearInterval(interval);
    }, [isPlaying, isAudioOnly]);

    // Mouse move for controls hide/show
    const handleMouseMove = useCallback(() => {
        setShowControls(true);
        if (controlsTimeoutRef.current) {
            clearTimeout(controlsTimeoutRef.current);
        }
        if (isPlaying) {
            controlsTimeoutRef.current = setTimeout(() => {
                setShowControls(false);
            }, 3000);
        }
    }, [isPlaying]);

    // Playback handlers
    const togglePlay = useCallback(() => {
        const video = videoRef.current;
        if (!video || !signedMediaUrl) return;

        if (video.paused) {
            video.play()
                .then(() => {
                    setIsPlaying(true);
                    posthog.capture(PostHogEvent.RECORDING_PLAYED, {
                        run_id: runId,
                        source: 'media_recording_player',
                    });
                })
                .catch((err) => {
                    console.error('Error playing media:', err);
                    setMediaError('Unable to autoplay media. Please interact with the player.');
                });
        } else {
            video.pause();
            setIsPlaying(false);
        }
    }, [signedMediaUrl, runId]);

    const handleTimeUpdate = () => {
        const video = videoRef.current;
        if (!video) return;
        setCurrentTime(video.currentTime);
    };

    const handleLoadedMetadata = () => {
        const video = videoRef.current;
        if (!video) return;

        if (Number.isFinite(video.duration) && video.duration > 0) {
            setDuration(video.duration);
        }

        // If video dimensions are zero, it's an audio stream inside <video>
        if (video.videoWidth === 0 && video.videoHeight === 0) {
            setIsAudioOnly(true);
        } else if (video.videoWidth > 0 && video.videoHeight > 0) {
            setIsAudioOnly(false);
        }
    };

    const handleProgress = () => {
        const video = videoRef.current;
        if (!video || video.buffered.length === 0) return;
        const bufferedEnd = video.buffered.end(video.buffered.length - 1);
        const dur = video.duration || duration;
        if (dur > 0) {
            setBufferedPercent(Math.min(100, (bufferedEnd / dur) * 100));
        }
    };

    const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
        const seekTime = Number(e.target.value);
        if (videoRef.current) {
            videoRef.current.currentTime = seekTime;
            setCurrentTime(seekTime);
        }
    };

    const handleSkip = (deltaSeconds: number) => {
        if (!videoRef.current) return;
        const maxDuration = duration > 0 ? duration : (videoRef.current.duration || 0);
        const nextTime = Math.max(0, Math.min(maxDuration, videoRef.current.currentTime + deltaSeconds));
        videoRef.current.currentTime = nextTime;
        setCurrentTime(nextTime);
    };

    const handleVolumeChange = (newVol: number) => {
        const clamped = Math.max(0, Math.min(1, newVol));
        setVolume(clamped);
        if (videoRef.current) {
            videoRef.current.volume = clamped;
            if (clamped === 0) {
                setIsMuted(true);
                videoRef.current.muted = true;
            } else if (isMuted) {
                setIsMuted(false);
                videoRef.current.muted = false;
            }
        }
    };

    const toggleMute = () => {
        if (!videoRef.current) return;
        const next = !isMuted;
        setIsMuted(next);
        videoRef.current.muted = next;
    };

    const cyclePlaybackSpeed = () => {
        const currentIndex = SPEED_OPTIONS.indexOf(playbackSpeed);
        const nextSpeed = SPEED_OPTIONS[(currentIndex + 1) % SPEED_OPTIONS.length];
        setPlaybackSpeed(nextSpeed);
        if (videoRef.current) {
            videoRef.current.playbackRate = nextSpeed;
        }
    };

    const toggleFullscreen = () => {
        if (!containerRef.current) return;
        if (!document.fullscreenElement) {
            containerRef.current.requestFullscreen().catch((err) => {
                console.error('Fullscreen request error:', err);
            });
        } else {
            document.exitFullscreen().catch(console.error);
        }
    };

    // Keyboard shortcuts
    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.code)) {
            e.preventDefault();
        }
        switch (e.code) {
            case 'Space':
                togglePlay();
                break;
            case 'ArrowLeft':
                handleSkip(-5);
                break;
            case 'ArrowRight':
                handleSkip(5);
                break;
            case 'ArrowUp':
                handleVolumeChange(volume + 0.1);
                break;
            case 'ArrowDown':
                handleVolumeChange(volume - 0.1);
                break;
            case 'KeyM':
                toggleMute();
                break;
            case 'KeyF':
                toggleFullscreen();
                break;
        }
    };

    const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

    return (
        <Card className="border-border/70 bg-card/60 backdrop-blur-sm shadow-sm overflow-hidden">
            {/* ── Card Header ── */}
            <CardHeader className="p-4 pb-3 border-b border-border/40 flex flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-2 min-w-0">
                    <Video className="h-3.5 w-3.5 text-primary shrink-0" />
                    <CardTitle className="text-xs font-bold uppercase tracking-wider text-foreground truncate">
                        Media Recording
                    </CardTitle>
                    {isLoadingMedia ? (
                        <Badge variant="outline" className="text-[10px] gap-1 px-1.5 py-0 h-5">
                            <Loader2 className="h-2.5 w-2.5 animate-spin" />
                            Loading
                        </Badge>
                    ) : mediaError ? (
                        <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-5">
                            Error
                        </Badge>
                    ) : !effectiveUrl ? (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-5">
                            No Recording
                        </Badge>
                    ) : isAudioOnly ? (
                        <Badge
                            variant="outline"
                            className="text-[10px] px-1.5 py-0 h-5 bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30 font-medium"
                        >
                            Voice Stream
                        </Badge>
                    ) : (
                        <Badge
                            variant="outline"
                            className="text-[10px] px-1.5 py-0 h-5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 font-medium"
                        >
                            HD Video
                        </Badge>
                    )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    {effectiveUrl && (
                        <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-muted/40 border border-border/50 text-[11px] text-muted-foreground font-mono">
                            <Clock className="h-3 w-3" />
                            <span>{formatTime(duration)}</span>
                        </div>
                    )}
                </div>
            </CardHeader>

            {/* ── Card Content: Video Player Viewport ── */}
            <CardContent className="p-0 bg-black">
                <div
                    ref={containerRef}
                    tabIndex={0}
                    onKeyDown={handleKeyDown}
                    onMouseMove={handleMouseMove}
                    onMouseLeave={() => {
                        if (isPlaying) setShowControls(false);
                    }}
                    className={cn(
                        'relative w-full aspect-video max-h-[520px] bg-zinc-950 flex items-center justify-center overflow-hidden outline-none select-none group',
                        isFullscreen && 'h-screen max-h-none rounded-none'
                    )}
                >
                    {/* State 1: Loading */}
                    {isLoadingMedia && (
                        <div className="flex flex-col items-center justify-center gap-3 p-8 text-muted-foreground">
                            <Loader2 className="h-9 w-9 animate-spin text-primary" />
                            <p className="text-sm font-medium text-neutral-300">Loading media recording...</p>
                            <span className="text-xs text-neutral-500">Decrypting secure audio/video stream</span>
                        </div>
                    )}

                    {/* State 2: No recording available */}
                    {!isLoadingMedia && !effectiveUrl && (
                        <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
                            <div className="h-14 w-14 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center">
                                <VideoOff className="h-7 w-7 text-neutral-500" />
                            </div>
                            <div className="space-y-1">
                                <p className="text-sm font-semibold text-neutral-200">No Recording Available</p>
                                <p className="text-xs text-neutral-500 max-w-sm">
                                    No audio or video stream was captured for this session. Audio recording is configured in workflow settings.
                                </p>
                            </div>
                        </div>
                    )}

                    {/* State 3: Error */}
                    {!isLoadingMedia && effectiveUrl && mediaError && (
                        <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
                            <div className="h-14 w-14 rounded-full bg-red-950/60 border border-red-900/60 flex items-center justify-center">
                                <AlertCircle className="h-7 w-7 text-red-400" />
                            </div>
                            <div className="space-y-1">
                                <p className="text-sm font-medium text-red-300">{mediaError}</p>
                                <p className="text-xs text-neutral-500">
                                    You can still download the raw recording file directly below.
                                </p>
                            </div>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => downloadFile(effectiveUrl)}
                                className="mt-2 gap-2 text-xs border-neutral-700 bg-neutral-900 text-neutral-200 hover:bg-neutral-800"
                            >
                                <Download className="h-3.5 w-3.5" />
                                Download File
                            </Button>
                        </div>
                    )}

                    {/* State 4: Media Loaded and Ready */}
                    {!isLoadingMedia && signedMediaUrl && !mediaError && (
                        <>
                            {/* Native <video> element */}
                            <video
                                ref={videoRef}
                                src={signedMediaUrl}
                                playsInline
                                preload="metadata"
                                onClick={togglePlay}
                                onDoubleClick={toggleFullscreen}
                                onTimeUpdate={handleTimeUpdate}
                                onLoadedMetadata={handleLoadedMetadata}
                                onProgress={handleProgress}
                                onPlay={() => setIsPlaying(true)}
                                onPause={() => setIsPlaying(false)}
                                onEnded={() => {
                                    setIsPlaying(false);
                                    setCurrentTime(0);
                                }}
                                onError={() => setMediaError('Browser media playback failed. Format may not be directly streamable.')}
                                className={cn(
                                    'w-full h-full object-contain cursor-pointer transition-opacity duration-300',
                                    isAudioOnly ? 'opacity-0 pointer-events-none absolute inset-0' : 'opacity-100'
                                )}
                            />

                            {/* Audio Visualizer Viewport (when audio-only stream) */}
                            {isAudioOnly && (
                                <div
                                    onClick={togglePlay}
                                    className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-b from-neutral-900 via-zinc-950 to-neutral-950 cursor-pointer select-none"
                                >
                                    {/* Ambient Glow */}
                                    <div
                                        className={cn(
                                            'absolute h-48 w-48 rounded-full bg-sky-500/10 blur-3xl pointer-events-none transition-all duration-700',
                                            isPlaying ? 'scale-125 opacity-100 bg-sky-500/20' : 'scale-90 opacity-40'
                                        )}
                                    />

                                    {/* Central Headphone/Mic Avatar */}
                                    <div className="relative mb-6">
                                        <div
                                            className={cn(
                                                'h-20 w-20 rounded-full bg-neutral-900/90 border border-neutral-700/80 shadow-2xl flex items-center justify-center transition-all duration-300',
                                                isPlaying ? 'border-sky-500/60 ring-4 ring-sky-500/20' : ''
                                            )}
                                        >
                                            {isPlaying ? (
                                                <Radio className="h-8 w-8 text-sky-400 animate-pulse" />
                                            ) : (
                                                <Headphones className="h-8 w-8 text-neutral-400" />
                                            )}
                                        </div>
                                    </div>

                                    {/* Dynamic Waveform Visualizer Bars */}
                                    <div className="flex items-center gap-1 sm:gap-1.5 h-14 mb-4 px-6 max-w-md w-full justify-center">
                                        {Array.from({ length: 28 }).map((_, i) => {
                                            // Generate pseudo-waveform oscillation when playing
                                            const baseMultiplier = Math.sin((i / 28) * Math.PI);
                                            const dynamicVariation = isPlaying
                                                ? Math.abs(Math.sin((waveTick * 0.35) + (i * 0.6)))
                                                : 0.15;
                                            const barHeight = Math.max(
                                                12,
                                                Math.round((baseMultiplier * 0.4 + dynamicVariation * 0.6) * 100)
                                            );

                                            return (
                                                <span
                                                    key={i}
                                                    style={{ height: `${barHeight}%` }}
                                                    className={cn(
                                                        'w-1 sm:w-1.5 rounded-full transition-all duration-150',
                                                        isPlaying
                                                            ? 'bg-gradient-to-t from-sky-500 to-sky-300 opacity-90'
                                                            : 'bg-neutral-700 opacity-40'
                                                    )}
                                                />
                                            );
                                        })}
                                    </div>

                                    <div className="text-center space-y-1">
                                        <p className="text-sm font-semibold text-neutral-200">
                                            Voice Conversation Audio
                                        </p>
                                        <p className="text-xs text-neutral-400">
                                            {isPlaying ? 'Playing session stream' : 'Click anywhere to play recording'}
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* Center Big Play/Pause Overlay (when paused or hovered) */}
                            {!isPlaying && (
                                <div
                                    onClick={togglePlay}
                                    className="absolute inset-0 flex items-center justify-center pointer-events-auto cursor-pointer z-10"
                                >
                                    <div className="h-16 w-16 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur-md border border-white/20 text-white flex items-center justify-center shadow-2xl transition-all duration-200 hover:scale-110 active:scale-95 group/btn">
                                        <Play className="h-7 w-7 fill-white ml-1 group-hover/btn:text-primary transition-colors" />
                                    </div>
                                </div>
                            )}

                            {/* ── Bottom Overlay Control Bar ── */}
                            <div
                                className={cn(
                                    'absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/80 to-transparent px-4 pb-3 pt-10 flex flex-col gap-2 transition-opacity duration-300 z-20',
                                    showControls || !isPlaying
                                        ? 'opacity-100 pointer-events-auto'
                                        : 'opacity-0 pointer-events-none'
                                )}
                            >
                                {/* Scrubber Timeline Bar */}
                                <div className="relative w-full h-4 flex items-center group/slider cursor-pointer">
                                    {/* Base track */}
                                    <div className="w-full h-1.5 group-hover/slider:h-2 rounded-full bg-white/20 transition-all overflow-hidden relative">
                                        {/* Buffer track */}
                                        <div
                                            className="absolute top-0 bottom-0 left-0 bg-white/30 rounded-full transition-all"
                                            style={{ width: `${bufferedPercent}%` }}
                                        />
                                        {/* Progress track */}
                                        <div
                                            className="absolute top-0 bottom-0 left-0 bg-sky-500 rounded-full transition-all"
                                            style={{ width: `${progressPercent}%` }}
                                        />
                                    </div>

                                    {/* Thumb indicator on hover */}
                                    <div
                                        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-3.5 w-3.5 rounded-full bg-white shadow-md opacity-0 group-hover/slider:opacity-100 transition-opacity pointer-events-none"
                                        style={{ left: `${progressPercent}%` }}
                                    />

                                    {/* Range Input for native drag/seek */}
                                    <input
                                        type="range"
                                        min={0}
                                        max={duration || 1}
                                        step={0.1}
                                        value={currentTime}
                                        onChange={handleSeek}
                                        aria-label="Seek time"
                                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                    />
                                </div>

                                {/* Controls Row */}
                                <div className="flex items-center justify-between gap-2">
                                    {/* Left controls: Play, Skip, Volume, Time */}
                                    <div className="flex items-center gap-1.5 sm:gap-2">
                                        {/* Play/Pause */}
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            onClick={togglePlay}
                                            aria-label={isPlaying ? 'Pause' : 'Play'}
                                            className="h-8 w-8 rounded-full text-white hover:text-white hover:bg-white/20 cursor-pointer"
                                        >
                                            {isPlaying ? (
                                                <Pause className="h-4 w-4 fill-white" />
                                            ) : (
                                                <Play className="h-4 w-4 fill-white ml-0.5" />
                                            )}
                                        </Button>

                                        {/* Skip -10s */}
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => handleSkip(-10)}
                                            aria-label="Rewind 10 seconds"
                                            className="h-7 w-7 text-neutral-300 hover:text-white hover:bg-white/20 rounded cursor-pointer hidden sm:inline-flex"
                                        >
                                            <RotateCcw className="h-3.5 w-3.5" />
                                        </Button>

                                        {/* Skip +10s */}
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => handleSkip(10)}
                                            aria-label="Fast forward 10 seconds"
                                            className="h-7 w-7 text-neutral-300 hover:text-white hover:bg-white/20 rounded cursor-pointer hidden sm:inline-flex"
                                        >
                                            <RotateCw className="h-3.5 w-3.5" />
                                        </Button>

                                        {/* Volume controls */}
                                        <div className="flex items-center gap-1 group/vol">
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                onClick={toggleMute}
                                                aria-label={isMuted ? 'Unmute' : 'Mute'}
                                                className="h-7 w-7 text-neutral-300 hover:text-white hover:bg-white/20 rounded cursor-pointer"
                                            >
                                                {isMuted || volume === 0 ? (
                                                    <VolumeX className="h-4 w-4 text-red-400" />
                                                ) : volume < 0.5 ? (
                                                    <Volume1 className="h-4 w-4" />
                                                ) : (
                                                    <Volume2 className="h-4 w-4" />
                                                )}
                                            </Button>

                                            <div className="w-0 group-hover/vol:w-16 sm:w-16 overflow-hidden transition-all duration-200 flex items-center">
                                                <input
                                                    type="range"
                                                    min={0}
                                                    max={1}
                                                    step={0.05}
                                                    value={isMuted ? 0 : volume}
                                                    onChange={(e) => handleVolumeChange(Number(e.target.value))}
                                                    aria-label="Volume slider"
                                                    className="w-14 h-1 bg-white/30 rounded-lg appearance-none cursor-pointer accent-sky-400"
                                                />
                                            </div>
                                        </div>

                                        {/* Time Display */}
                                        <span className="font-mono text-xs text-neutral-300 font-medium ml-1">
                                            {formatTime(currentTime)} / {formatTime(duration)}
                                        </span>
                                    </div>

                                    {/* Right controls: Speed, PiP, Fullscreen */}
                                    <div className="flex items-center gap-1 sm:gap-1.5">
                                        {/* Speed */}
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            onClick={cyclePlaybackSpeed}
                                            aria-label="Change playback speed"
                                            className="h-7 px-2 text-xs font-mono font-semibold text-neutral-300 hover:text-white hover:bg-white/20 rounded cursor-pointer"
                                        >
                                            {playbackSpeed}x
                                        </Button>

                                        {/* Fullscreen */}
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            onClick={toggleFullscreen}
                                            aria-label={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
                                            className="h-7 w-7 text-neutral-300 hover:text-white hover:bg-white/20 rounded cursor-pointer"
                                        >
                                            {isFullscreen ? (
                                                <Minimize className="h-3.5 w-3.5" />
                                            ) : (
                                                <Maximize className="h-3.5 w-3.5" />
                                            )}
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </CardContent>

            {/* ── Card Footer: Action Toolbar ── */}
            <CardFooter className="p-4 border-t border-border/40 bg-card flex flex-wrap items-center justify-end gap-2">
                {onOpenPreview && effectiveUrl && (
                    <Button
                        onClick={() => onOpenPreview(recordingUrl, transcriptUrl, runId)}
                        size="sm"
                        variant="ghost"
                        className="gap-2 text-muted-foreground hover:text-foreground"
                    >
                        <ExternalLink className="h-4 w-4" />
                        Modal Preview
                    </Button>
                )}

                <Button
                    onClick={() => downloadFile(effectiveUrl)}
                    disabled={!effectiveUrl || !isAuthenticated}
                    size="sm"
                    variant="outline"
                    className="gap-2 font-medium"
                >
                    <Download className="h-4 w-4" />
                    Download Recording
                </Button>

                {traceUrl && (
                    <Button
                        asChild
                        size="sm"
                        variant="outline"
                        className="gap-2"
                    >
                        <a
                            href={traceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            <ExternalLink className="h-4 w-4" />
                            View Trace
                        </a>
                    </Button>
                )}
            </CardFooter>
        </Card>
    );
}
