"use client";

import { useCallback, useEffect, useState } from "react";

import {
    createVoicePreviewApiV1VoicePreviewsPost,
    getVoicePreviewCapabilitiesApiV1VoicePreviewsCapabilitiesGet,
} from "@/client/sdk.gen";
import { detailFromError } from "@/lib/apiError";

import type {
    VoicePreviewCapabilities,
    VoicePreviewCapability,
    VoicePreviewResult,
    VoicePreviewScope,
    VoicePreviewServiceType,
} from "../types";

/** Provider capabilities are static for a session, so fetch them once. */
let capabilitiesPromise: Promise<VoicePreviewCapabilities | null> | null = null;

async function fetchCapabilities(): Promise<VoicePreviewCapabilities | null> {
    const response = await getVoicePreviewCapabilitiesApiV1VoicePreviewsCapabilitiesGet();
    if (response.error) return null;
    return (response.data as VoicePreviewCapabilities) ?? null;
}

function loadCapabilities(): Promise<VoicePreviewCapabilities | null> {
    if (!capabilitiesPromise) {
        capabilitiesPromise = fetchCapabilities().catch(() => null);
    }
    return capabilitiesPromise;
}

/**
 * Whether `provider` can render a preview for `serviceType`, plus the full
 * capabilities (which also carry the per-language default samples).
 *
 * Returns `null` while capabilities are unknown so callers can stay hidden
 * rather than flash an unsupported state.
 */
export function useVoicePreviewCapability(
    serviceType: VoicePreviewServiceType,
    provider: string | undefined,
): {
    capability: VoicePreviewCapability | null;
    capabilities: VoicePreviewCapabilities | null;
    isLoading: boolean;
} {
    const [capabilities, setCapabilities] = useState<VoicePreviewCapabilities | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let active = true;
        loadCapabilities().then((result) => {
            if (!active) return;
            setCapabilities(result);
            setIsLoading(false);
        });
        return () => {
            active = false;
        };
    }, []);

    if (!capabilities || !provider) {
        return { capability: null, capabilities, isLoading };
    }
    const capability = capabilities.providers?.[serviceType]?.[provider.toLowerCase()];
    return { capability: capability ?? null, capabilities, isLoading: false };
}

export interface GeneratePreviewArgs {
    serviceType: VoicePreviewServiceType;
    provider: string;
    model?: string;
    voice: string;
    scope: VoicePreviewScope;
    text?: string;
    config: Record<string, unknown>;
    /** Admin model preset whose saved keys restore masked ones in `config`. */
    modelConfigurationId?: number;
}

export interface UseVoicePreviewResult {
    generate: (args: GeneratePreviewArgs) => Promise<void>;
    result: VoicePreviewResult | null;
    isGenerating: boolean;
    error: string | null;
    reset: () => void;
}

/**
 * Trigger a preview render and keep the resulting audio around for playback.
 * The audio is stored server-side (object storage), never downloaded here.
 */
export function useVoicePreview(): UseVoicePreviewResult {
    const [result, setResult] = useState<VoicePreviewResult | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const generate = useCallback(async (args: GeneratePreviewArgs) => {
        setIsGenerating(true);
        setError(null);
        try {
            const response = await createVoicePreviewApiV1VoicePreviewsPost({
                body: {
                    service_type: args.serviceType,
                    provider: args.provider,
                    model: args.model ?? "",
                    voice: args.voice,
                    scope: args.scope,
                    text: args.text || null,
                    config: args.config,
                    model_configuration_id: args.modelConfigurationId ?? null,
                },
            });
            if (response.error) {
                setResult(null);
                setError(detailFromError(response.error, "Could not generate the voice preview"));
                return;
            }
            setResult((response.data as VoicePreviewResult) ?? null);
        } catch (err) {
            setResult(null);
            setError(detailFromError(err, "Could not generate the voice preview"));
        } finally {
            setIsGenerating(false);
        }
    }, []);

    const reset = useCallback(() => {
        setResult(null);
        setError(null);
    }, []);

    return { generate, result, isGenerating, error, reset };
}
