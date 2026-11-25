"use client";

import { Loader2, Pause, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { StoredPreviewStatus } from "./hooks/useStoredVoicePreview";

interface StoredVoicePreviewButtonProps {
    status: StoredPreviewStatus | null;
    onToggle: () => void;
    className?: string;
}

/** Sleek play / pause icon button for voice preview, positioned inside the selector beside the stack name. */
export function StoredVoicePreviewButton({ status, onToggle, className }: StoredVoicePreviewButtonProps) {
    const isPlaying = status === "playing";
    const isLoading = status === "loading";
    const label = isPlaying ? "Pause voice preview" : "Play voice preview";

    return (
        <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
                "h-6 w-6 rounded-full transition-all duration-150 shrink-0",
                isPlaying
                    ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
                    : "bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary",
                className
            )}
            title={label}
            aria-label={label}
            onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onToggle();
            }}
            onPointerDown={(e) => {
                e.stopPropagation();
            }}
            disabled={isLoading && status === null}
        >
            {isLoading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
            ) : isPlaying ? (
                <Pause className="h-3 w-3 fill-current" />
            ) : (
                <Play className="h-3 w-3 fill-current translate-x-px" />
            )}
        </Button>
    );
}
