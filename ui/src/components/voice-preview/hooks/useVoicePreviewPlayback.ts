"use client";

import type { RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** Spoken characters per second, used only when the file reports no duration. */
const FALLBACK_CHARS_PER_SECOND = 14;

interface UseVoicePreviewPlaybackArgs {
    /** Signed URL of the stored audio; null while there is nothing to play. */
    src: string | null;
    /** Sentence the audio speaks. */
    text: string;
    /** Set true to start the next clip on load. Cleared once it is used. */
    autoPlayRef: RefObject<boolean>;
}

/**
 * Play / pause one preview clip and report which word is being spoken.
 * Providers return no word timings, so each word's slot is proportional to its
 * length, which is close enough for a short sample sentence.
 */
export function useVoicePreviewPlayback({ src, text, autoPlayRef }: UseVoicePreviewPlaybackArgs) {
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const frameRef = useRef<number | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [hasError, setHasError] = useState(false);

    const words = useMemo(() => text.split(/\s+/).filter(Boolean), [text]);
    /** Fraction of the clip at which each word finishes. */
    const wordEnds = useMemo(() => {
        const weights = words.map((word) => word.length + 1);
        const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
        let running = 0;
        return weights.map((weight) => (running += weight) / total);
    }, [words]);
    const estimatedDuration = Math.max(1, text.length / FALLBACK_CHARS_PER_SECOND);

    const stopTicking = () => {
        if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
    };

    const tick = () => {
        const audio = audioRef.current;
        if (!audio) return;
        // Some Ogg files report Infinity until fully buffered.
        const hasDuration = Number.isFinite(audio.duration) && audio.duration > 0;
        const duration = hasDuration ? audio.duration : estimatedDuration;
        setProgress(Math.min(1, audio.currentTime / duration));
        frameRef.current = requestAnimationFrame(tick);
    };

    useEffect(() => {
        setProgress(0);
        setIsPlaying(false);
        setIsLoading(false);
        setHasError(false);
        if (!src) return;

        const audio = new Audio(src);
        const autoPlay = autoPlayRef.current;
        audio.preload = autoPlay ? "auto" : "metadata";
        audioRef.current = audio;

        audio.onplaying = () => {
            setIsLoading(false);
            setIsPlaying(true);
            stopTicking();
            frameRef.current = requestAnimationFrame(tick);
        };
        audio.onpause = () => {
            setIsPlaying(false);
            stopTicking();
        };
        audio.onended = () => {
            setIsPlaying(false);
            setProgress(1);
            stopTicking();
        };
        audio.onwaiting = () => setIsLoading(true);
        audio.onerror = () => {
            setIsLoading(false);
            setIsPlaying(false);
            setHasError(true);
            stopTicking();
        };

        if (autoPlay) {
            autoPlayRef.current = false;
            setIsLoading(true);
            audio.play().catch(() => setIsLoading(false));
        }

        return () => {
            stopTicking();
            audio.onplaying = audio.onpause = audio.onended = audio.onwaiting = audio.onerror = null;
            audio.pause();
            audio.src = "";
            audioRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- tick reads refs only
    }, [src]);

    const toggle = useCallback(() => {
        const audio = audioRef.current;
        if (!audio) return;
        if (isPlaying) {
            audio.pause();
            return;
        }
        // Replay from the start once the clip has finished.
        if (audio.ended || progress >= 1) {
            audio.currentTime = 0;
            setProgress(0);
        }
        setHasError(false);
        setIsLoading(true);
        audio.play().catch(() => {
            setIsLoading(false);
            setHasError(true);
        });
    }, [isPlaying, progress]);

    /** Return to the start without playing, so the text can be edited again. */
    const stop = useCallback(() => {
        const audio = audioRef.current;
        if (!audio) return;
        audio.pause();
        audio.currentTime = 0;
        setProgress(0);
    }, []);

    const finished = progress >= 1;
    const activeIndex = progress <= 0 || finished ? -1 : wordEnds.findIndex((end) => progress < end);
    const isActive = isPlaying || isLoading || (progress > 0 && !finished);

    return { words, activeIndex, isPlaying, isLoading, isActive, hasError, toggle, stop };
}
