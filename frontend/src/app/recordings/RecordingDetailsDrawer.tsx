"use client";

import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { getSignedUrlApiV1S3SignedUrlGet } from "@/client/sdk.gen";
import type { RecordingResponseSchema } from "@/client/types.gen";
import { Button } from "@/components/ui/button";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { UnderlineTabs } from "@/components/ui/underline-tabs";
import { LANGUAGE_DISPLAY_NAMES } from "@/constants/languages";

interface RecordingDetailsDrawerProps {
    recording: RecordingResponseSchema | null;
    onOpenChange: (open: boolean) => void;
    initialPlay?: boolean;
    onPlayingStateChange?: (isPlaying: boolean) => void;
    toggleAudioTrigger?: number;
}

type RecordingDrawerTab = "transcription" | "player";

const TABS = [
    { value: "transcription", label: "Transcript" },
    { value: "player", label: "Audio Player" },
];

/** Surface of every card in the drawer (identical to the Org, Tool and Lead drawers). */
const DRAWER_CARD = "rounded-lg border border-border bg-card p-4 shadow-xs";

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

function getRecordingName(rec: RecordingResponseSchema): string {
    const fullFilename = (rec.metadata?.original_filename as string) || "";
    return fullFilename ? fullFilename.replace(/\.[^.]+$/, "") : "—";
}

