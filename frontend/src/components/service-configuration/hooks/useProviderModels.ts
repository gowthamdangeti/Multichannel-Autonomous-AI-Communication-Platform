"use client";

import { useEffect, useState } from "react";

import { getProviderModelsApiV1UserConfigurationsModelsProviderGet } from "@/client/sdk.gen";
import type { ModelOptionSchema } from "@/client/types.gen";
import { useAuth } from "@/lib/auth";

import type { ServiceSegment } from "../types";

type ModelService = Exclude<ServiceSegment, "embeddings">;

/** Models of one provider from the catalog API. Empty until loaded or on failure. */
export function useProviderModels(service: ServiceSegment, provider?: string) {
    const { user, loading: authLoading } = useAuth();
    const [models, setModels] = useState<ModelOptionSchema[]>([]);

    useEffect(() => {
        setModels([]);
        if (service === "embeddings" || !provider || authLoading || !user) return;
        // A slower answer for the previous provider must not replace this one.
        let cancelled = false;
        void getProviderModelsApiV1UserConfigurationsModelsProviderGet({
            path: { provider: provider.toLowerCase() },
            query: { capability: service as ModelService },
        })
            .then((response) => {
                if (!cancelled && !response.error) setModels(response.data?.models ?? []);
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [service, provider, authLoading, user]);

    return models;
}
