"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useMemo } from "react";

import { type Breadcrumb, PageHeader } from "@/context/HeaderContext";

import WorkflowLayout from "../../WorkflowLayout";
import { WorkflowExecutions } from "../components/WorkflowExecutions";

export default function WorkflowRunsPage() {
    const { workflowId } = useParams();
    const searchParams = useSearchParams();

    const breadcrumbs = useMemo<Breadcrumb[]>(
        () => [
            { label: "Voice agents", href: "/voice/agents" },
            { label: `Agent #${workflowId}`, href: `/voice/agents/${workflowId}` },
            { label: "Run History" },
        ],
        [workflowId]
    );

    return (
        <WorkflowLayout showFeaturesNav={false}>
            <PageHeader
                breadcrumbs={breadcrumbs}
                title={
                    <div className="flex items-center gap-3">
                        <Link href={`/voice/agents/${workflowId}`} className="hover:opacity-70 transition-opacity shrink-0">
                            <ArrowLeft className="h-5 w-5" />
                        </Link>
                        <div className="flex flex-col">
                            <span>Workflow Run History</span>
                            <span className="text-[10px] font-normal text-muted-foreground mt-0.5 sm:text-xs leading-normal">
                                Filter and analyze execution details for this workflow
                            </span>
                        </div>
                    </div>
                }
            />
            <WorkflowExecutions
                workflowId={Number(workflowId)}
                searchParams={searchParams}
            />
        </WorkflowLayout>
    );
}
