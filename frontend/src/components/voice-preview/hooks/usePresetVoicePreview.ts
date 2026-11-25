"use client";

import { useEffect, useState } from "react";

import { getModelConfigurationOptionVoicePreviewApiV1OrganizationsModelConfigurationOptionsConfigIdVoicePreviewGet as fetchPresetVoicePreview } from "@/client/sdk.gen";
import type { PresetVoicePreviewResponse } from "@/client/types.gen";
import { detailFromError } from "@/lib/apiError";
import { useAuth } from "@/lib/auth";

export interface UsePresetVoicePreviewResult {
    preview: PresetVoicePreviewResponse | null;
    isLoading: boolean;
    error: string | null;
}

/**
 * Stored voice preview of a model preset ("model stack"). Re-fetches whenever
 * the selected preset changes; stale responses are ignored.
 */
export function usePresetVoicePreview(presetId: number | null): UsePresetVoicePreviewResult {
    const { user, loading: authLoading } = useAuth();
    const [preview, setPreview] = useState<PresetVoicePreviewResponse | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setPreview(null);
        setError(null);
        if (authLoading || !user || presetId === null) {
            setIsLoading(false);
            return;
        }

        let active = true;
        setIsLoading(true);
        fetchPresetVoicePreview({ path: { config_id: presetId } })
            .then((response) => {
                if (!active) return;
                if (response.error) {
                    setError(detailFromError(response.error, "Could not load the voice preview"));
                    return;
                }
                setPreview(response.data ?? null);
            })
            .catch((err) => {
                if (active) setError(detailFromError(err, "Could not load the voice preview"));
            })
            .finally(() => {
                if (active) setIsLoading(false);
            });

        return () => {
            active = false;
        };
    }, [presetId, user, authLoading]);

    return { preview, isLoading, error };
}
