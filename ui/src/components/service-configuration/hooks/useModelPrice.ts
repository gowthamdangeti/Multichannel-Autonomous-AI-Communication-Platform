"use client";

import { useEffect, useState } from "react";

import { getModelPricingApiV1UserConfigurationsPricingProviderGet } from "@/client/sdk.gen";
import type { ModelPriceResponse } from "@/client/types.gen";
import { useAuth } from "@/lib/auth";

import type { ServiceSegment } from "../types";

type PricedService = Exclude<ServiceSegment, "embeddings">;

interface UseModelPriceArgs {
    service: ServiceSegment;
    provider?: string;
    model?: string;
    voice?: string;
}

/** Price of the selected provider and model. Re-fetches when either changes. */
export function useModelPrice({ service, provider, model, voice }: UseModelPriceArgs) {
    const { user, loading: authLoading } = useAuth();
    const [price, setPrice] = useState<ModelPriceResponse | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (service === "embeddings" || !provider || authLoading || !user) {
            setPrice(null);
            return;
        }
        // A slower answer for the previous model must not replace this one.
        let cancelled = false;
        setIsLoading(true);
        void getModelPricingApiV1UserConfigurationsPricingProviderGet({
            path: { provider: provider.toLowerCase() },
            query: { capability: service as PricedService, model: model || undefined, voice: voice || undefined },
        })
            .then((response) => {
                if (!cancelled) setPrice(response.error ? null : (response.data ?? null));
            })
            .catch(() => {
                if (!cancelled) setPrice(null);
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [service, provider, model, voice, authLoading, user]);

    return { price, isLoading };
}
