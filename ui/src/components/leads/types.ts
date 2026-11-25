export interface LeadItem {
    id: number;
    created_at: string | null;
    name: string;
    company: string;
    job_title: string;
    work_email: string;
    phone: string;
    volume: string;
    deployment: string;
    agent_goal: string | null;
    source: string;
    origin: string;
    country: string | null;
    status: string;
}

export const LEAD_STATUSES = ["new", "contacted", "qualified", "closed"] as const;

export const getLeadStatusBadgeVariant = (status: string): "info" | "warning" | "success" | "secondary" => {
    switch (status) {
        case "new":
            return "info";
        case "contacted":
            return "warning";
        case "qualified":
            return "success";
        case "closed":
            return "secondary";
        default:
            return "secondary";
    }
};