export function RecordingDetailsDrawer({
    recording,
    onOpenChange,
    initialPlay = false,
    onPlayingStateChange,
    toggleAudioTrigger = 0,
}: RecordingDetailsDrawerProps) {
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [activeView, setActiveView] = useState<RecordingDrawerTab>("transcription");
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [isMuted, setIsMuted] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    // Reset player state when recording changes
    useEffect(() => {
        setIsPlaying(false);
        setCurrentTime(0);
        setDuration(0);
        setAudioUrl(null);
        setActiveView("transcription");

        if (!recording || !recording.storage_key) return;

        let active = true;
        getSignedUrlApiV1S3SignedUrlGet({
            query: {
                key: recording.storage_key,
                storage_backend: recording.storage_backend,
            },
        }).then((result) => {
            if (active && result.data?.url) {
                setAudioUrl(result.data.url);
            }
        }).catch((err) => {
            console.error("Failed to get signed URL:", err);
        });

        return () => {
            active = false;
        };
    }, [recording]);

    // Handle initialPlay autoplay when audio is loaded
    useEffect(() => {
        if (initialPlay && audioUrl && audioRef.current) {
            setActiveView("player");
            setIsPlaying(true);
            audioRef.current.play().catch((err) => {
                console.error("Autoplay failed:", err);
                setIsPlaying(false);
            });
        }
    }, [initialPlay, audioUrl]);

    const togglePlay = useCallback(() => {
        if (!audioRef.current) return;
        if (isPlaying) {
            audioRef.current.pause();
            setIsPlaying(false);
        } else {
            setIsPlaying(true);
            audioRef.current.play().catch((err) => {
                console.error("Play failed:", err);
                setIsPlaying(false);
            });
        }
    }, [isPlaying]);

    // Listen to parent toggle audio triggers
    useEffect(() => {
        if (toggleAudioTrigger > 0 && audioRef.current) {
            setActiveView("player");
            togglePlay();
        }
    }, [toggleAudioTrigger, togglePlay]);

    // Notify parent of playing state changes
    useEffect(() => {
        if (onPlayingStateChange) {
            onPlayingStateChange(isPlaying);
        }
    }, [isPlaying, onPlayingStateChange]);

    const handleTimeUpdate = () => {
        if (audioRef.current) {
            setCurrentTime(audioRef.current.currentTime);
        }
    };

    const handleLoadedMetadata = () => {
        if (audioRef.current) {
            setDuration(audioRef.current.duration);
        }
    };

    const handleAudioEnded = () => {
        setIsPlaying(false);
        setCurrentTime(0);
    };

    const handleScrub = (value: number) => {
        if (audioRef.current) {
            audioRef.current.currentTime = value;
            setCurrentTime(value);
        }
    };

    const toggleMute = () => {
        if (audioRef.current) {
            audioRef.current.muted = !isMuted;
            setIsMuted(!isMuted);
        }
    };

    const formatTime = (time: number): string => {
        if (isNaN(time)) return "0:00";
        const minutes = Math.floor(time / 60);
        const seconds = Math.floor(time % 60);
        return `${minutes}:${seconds.toString().padStart(2, "0")}`;
    };

    const fileFormat = ((recording?.metadata?.original_filename as string) || "").split(".").pop()?.toUpperCase() || "—";
    const languageCode = (recording?.metadata?.language as string) || "";
    const language = LANGUAGE_DISPLAY_NAMES[languageCode] || languageCode || "—";

    return (
        <Sheet open={!!recording} onOpenChange={onOpenChange}>
            <SheetContent side="right">
                <SheetHeader>
                    {recording && (
                        <>
                            <SheetTitle className="truncate pr-10 text-base">
                                Recording #{recording.id} — {getRecordingName(recording)}
                            </SheetTitle>
                            <SheetDescription className="sr-only">
                                Transcript and audio player for recording {recording.recording_id}
                            </SheetDescription>
                        </>
                    )}
                </SheetHeader>

                {recording && (
                    <Tabs
                        value={activeView}
                        onValueChange={(value) => setActiveView(value as RecordingDrawerTab)}
                        className="flex min-h-0 flex-1 flex-col gap-0"
                    >
                        <audio
                            ref={audioRef}
                            src={audioUrl || undefined}
                            onPlay={() => setIsPlaying(true)}
                            onPause={() => setIsPlaying(false)}
                            onTimeUpdate={handleTimeUpdate}
                            onLoadedMetadata={handleLoadedMetadata}
                            onEnded={handleAudioEnded}
                        />

                        {/* Tab bar stays fixed under the drawer title. */}
                        <div className="shrink-0 border-b border-border px-4 pb-3">
                            <UnderlineTabs
                                value={activeView}
                                onValueChange={(value) => setActiveView(value as RecordingDrawerTab)}
                                items={TABS}
                            />
                        </div>

                        <SheetBody className="px-4 py-4">
                            <TabsContent value="transcription" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
                                <DetailSection title="Recording" description="File details; read-only.">
                                    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                                        <DetailField label="Recording ID" mono>{recording.recording_id}</DetailField>
                                        <DetailField label="Language">{language}</DetailField>
                                        <DetailField label="Format" mono>{fileFormat}</DetailField>
                                    </div>
                                </DetailSection>

                                <DetailSection title="Transcript" description="What is said in this recording.">
                                    {recording.transcript ? (
                                        <p className="select-text whitespace-pre-wrap text-xs leading-relaxed text-foreground">
                                            {recording.transcript}
                                        </p>
                                    ) : (
                                        <p className="text-xs text-muted-foreground">No transcript available.</p>
                                    )}
                                </DetailSection>
                            </TabsContent>

                            <TabsContent value="player" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
                                <DetailSection
                                    title="Audio player"
                                    description="Play back the recorded audio."
                                    action={
                                        <span className="shrink-0 font-mono text-xs text-muted-foreground">
                                            {formatTime(currentTime)} / {formatTime(duration)}
                                        </span>
                                    }
                                >
                                    <input
                                        type="range"
                                        min={0}
                                        max={duration || 100}
                                        value={currentTime}
                                        onChange={(e) => handleScrub(Number(e.target.value))}
                                        aria-label="Seek"
                                        className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-muted accent-primary"
                                    />

                                    <div className="flex items-center gap-2">
                                        <Button
                                            variant="outline"
                                            size="icon"
                                            onClick={togglePlay}
                                            className="h-8 w-8 shrink-0"
                                            disabled={!audioUrl}
                                            aria-label={isPlaying ? "Pause" : "Play"}
                                        >
                                            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={toggleMute}
                                            className="h-8 w-8 shrink-0 text-muted-foreground"
                                            disabled={!audioUrl}
                                            aria-label={isMuted ? "Unmute" : "Mute"}
                                        >
                                            {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                                        </Button>
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
