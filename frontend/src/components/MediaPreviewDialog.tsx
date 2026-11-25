'use client';

import { FileText, Headphones, Loader2, Video } from 'lucide-react';
import posthog from 'posthog-js';
import { useCallback, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { PostHogEvent } from '@/constants/posthog-events';
import { resolveArtifactUrl } from '@/lib/apiClient';
import { downloadFile, getSignedUrl } from '@/lib/files';

type TranscriptStatus = 'loading' | 'ready' | 'not-available' | 'not-found' | 'empty' | 'error';

export function MediaPreviewDialog() {
    const [isOpen, setIsOpen] = useState(false);
    const [audioSignedUrl, setAudioSignedUrl] = useState<string | null>(null);
    const [videoSignedUrl, setVideoSignedUrl] = useState<string | null>(null);
    const [transcriptContent, setTranscriptContent] = useState<string | null>(null);
    const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
    const [recordingKey, setRecordingKey] = useState<string | null>(null);
    const [videoKey, setVideoKey] = useState<string | null>(null);
    const [transcriptKey, setTranscriptKey] = useState<string | null>(null);

    // Separate loading states for audio, video, and transcript
    const [audioLoading, setAudioLoading] = useState(false);
    const [audioError, setAudioError] = useState<string | null>(null);
    const [videoLoading, setVideoLoading] = useState(false);

    const [transcriptStatus, setTranscriptStatus] = useState<TranscriptStatus>('loading');
    const [transcriptErrorMsg, setTranscriptErrorMsg] = useState<string | null>(null);

    const openPreview = useCallback(
        async (
            recordingUrl: string | null,
            transcriptUrl: string | null,
            runId: number,
            videoUrl?: string | null,
        ) => {
            if (!recordingUrl && !transcriptUrl && !videoUrl) return;

            // Reset all state
            setAudioSignedUrl(null);
            setVideoSignedUrl(null);
            setTranscriptContent(null);
            setAudioError(null);
            setTranscriptErrorMsg(null);
            setRecordingKey(recordingUrl);
            setVideoKey(videoUrl ?? null);
            setTranscriptKey(transcriptUrl);
            setSelectedRunId(runId);
            setIsOpen(true);

            // Video fetch
            if (videoUrl) {
                setVideoLoading(true);
                if (videoUrl.includes('/api/v1/public/download/')) {
                    setVideoSignedUrl(resolveArtifactUrl(videoUrl));
                } else {
                    const videoResult = await getSignedUrl(videoUrl);
                    setVideoSignedUrl(videoResult);
                }
                setVideoLoading(false);
            }

            // Audio fetch
            if (recordingUrl) {
                setAudioLoading(true);
                const audioResult = await getSignedUrl(recordingUrl);
                if (!audioResult) {
                    setAudioError('Recording file not found in storage.');
                } else {
                    setAudioSignedUrl(audioResult);
                }
                setAudioLoading(false);
            }

            // Transcript fetch — always set a status
            if (!transcriptUrl) {
                setTranscriptStatus('not-available');
                return;
            }

            setTranscriptStatus('loading');
            const signedTranscriptUrl = await getSignedUrl(transcriptUrl, true);
            if (!signedTranscriptUrl) {
                setTranscriptStatus('not-found');
                setTranscriptErrorMsg('Transcript file not found in storage.');
                return;
            }

            try {
                const response = await fetch(signedTranscriptUrl);
                if (!response.ok) {
                    setTranscriptStatus('error');
                    setTranscriptErrorMsg(`Failed to load transcript (${response.status}).`);
                    return;
                }
                const text = await response.text();
                if (!text || text.trim().length === 0) {
                    setTranscriptStatus('empty');
                    return;
                }
                setTranscriptContent(text);
                setTranscriptStatus('ready');
                posthog.capture(PostHogEvent.TRANSCRIPT_VIEWED, {
                    run_id: runId,
                    source: 'media_preview_dialog',
                    transcript_length: text.length,
                });
            } catch (error) {
                console.error('Error fetching transcript:', error);
                setTranscriptStatus('error');
                setTranscriptErrorMsg('Network error loading transcript.');
            }
        },
        [],
    );

    const renderTranscriptSection = () => {
        switch (transcriptStatus) {
            case 'loading':
                return (
                    <div className="mt-4">
                        <h4 className="mb-2 text-sm font-semibold text-muted-foreground">Transcript</h4>
                        <div className="flex items-center justify-center gap-2 rounded-md border border-border/50 bg-muted/30 py-8">
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">Loading transcript...</span>
                        </div>
                    </div>
                );

            case 'ready':
                return (
                    <div className="mt-4">
                        <h4 className="mb-2 text-sm font-semibold text-muted-foreground">Transcript</h4>
                        <pre className="h-[40vh] w-full overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted p-4 font-mono text-sm leading-relaxed">
                            {transcriptContent}
                        </pre>
                    </div>
                );

            case 'not-available':
                return (
                    <div className="mt-4">
                        <h4 className="mb-2 text-sm font-semibold text-muted-foreground">Transcript</h4>
                        <div className="flex items-center justify-center gap-2 rounded-md border border-border/50 bg-muted/30 py-8">
                            <FileText className="h-4 w-4 text-muted-foreground/50" />
                            <span className="text-sm text-muted-foreground">Transcript not available for this call</span>
                        </div>
                    </div>
                );

            case 'not-found':
                return (
                    <div className="mt-4">
                        <h4 className="mb-2 text-sm font-semibold text-muted-foreground">Transcript</h4>
                        <div className="flex items-center justify-center gap-2 rounded-md border border-border/50 bg-muted/30 py-8">
                            <FileText className="h-4 w-4 text-destructive/60" />
                            <span className="text-sm text-destructive">{transcriptErrorMsg}</span>
                        </div>
                    </div>
                );

            case 'empty':
                return (
                    <div className="mt-4">
                        <h4 className="mb-2 text-sm font-semibold text-muted-foreground">Transcript</h4>
                        <div className="flex items-center justify-center gap-2 rounded-md border border-border/50 bg-muted/30 py-8">
                            <FileText className="h-4 w-4 text-muted-foreground/50" />
                            <span className="text-sm text-muted-foreground">Transcript is empty</span>
                        </div>
                    </div>
                );

            case 'error':
                return (
                    <div className="mt-4">
                        <h4 className="mb-2 text-sm font-semibold text-muted-foreground">Transcript</h4>
                        <div className="flex items-center justify-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 py-8">
                            <span className="text-sm text-destructive">{transcriptErrorMsg}</span>
                        </div>
                    </div>
                );

            default:
                return null;
        }
    };

    return {
        openPreview,
        dialog: (
            <Dialog open={isOpen} onOpenChange={setIsOpen}>
                <DialogContent className="sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>
                            Run Preview
                            {selectedRunId && ` - Run #${selectedRunId}`}
                        </DialogTitle>
                    </DialogHeader>

                    {/* Video section */}
                    {videoLoading && (
                        <div className="flex items-center justify-center py-8 space-x-2">
                            <Loader2 className="h-6 w-6 animate-spin text-primary" />
                            <span>Loading video...</span>
                        </div>
                    )}

                    {!videoLoading && videoSignedUrl && (
                        <div className="mt-4 space-y-1.5">
                            <h4 className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
                                <Video className="h-4 w-4 text-primary" /> Video Recording
                            </h4>
                            <div className="overflow-hidden rounded-lg bg-black border border-border">
                                <video
                                    src={videoSignedUrl}
                                    controls
                                    autoPlay
                                    className="w-full aspect-video rounded-lg"
                                />
                            </div>
                        </div>
                    )}

                    {/* Audio section — always renders if there is any outcome */}
                    {audioLoading && (
                        <div className="flex items-center justify-center py-8 space-x-2">
                            <Loader2 className="h-6 w-6 animate-spin" />
                            <span>Loading audio...</span>
                        </div>
                    )}

                    {!audioLoading && audioSignedUrl && !videoSignedUrl && (
                        <audio
                            src={audioSignedUrl}
                            controls
                            autoPlay
                            className="w-full mt-4"
                            onPlay={() => posthog.capture(PostHogEvent.RECORDING_PLAYED, {
                                run_id: selectedRunId,
                                source: 'media_preview_dialog',
                            })}
                            onError={() => setAudioError('Failed to load audio recording.')}
                        />
                    )}

                    {!audioLoading && audioError && !videoSignedUrl && (
                        <div className="flex items-center justify-center py-4 text-destructive text-sm">
                            {audioError}
                        </div>
                    )}

                    {!audioLoading && !videoLoading && !audioSignedUrl && !videoSignedUrl && !audioError && !recordingKey && !videoKey && !transcriptKey && (
                        <div className="flex items-center justify-center py-8 text-muted-foreground">
                            No recording or transcript available.
                        </div>
                    )}

                    {/* Transcript section — always rendered after media */}
                    {!audioLoading && !videoLoading && renderTranscriptSection()}

                    <DialogFooter className="pt-4">
                        <DialogClose asChild>
                            <Button variant="secondary">Close</Button>
                        </DialogClose>
                        <div className="flex gap-2">
                            {videoKey && (
                                <Button variant="outline" onClick={() => downloadFile(videoKey)}>
                                    Download Video
                                </Button>
                            )}
                            {recordingKey && (
                                <Button variant="outline" onClick={() => downloadFile(recordingKey)}>
                                    Download Recording
                                </Button>
                            )}
                            {transcriptKey && transcriptStatus !== 'not-available' && (
                                <Button variant="outline" onClick={() => downloadFile(transcriptKey)}>
                                    Download Transcript
                                </Button>
                            )}
                        </div>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        ),
    };
}

interface MediaPreviewButtonProps {
    recordingUrl: string | null | undefined;
    transcriptUrl: string | null | undefined;
    fallbackRecordingUrl?: string | null | undefined;
    videoUrl?: string | null | undefined;
    runId: number;
    onOpenPreview: (recordingUrl: string | null, transcriptUrl: string | null, runId: number, videoUrl?: string | null) => void;
    onSelect?: (runId: number) => void;
}

export function MediaPreviewButton({
    recordingUrl,
    transcriptUrl,
    fallbackRecordingUrl,
    videoUrl,
    runId,
    onOpenPreview,
    onSelect,
}: MediaPreviewButtonProps) {
    const effectiveRecordingUrl = recordingUrl ?? fallbackRecordingUrl ?? null;

    if (!effectiveRecordingUrl && !transcriptUrl && !videoUrl) return null;

    const handleOpen = () => {
        onSelect?.(runId);
        onOpenPreview(effectiveRecordingUrl, transcriptUrl ?? null, runId, videoUrl ?? null);
    };

    return (
        <Button
            variant="outline"
            size="icon"
            onClick={handleOpen}
            title={videoUrl ? "Preview video recording & transcript" : "Preview audio recording & transcript"}
        >
            {videoUrl ? <Video className="h-4 w-4 text-primary" /> : <Headphones className="h-4 w-4" />}
        </Button>
    );
}
