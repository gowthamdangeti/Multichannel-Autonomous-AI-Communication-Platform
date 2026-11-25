"use client";

import { useEffect, useState } from "react";

import { getWorkflowApiV1WorkflowFetchWorkflowIdGet } from "@/client/sdk.gen";
import type { WorkflowResponse } from "@/client/types.gen";
import { detailFromError } from "@/lib/apiError";
import { useAuth } from "@/lib/auth";
import logger from "@/lib/logger";

/**
 * Auth-guarded fetch of the workflow being configured. Redirects to login
 * when signed out.
 */
export function useSettingsWorkflow(workflowId: number) {
    const { user, redirectToLogin, loading: authLoading } = useAuth();
    const [workflow, setWorkflow] = useState<WorkflowResponse | undefined>(undefined);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!authLoading && !user) redirectToLogin();
    }, [authLoading, user, redirectToLogin]);

    useEffect(() => {
        if (!user) return;
        const load = async () => {
            try {
                const response = await getWorkflowApiV1WorkflowFetchWorkflowIdGet({ path: { workflow_id: workflowId } });
                if (response.error) {
                    setError(detailFromError(response.error, "Failed to fetch workflow"));
                    return;
                }
                setWorkflow(response.data);
            } catch (err) {
                setError("Failed to fetch workflow");
                logger.error(`Error fetching workflow settings: ${err}`);
            } finally {
                setIsLoading(false);
            }
        };
        void load();
    }, [workflowId, user]);

    return { user, workflow, error, isLoading: isLoading || authLoading };
}
