"use client";

import { Loader2, Mic, Square, Upload, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
    createRecordingsApiV1WorkflowRecordingsPost,
    getUploadUrlsApiV1WorkflowRecordingsUploadUrlPost,
    transcribeAudioApiV1WorkflowRecordingsTranscribePost,
} from "@/client";
import type { RecordingUploadResponseSchema } from "@/client/types.gen";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { LANGUAGE_DISPLAY_NAMES } from "@/constants/languages";
import { cn } from "@/lib/utils";

interface RecordingsUploadDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onUploadComplete?: () => void;
}

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

interface PendingFile {
    id: string;
    file: File;
    transcript: string;
    isTranscribing: boolean;
    error?: string;
}

let pendingFileCounter = 0;

export const RecordingsUploadDialog = ({
    open,
    onOpenChange,
    onUploadComplete,
}: RecordingsUploadDialogProps) => {
    const [activeTab, setActiveTab] = useState<"uploaded" | "record">("uploaded");
    const [uploading, setUploading] = useState(false);
    const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [language, setLanguage] = useState("multi");
    const [langSearch, setLangSearch] = useState("");
    const [recordingStep, setRecordingStep] = useState<"idle" | "naming" | "recording">("idle");
    const [recordingFilename, setRecordingFilename] = useState("");
    const [recordingDuration, setRecordingDuration] = useState(0);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const languageRef = useRef(language);
    languageRef.current = language;


    const stopRecordingTimer = useCallback(() => {
        if (recordingTimerRef.current) {
            clearInterval(recordingTimerRef.current);
            recordingTimerRef.current = null;
        }
    }, []);

    const stopRecording = useCallback(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
            mediaRecorderRef.current.stop();
        }
    }, []);

    const resetRecordingState = useCallback(() => {
        setRecordingStep("idle");
        setRecordingFilename("");
        setRecordingDuration(0);
    }, []);

    useEffect(() => {
        if (open) {
            setError(null);
            setPendingFiles([]);
            setLanguage("multi");
            resetRecordingState();
            setActiveTab("uploaded");
        }
    }, [open, resetRecordingState]);

    useEffect(() => {
        if (!open) {
            stopRecording();
            stopRecordingTimer();
        }
    }, [open, stopRecording, stopRecordingTimer]);

    const transcribeFile = async (pendingId: string, file: File) => {
        setPendingFiles((prev) =>
            prev.map((p) => (p.id === pendingId ? { ...p, isTranscribing: true } : p))
        );
        try {
            const currentLang = languageRef.current;
            const result = await transcribeAudioApiV1WorkflowRecordingsTranscribePost({
                body: { file, language: currentLang },
            });
            const data = result.data as Record<string, unknown> | undefined;
            if (data?.transcript) {
                setPendingFiles((prev) =>
                    prev.map((p) =>
                        p.id === pendingId ? { ...p, transcript: data.transcript as string, isTranscribing: false } : p
                    )
                );
            } else {
                setPendingFiles((prev) =>
                    prev.map((p) => (p.id === pendingId ? { ...p, isTranscribing: false } : p))
                );
            }
        } catch {
            setPendingFiles((prev) =>
                prev.map((p) =>
                    p.id === pendingId
                        ? { ...p, isTranscribing: false, error: "Auto-transcription failed" }
                        : p
                )
            );
        }
    };

    const addPendingFiles = (files: File[]) => {
        const valid: PendingFile[] = [];
        for (const file of files) {
            if (file.size > MAX_FILE_SIZE) {
                setError(`${file.name} (${(file.size / (1024 * 1024)).toFixed(1)}MB) exceeds 5MB limit - skipped.`);
                continue;
            }
            const id = `pending-${++pendingFileCounter}`;
            valid.push({ id, file, transcript: "", isTranscribing: false });
        }
        if (valid.length === 0) return;
        setPendingFiles((prev) => [...prev, ...valid]);
        setError(null);
        for (const pf of valid) {
            transcribeFile(pf.id, pf.file);
        }
    };

    const removePendingFile = (pendingId: string) => {
        setPendingFiles((prev) => prev.filter((p) => p.id !== pendingId));
    };

    const updateTranscript = (pendingId: string, transcript: string) => {
        setPendingFiles((prev) =>
            prev.map((p) => (p.id === pendingId ? { ...p, transcript } : p))
        );
    };

    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mediaRecorder = new MediaRecorder(stream);
            mediaRecorderRef.current = mediaRecorder;
            audioChunksRef.current = [];

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) audioChunksRef.current.push(e.data);
            };

            const filename = recordingFilename.trim() || "recording";
            mediaRecorder.onstop = () => {
                stream.getTracks().forEach((t) => t.stop());
                stopRecordingTimer();

                const blob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType });
                if (blob.size > MAX_FILE_SIZE) {
                    setError(`Recording (${(blob.size / (1024 * 1024)).toFixed(1)}MB) exceeds the maximum allowed size of 5MB.`);
                    resetRecordingState();
                    return;
                }
                const ext = mediaRecorder.mimeType.includes("webm") ? "webm" : "mp4";
                const file = new File([blob], `${filename}.${ext}`, { type: mediaRecorder.mimeType });
                resetRecordingState();
                addPendingFiles([file]);
            };

            mediaRecorder.start();
            setRecordingStep("recording");
            setRecordingDuration(0);
            setError(null);
            recordingTimerRef.current = setInterval(() => {
                setRecordingDuration((d) => d + 1);
            }, 1000);
        } catch {
            setError("Microphone access denied. Please allow microphone permissions.");
            resetRecordingState();
        }
    };

    const handleFileSelect = (fileList: FileList | null) => {
        if (!fileList || fileList.length === 0) return;
        addPendingFiles(Array.from(fileList));
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    const handleUpload = async () => {
        const ready = pendingFiles.filter((p) => p.transcript.trim() && !p.isTranscribing);
        if (ready.length === 0) return;

        setUploading(true);
        setError(null);

        try {
            const uploadUrlResponse = await getUploadUrlsApiV1WorkflowRecordingsUploadUrlPost({
                body: {
                    files: ready.map((p) => ({
                        filename: p.file.name,
                        mime_type: p.file.type || "audio/wav",
                        file_size: p.file.size,
                    })),
                },
            });

            if (!uploadUrlResponse.data?.items) {
                throw new Error("Failed to get upload URLs");
            }

            const items = uploadUrlResponse.data.items;

            await Promise.all(
                items.map(async (item: RecordingUploadResponseSchema, idx: number) => {
                    const file = ready[idx].file;
                    const uploadResponse = await fetch(item.upload_url, {
                        method: "PUT",
                        body: file,
                        headers: { "Content-Type": file.type || "audio/wav" },
                    });
                    if (!uploadResponse.ok) {
                        throw new Error(`File upload failed for ${file.name}`);
                    }
                })
            );

            await createRecordingsApiV1WorkflowRecordingsPost({
                body: {
                    recordings: items.map((item: RecordingUploadResponseSchema, idx: number) => ({
                        recording_id: item.recording_id,
                        transcript: ready[idx].transcript.trim(),
                        storage_key: item.storage_key,
                        metadata: {
                            original_filename: ready[idx].file.name,
                            file_size_bytes: ready[idx].file.size,
                            mime_type: ready[idx].file.type,
                            language,
                        },
                    })),
                },
            });

            setPendingFiles([]);
            setLanguage("multi");
            resetRecordingState();
            if (fileInputRef.current) fileInputRef.current.value = "";
            onUploadComplete?.();
            onOpenChange(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to upload recordings");
        } finally {
            setUploading(false);
        }
    };

    const isRecording = recordingStep === "recording";
    const anyTranscribing = pendingFiles.some((p) => p.isTranscribing);
    const readyCount = pendingFiles.filter((p) => p.transcript.trim() && !p.isTranscribing).length;
    const isBusy = uploading || isRecording || anyTranscribing;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-[420px] max-h-[85vh] overflow-y-auto p-0 flex flex-col gap-0 border-0 shadow-lg sm:rounded-xl [&>button]:bg-muted [&>button]:rounded-md [&>button]:h-7 [&>button]:w-7 [&>button]:flex [&>button]:items-center [&>button]:justify-center [&>button]:top-5 [&>button]:right-5">
                <div className="flex flex-col gap-0.5 py-3.5 px-5 shrink-0 border-b pr-14">
                    <DialogTitle className="text-sm font-semibold text-foreground leading-tight">Upload Recordings</DialogTitle>
                    <p className="text-xs text-muted-foreground truncate">Upload or record audio files for your agents</p>
                </div>

                <div className="p-5 flex flex-col gap-5">
                    <div className="space-y-1.5">
                        <Label className="text-xs font-medium text-foreground">Language</Label>
                        <Select value={language} onValueChange={(v) => { setLanguage(v); setLangSearch(""); }}>
                            <SelectTrigger className="h-9 text-sm w-full bg-background">
                                <SelectValue placeholder="Language" />
                            </SelectTrigger>
                            <SelectContent className="max-h-[220px]">
                                <div className="px-2 pb-1.5 pt-1 sticky top-0 bg-popover z-10">
                                    <Input
                                        placeholder="Search language..."
                                        value={langSearch}
                                        onChange={(e) => setLangSearch(e.target.value)}
                                        className="h-7 text-xs"
                                        autoFocus
                                    />
                                </div>
                                {Object.entries(LANGUAGE_DISPLAY_NAMES)
                                    .filter(([, name]) => name.toLowerCase().includes(langSearch.toLowerCase()))
                                    .map(([code, name]) => (
                                        <SelectItem key={code} value={code}>
                                            {name}
                                        </SelectItem>
                                    ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "uploaded" | "record")} className="w-full">
                        <TabsList className="h-9 w-full grid grid-cols-2 bg-muted/50 p-0.5 mb-4">
                            <TabsTrigger value="uploaded" className="h-8 text-xs font-medium">Uploaded</TabsTrigger>
                            <TabsTrigger value="record" className="h-8 text-xs font-medium">Record</TabsTrigger>
                        </TabsList>

                        <TabsContent value="uploaded" className="mt-0">
                            <div>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="audio/*"
                                    multiple
                                    onChange={(e) => handleFileSelect(e.target.files)}
                                    className="hidden"
                                />
                                <div
                                     onClick={() => !isBusy && fileInputRef.current?.click()}
                                     className={cn(
                                         "theme-dashed-upload flex flex-col items-center justify-center p-5 border border-dashed rounded-lg transition-colors min-h-[140px]",
                                         isBusy ? "opacity-50 cursor-not-allowed bg-muted/10" : "cursor-pointer hover:bg-muted/30 hover:border-primary/40 bg-muted/5"
                                     )}
                                 >
                                     <div className="theme-upload-icon-container flex items-center justify-center mb-2 h-8 w-8 rounded-full bg-primary/10 text-primary">
                                         <Upload className="w-4 h-4" />
                                     </div>
                                    <h3 className="font-medium text-xs mb-0.5 text-foreground">Click to upload audio</h3>
                                    <p className="text-[11px] text-muted-foreground">Max 5MB per file</p>
                                </div>
                            </div>
                        </TabsContent>

                        <TabsContent value="record" className="mt-0 space-y-3">
                             {recordingStep === "recording" ? (
                                 <div className="theme-dashed-upload flex flex-col items-center justify-center p-5 border border-dashed rounded-lg bg-muted/5 min-h-[120px]">
                                    <div className="flex items-center justify-center gap-3 mb-4">
                                        <span className="relative flex h-3 w-3">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                                            <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
                                        </span>
                                        <div className="text-2xl font-mono font-light text-foreground">
                                            {Math.floor(recordingDuration / 60)}:{(recordingDuration % 60).toString().padStart(2, "0")}
                                        </div>
                                    </div>
                                    <Button
                                        size="sm"
                                        variant="destructive"
                                        onClick={() => stopRecording()}
                                        className="w-full max-w-[160px] rounded-md h-8 text-xs"
                                    >
                                        <Square className="w-3.5 h-3.5 mr-1.5" />
                                        Stop Recording
                                    </Button>
                                </div>
                            ) : (
                                <>
                                    <div className="space-y-1">
                                        <Label className="text-xs font-medium text-foreground">Recording Name</Label>
                                        <Input
                                            placeholder="e.g. greeting-message"
                                            value={recordingFilename}
                                            onChange={(e) => setRecordingFilename(e.target.value)}
                                            className="h-8 text-xs bg-background w-full"
                                            autoFocus
                                        />
                                    </div>
                                     <div className="theme-dashed-upload flex flex-col items-center justify-center p-5 border border-dashed rounded-lg bg-muted/5 min-h-[100px]">
                                        <div className="theme-upload-icon-container flex items-center justify-center mb-3 h-8 w-8 rounded-full bg-primary/10 text-primary">
                                            <Mic className="w-4 h-4" />
                                        </div>
                                        <Button
                                            size="sm"
                                            onClick={startRecording}
                                            disabled={!recordingFilename.trim() || uploading || anyTranscribing}
                                            className="w-full max-w-[180px] rounded-md h-8 text-xs"
                                        >
                                            <Mic className="w-3.5 h-3.5 mr-1.5" />
                                            Start Recording
                                        </Button>
                                    </div>
                                </>
                            )}
                        </TabsContent>
                    </Tabs>

                    {error && (
                        <div className="text-xs text-destructive bg-destructive/10 rounded-md p-2.5 border border-destructive/20">
                            {error}
                        </div>
                    )}

                    {pendingFiles.length > 0 && (
                        <div className="space-y-2">
                            <Label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                                Pending ({pendingFiles.length})
                            </Label>
                            {pendingFiles.map((pf) => (
                                <div key={pf.id} className="rounded-[var(--radius)] border-[length:var(--surface-border-width)] border-border p-2 space-y-2 bg-card text-card-foreground shadow-surface font-semibold">
                                    <div className="flex items-center gap-2">
                                        <code className="text-[11px] bg-background border px-1.5 py-0.5 rounded font-mono truncate flex-1 shadow-sm">
                                            {pf.file.name} ({(pf.file.size / (1024 * 1024)).toFixed(1)}MB)
                                        </code>
                                        {pf.isTranscribing && (
                                            <Loader2 className="w-3 h-3 animate-spin text-muted-foreground shrink-0" />
                                        )}
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-5 w-5 p-0 shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted"
                                            onClick={() => removePendingFile(pf.id)}
                                            disabled={uploading}
                                        >
                                            <X className="w-3 h-3" />
                                        </Button>
                                    </div>
                                    {pf.error && (
                                        <p className="text-[11px] text-destructive">{pf.error}</p>
                                    )}
                                    <Textarea
                                        placeholder={pf.isTranscribing ? "Transcribing..." : "Transcript text"}
                                        value={pf.transcript}
                                        onChange={(e) => updateTranscript(pf.id, e.target.value)}
                                        disabled={pf.isTranscribing}
                                        rows={2}
                                        className="resize-none text-xs min-h-[50px] p-2"
                                    />
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="flex items-center justify-end gap-2 border-t p-3 bg-muted/20 shrink-0">
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() => onOpenChange(false)}
                        disabled={isBusy}
                    >
                        Cancel
                    </Button>
                    <Button
                        size="sm"
                        className="h-8 text-xs px-4"
                        onClick={handleUpload}
                        disabled={readyCount === 0 || isBusy}
                    >
                        {uploading ? (
                            <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                        ) : (
                            <Upload className="w-3.5 h-3.5 mr-1.5" />
                        )}
                        {uploading
                            ? "Uploading..."
                            : `Upload ${readyCount} Recording${readyCount !== 1 ? "s" : ""}`}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};
