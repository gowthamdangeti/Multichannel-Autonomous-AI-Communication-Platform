"use client";

import { useParams } from "next/navigation";

import SpinLoader from "@/components/SpinLoader";
import { useSettingsWorkflow } from "@/components/workflow/settings/hooks/useSettingsWorkflow";
import { WorkflowSettingsContent } from "@/components/workflow/settings/WorkflowSettingsView";

/**
 * Agent settings route (Level 1 page route).
 *
 * Fetches the workflow behind an auth guard, then mounts
 * ``WorkflowSettingsContent`` only once everything is loaded — that keeps
 * ``useWorkflowState`` from initialising the store with empty values.
 *
 * The per-section components all live under
 * ``src/components/workflow/settings/``; this file is only the route wrapper.
 */
export default function WorkflowSettingsPage() {
    const params = useParams();
    const workflowId = Number(params.workflowId);
    const { user, workflow, error, isLoading } = useSettingsWorkflow(workflowId);

    if (isLoading) return <SpinLoader />;
    if (error || !workflow) {
        return (
            <div className="flex min-h-screen items-center justify-center">
                <div className="text-lg text-destructive">{error || "Workflow not found"}</div>
            </div>
        );
    }
    if (!user) return null;

    return <WorkflowSettingsContent workflow={workflow} user={user} />;
}
