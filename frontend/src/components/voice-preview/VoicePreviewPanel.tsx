"use client";

import { Loader2, Pause, Play, Volume2 } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth";
import type { LocalUser } from "@/lib/auth/types";
import { cn } from "@/lib/utils";

import { MAX_PREVIEW_CHARS } from "./constants";
import { useVoicePreview, useVoicePreviewCapability } from "./hooks/useVoicePreview";
import { useVoicePreviewPlayback } from "./hooks/useVoicePreviewPlayback";
import { ReadAlongText } from "./ReadAlongText";
import { getDefaultPreviewText } from "./sampleText";
import type { VoicePreviewServiceType } from "./types";

const TEXT_BOX = "min-h-24 w-full px-3 py-2.5 text-sm leading-relaxed";

interface VoicePreviewPanelProps {
    /** Segment the form is editing: "sts" is the realtime / speech-to-speech tab. */
    serviceType: VoicePreviewServiceType;
    provider: string | undefined;
    model?: string;
    voice: string | undefined;
    /**
     * Service configuration exactly as the form would save it. Keys may be
     * masked; the backend restores them from the saved configuration.
     */
    config: Record<string, unknown>;
    /**
     * Admin model preset being edited. Its saved keys are used to restore the
     * masked key in `config`, since presets are not the organization's config.
     */
    modelConfigurationId?: number;
    /**
     * Sentence typed by the user, owned by the parent so it survives the panel
     * unmounting (e.g. switching form sections). `null` means "use the default
     * sample for the voice's language". Uncontrolled when omitted.
     */
    text?: string | null;
    onTextChange?: (text: string | null) => void;
    className?: string;
}

/**
 * Type a sentence, generate it, and hear the selected voice read it. The same
 * box holds the text while editing and the read-along while speaking. Until
 * the user types their own sentence, the box shows the default sample in the
 * voice's language and follows it when the language changes.
 */
export function VoicePreviewPanel({
    serviceType,
    provider,
    model,
    voice,
    config,
    modelConfigurationId,
    text: controlledText,
    onTextChange,
    className,
}: VoicePreviewPanelProps) {
    const { user } = useAuth();
    const isSuperAdmin = (user as LocalUser | null)?.is_superuser ?? false;
    const [localText, setLocalText] = useState<string | null>(null);
    const [generatedKey, setGeneratedKey] = useState<string | null>(null);
    const autoPlayRef = useRef(false);
    const { capability, capabilities, isLoading: isCheckingCapability } = useVoicePreviewCapability(
        serviceType,
        provider,
    );
    const { generate, result, isGenerating, error } = useVoicePreview();

    const language = typeof config.language === "string" ? config.language : undefined;
    const defaultText = getDefaultPreviewText(capabilities, language);
    const isControlled = onTextChange !== undefined;
    const storedText = isControlled ? (controlledText ?? null) : localText;
    const text = storedText ?? defaultText;
    // Keep the user's sentence; the default stays `null` so it follows the language.
    const setText = (value: string) => {
        const next = value === defaultText ? null : value;
        if (isControlled) onTextChange(next);
        else setLocalText(next);
    };

    const voiceForRequest = (voice ?? "").trim();
    const sentence = text.trim() || defaultText;
    // Any change to the text, voice or settings makes the clip out of date.
    const requestKey = JSON.stringify({ provider, model, voiceForRequest, config, sentence });
    const isUpToDate = generatedKey === requestKey;
    const audioUrl = isUpToDate && !isGenerating ? (result?.preview_url ?? null) : null;

    const playback = useVoicePreviewPlayback({ src: audioUrl, text: sentence, autoPlayRef });

    if (!provider || !voiceForRequest) return null;
    if (isCheckingCapability) return null;
    if (!capability?.supported) {
        return (
            <p className={cn("text-xs text-muted-foreground", className)}>
                {capability?.reason ?? "Voice previews are unavailable for this provider."}
            </p>
        );
    }

    const handleGenerate = () => {
        // Only the language's default sentence is shared with every
        // organization, so an edited sentence stays private to the
        // administrator's organization. The backend picks the same default.
        const isSharedPreview = isSuperAdmin && sentence === defaultText;
        autoPlayRef.current = true;
        setGeneratedKey(requestKey);
        void generate({
            serviceType,
            provider,
            model,
            voice: voiceForRequest,
            scope: isSharedPreview ? "global" : "organization",
            text: isSharedPreview ? undefined : sentence,
            config,
            modelConfigurationId,
        });
    };

    const textareaId = `voice-preview-${serviceType}-${provider}`;
    const playLabel = playback.isPlaying ? "Pause preview" : "Play preview";

    return (
        <div className={cn("space-y-1.5", className)}>
            <div className="flex items-center justify-between gap-2">
                <Label htmlFor={textareaId} className="text-xs font-medium">
                    Voice preview
                </Label>
                <span className="text-[11px] tabular-nums text-muted-foreground">
                    {text.length}/{MAX_PREVIEW_CHARS}
                </span>
            </div>

            <div className="overflow-hidden rounded-md border border-input bg-background focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
                {playback.isActive ? (
                    <ReadAlongText
                        className={TEXT_BOX}
                        words={playback.words}
                        activeIndex={playback.activeIndex}
                        onEdit={playback.isPlaying || playback.isLoading ? undefined : playback.stop}
                    />
                ) : (
                    <Textarea
                        id={textareaId}
                        value={text}
                        readOnly={isGenerating}
                        maxLength={MAX_PREVIEW_CHARS}
                        onChange={(event) => setText(event.target.value)}
                        placeholder={defaultText}
                        className={cn(
                            TEXT_BOX,
                            "resize-none rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent",
                        )}
                    />
                )}

                <div className="flex h-11 items-center justify-between gap-2 border-t border-border/60 px-2">
                    {audioUrl ? (
                        <Button
                            type="button"
                            size="icon"
                            className="h-8 w-8 rounded-full"
                            onClick={playback.toggle}
                            aria-label={playLabel}
                            title={playLabel}
                        >
                            {playback.isLoading && !playback.isPlaying ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : playback.isPlaying ? (
                                <Pause className="h-4 w-4 fill-current" />
                            ) : (
                                <Play className="h-4 w-4 translate-x-px fill-current" />
                            )}
                        </Button>
                    ) : (
                        <span aria-hidden />
                    )}
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={handleGenerate}
                        disabled={isGenerating || (isUpToDate && Boolean(audioUrl))}
                    >
                        {isGenerating ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <Volume2 className="h-4 w-4" />
                        )}
                        {isGenerating ? "Generating" : "Generate preview"}
                    </Button>
                </div>
            </div>

            {error && <p className="text-xs text-destructive">{error}</p>}
            {playback.hasError && (
                <p className="text-xs text-destructive">Could not play this preview.</p>
            )}
        </div>
    );
}
