"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export type StoredPreviewStatus = "loading" | "playing" | "paused";

/**
 * Play / pause / resume one stored voice preview at a time. Playback stops
 * whenever any value in `resetKeys` changes (e.g. the selected voice) and on
 * unmount.
 */
export function useStoredVoicePreview(resetKeys: readonly unknown[]) {
    const audioRef = useRef<{ voiceId: string; audio: HTMLAudioElement } | null>(null);
    const [state, setState] = useState<{ voiceId: string; status: StoredPreviewStatus } | null>(null);

    const stop = useCallback(() => {
        const current = audioRef.current;
        if (current) {
            const { audio } = current;
            // Detach first: pause/error events fire async and would revive state.
            audio.onplaying = audio.onpause = audio.onended = audio.onerror = null;
            audio.pause();
            audio.removeAttribute("src");
        }
        audioRef.current = null;
        setState(null);
    }, []);

    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller-defined reset keys
    useEffect(() => stop, [stop, ...resetKeys]);

    const toggle = useCallback(
        (previewUrl: string, voiceId: string) => {
            const current = audioRef.current;
            if (current && current.voiceId === voiceId) {
                if (!current.audio.paused) {
                    current.audio.pause();
                    return;
                }
                setState({ voiceId, status: "loading" });
                current.audio.play().catch(stop);
                return;
            }

            stop();
            const audio = new Audio(previewUrl);
            audioRef.current = { voiceId, audio };
            setState({ voiceId, status: "loading" });
            audio.onplaying = () => setState({ voiceId, status: "playing" });
            audio.onpause = () => {
                if (!audio.ended) setState({ voiceId, status: "paused" });
            };
            // Finished: drop the clip so the next click starts from the beginning.
            audio.onended = stop;
            audio.onerror = (err) => {
                console.error("Voice preview failed to load audio from URL:", previewUrl, err);
                toast.error("Could not load preview audio. Check storage/network connection.");
                stop();
            };
            audio.play().catch((err) => {
                console.error("Voice preview play() rejected:", err);
                toast.error("Audio playback was blocked or failed to load.");
                stop();
            });
        },
        [stop],
    );

    const statusFor = useCallback(
        (voiceId: string | undefined): StoredPreviewStatus | null =>
            voiceId && state?.voiceId === voiceId ? state.status : null,
        [state],
    );

    return { toggle, statusFor };
}
