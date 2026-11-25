"use client";

import { ArrowLeft, ExternalLink } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { getToolApiV1ToolsToolUuidGet } from "@/client/sdk.gen";
import type { ToolResponse } from "@/client/types.gen";
import { getToolTypeLabel } from "@/components/tools/config";
import { ToolConfigEditor } from "@/components/tools/ToolConfigEditor";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TOOL_DOCUMENTATION_URLS } from "@/constants/documentation";
import { type Breadcrumb, PageHeader } from "@/context/HeaderContext";
import { useAuth } from "@/lib/auth";

export default function ToolDetailPage() {
    const { toolUuid } = useParams<{ toolUuid: string }>();
    const { user, getAccessToken, redirectToLogin, loading } = useAuth();
    const router = useRouter();

    const [tool, setTool] = useState<ToolResponse | null>(null);
    const [toolName, setToolName] = useState("");
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const breadcrumbs = useMemo<Breadcrumb[]>(
        () => [
            { label: "Tools", href: "/tools" },
            { label: toolName || "Tool Details" },
        ],
        [toolName],
    );

    // Redirect if not authenticated
    useEffect(() => {
        if (!loading && !user) {
            redirectToLogin();
        }
    }, [loading, user, redirectToLogin]);

    const fetchTool = useCallback(async () => {
        if (loading || !user || !toolUuid) return;

        try {
            setIsLoading(true);
            setError(null);
            const accessToken = await getAccessToken();

            const response = await getToolApiV1ToolsToolUuidGet({
                path: { tool_uuid: toolUuid },
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            });

            if (response.data) {
                setTool(response.data);
                setToolName(response.data.name);
            }
        } catch (err) {
            setError("Failed to fetch tool");
            console.error("Error fetching tool:", err);
        } finally {
            setIsLoading(false);
        }
    }, [loading, user, toolUuid, getAccessToken]);

    useEffect(() => {
        fetchTool();
    }, [fetchTool]);

    if (loading || !user) {
        return (
            <div className="px-4 lg:px-6 pt-2 pb-6">
                <div className="space-y-4">
                    <Skeleton className="h-12 w-64" />
                    <Skeleton className="h-64 w-full" />
                </div>
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className="px-4 lg:px-6 pt-2 pb-6">
                <div className="space-y-6">
                    <Skeleton className="h-8 w-48" />
                    <Skeleton className="h-64 w-full" />
                </div>
            </div>
        );
    }

    if (!tool) {
        return (
            <div className="px-4 lg:px-6 pt-2 pb-6">
                <div className="text-center">
                    <h1 className="text-2xl font-bold mb-4">Tool not found</h1>
                    <Button onClick={() => router.push("/tools")}>
                        <ArrowLeft className="w-4 h-4 mr-2" />
                        Back to Tools
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="px-4 lg:px-6 pt-2 pb-6">
            <div className="max-w-4xl mx-auto">
                <PageHeader
                    breadcrumbs={breadcrumbs}
                    title={toolName}
                    subtitle={getToolTypeLabel(tool.category)}
                    actions={
                        TOOL_DOCUMENTATION_URLS[tool.category] && (
                            <a
                                href={TOOL_DOCUMENTATION_URLS[tool.category]}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                            >
                                Docs
                                <ExternalLink className="h-3 w-3" />
                            </a>
                        )
                    }
                />

                {error && (
                    <div className="mb-4 p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive">
                        {error}
                    </div>
                )}

                <ToolConfigEditor
                    toolUuid={toolUuid}
                    tool={tool}
                    onToolSaved={(saved) => {
                        setTool(saved);
                        setToolName(saved.name);
                    }}
                />
            </div>
        </div>
    );
}
