"use client";

import { useCallback, useMemo, useState } from "react";

import { useWorkflowState } from "@/app/workflow/[workflowId]/hooks/useWorkflowState";
import type { WorkflowResponse } from "@/client/types.gen";
import type { FlowEdge, FlowNode } from "@/components/flow/types";
import {
    DEFAULT_WORKFLOW_CONFIGURATIONS,
    type ReportVariable,
    type WorkflowConfigurations,
} from "@/types/workflow-configurations";

export interface SettingsUser {
    id: string;
    email?: string;
}

/** Workflow store for the settings page, seeded from the fetched workflow. */
export function useWorkflowSettingsState(workflow: WorkflowResponse, user: SettingsUser) {
    const initialFlow = useMemo(
        () => ({
            nodes: workflow.workflow_definition.nodes as FlowNode[],
            edges: workflow.workflow_definition.edges as FlowEdge[],
            viewport: { x: 0, y: 0, zoom: 0 },
        }),
        [workflow],
    );
    const initialTemplateContextVariables = useMemo(
        () => (workflow.template_context_variables as Record<string, string>) || {},
        [workflow],
    );
    const initialWorkflowConfigurations = useMemo(
        () => (workflow.workflow_configurations as WorkflowConfigurations) || DEFAULT_WORKFLOW_CONFIGURATIONS,
        [workflow],
    );

    const state = useWorkflowState({
        initialWorkflowName: workflow.name,
        workflowId: workflow.id,
        initialFlow,
        initialTemplateContextVariables,
        initialWorkflowConfigurations,
        user,
    });

    const savedConfig = state.workflowConfigurations as Record<string, unknown> | undefined;
    const [reportTemplate, setReportTemplate] = useState<string>(() => (savedConfig?.report_template as string) || "");
    const [reportVariables, setReportVariables] = useState<ReportVariable[]>(
        () => (savedConfig?.report_variables as ReportVariable[]) || [],
    );
    const saveReportTemplate = useCallback((template: string, variables: ReportVariable[]) => {
        setReportTemplate(template);
        setReportVariables(variables);
    }, []);

    return { ...state, reportTemplate, reportVariables, saveReportTemplate };
}
