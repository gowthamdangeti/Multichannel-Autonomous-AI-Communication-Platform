/**
 * Agent utilisation policies shared by the create page and the agent settings
 * page. Values match the backend contract (`utilization_type` on the workflow).
 */
export type AgentUtilization = "public" | "private" | "closed";

export interface AgentUtilizationOption {
    value: AgentUtilization;
    label: string;
    description: string;
}

export const AGENT_UTILIZATION_OPTIONS: readonly AgentUtilizationOption[] = [
    {
        value: "public",
        label: "Public",
        description: "All eligible members within the Organization can view and utilise this Agent.",
    },
    {
        value: "private",
        label: "Private",
        description:
            "Accessible only to the creator and explicitly selected members.",
    },
    {
        value: "closed",
        label: "Internal",
        description:
            "Only the Agent creator and permitted members under their reporting hierarchy can view and utilise this Agent.",
    },
] as const;

export const DEFAULT_AGENT_UTILIZATION: AgentUtilization = "public";

export function agentUtilizationOption(value: string | null | undefined): AgentUtilizationOption {
    return (
        AGENT_UTILIZATION_OPTIONS.find((option) => option.value === value) ??
        AGENT_UTILIZATION_OPTIONS[0]
    );
}

