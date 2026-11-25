"use client";

import { useCallback, useEffect, useState } from "react";

import { getVoicesApiV1UserConfigurationsVoicesProviderGet } from "@/client/sdk.gen";
import type { GetVoicesApiV1UserConfigurationsVoicesProviderGetData, VoiceInfo } from "@/client/types.gen";
import logger from "@/lib/logger";

import { withResolvedGender } from "../voiceMatching";

interface UseProviderVoicesArgs {
    provider: string;
    model?: string;
    language?: string;
    /** Shown immediately, and kept as extras / fallback when the API has fewer voices. */
    staticVoices?: VoiceInfo[];
}

/** Voices of one provider (with stored preview URLs) from the catalog API. */
export function useProviderVoices({ provider, model, language, staticVoices }: UseProviderVoicesArgs) {
    const [voices, setVoices] = useState<VoiceInfo[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    const fetchVoices = useCallback(async () => {
        if (!provider) {
            setVoices([]);
            setIsLoading(false);
            return;
        }
        const fallback = staticVoices && staticVoices.length > 0 ? withResolvedGender(staticVoices, provider) : null;
        // Show static presets right away so the picker is never blank.
        if (fallback) setVoices(fallback);
        setIsLoading(true);

        try {
            const query: { model?: string; language?: string } = {};
            if (model) query.model = model;
            if (language) query.language = language;
            const response = await getVoicesApiV1UserConfigurationsVoicesProviderGet({
                // The endpoint accepts any registered provider name; the generated
                // client's provider union is narrower than the registry.
                path: {
                    provider: provider.toLowerCase() as GetVoicesApiV1UserConfigurationsVoicesProviderGetData["path"]["provider"],
                },
                query: Object.keys(query).length > 0 ? query : undefined,
            });

            const apiVoices = response.data?.voices ?? [];
            if (apiVoices.length > 0) {
                const dynamicList = withResolvedGender(apiVoices, provider);
                const seenIds = new Set(dynamicList.map((v) => v.voice_id));
                const extras = (fallback ?? []).filter((v) => !seenIds.has(v.voice_id));
                setVoices([...dynamicList, ...extras]);
            } else if (fallback) {
                setVoices(fallback);
            }
        } catch (err) {
            logger.error(`Failed to fetch voices: ${err}`);
            if (fallback) setVoices(fallback);
        } finally {
            setIsLoading(false);
        }
    }, [provider, model, language, staticVoices]);

    useEffect(() => {
        if (provider) fetchVoices();
    }, [provider, fetchVoices]);

    return { voices, isLoading };
}
