"use client";

import { useEffect, useRef, useState } from "react";

import {
    getModelConfigurationV2ApiV1OrganizationsModelConfigurationsV2Get,
    getModelConfigurationV2DefaultsApiV1OrganizationsModelConfigurationsV2DefaultsGet,
} from "@/client/sdk.gen";
import type { OrganizationAiModelConfigurationResponse } from "@/client/types.gen";
import type { ModelConfigurationDefaultsV2 } from "@/components/AIModelConfigurationV2Editor";
import { detailFromError } from "@/lib/apiError";

/** The organization's model configuration and provider defaults, loaded once. */
export function useOrganizationModelConfiguration() {
    const [defaults, setDefaults] = useState<ModelConfigurationDefaultsV2 | null>(null);
    const [configuration, setConfiguration] = useState<OrganizationAiModelConfigurationResponse | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const hasFetched = useRef(false);

    useEffect(() => {
        if (hasFetched.current) return;
        hasFetched.current = true;

        const load = async () => {
            setIsLoading(true);
            setError(null);
            const [defaultsResult, configurationResult] = await Promise.all([
                getModelConfigurationV2DefaultsApiV1OrganizationsModelConfigurationsV2DefaultsGet(),
                getModelConfigurationV2ApiV1OrganizationsModelConfigurationsV2Get(),
            ]);
            if (defaultsResult.error) {
                setError(detailFromError(defaultsResult.error, "Failed to load model configuration defaults"));
                setIsLoading(false);
                return;
            }
            if (configurationResult.error) {
                setError(detailFromError(configurationResult.error, "Failed to load model configuration"));
                setIsLoading(false);
                return;
            }
            setDefaults(defaultsResult.data as ModelConfigurationDefaultsV2);
            setConfiguration(configurationResult.data || null);
            setIsLoading(false);
        };
        void load();
    }, []);

    return { defaults, configuration, isLoading, error };
}
