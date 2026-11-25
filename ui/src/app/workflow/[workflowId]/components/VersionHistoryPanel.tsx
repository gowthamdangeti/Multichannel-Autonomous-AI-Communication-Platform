"use client";

import { formatDistanceToNow } from "date-fns";
import { FileText, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
    Sheet,
    SheetBody,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export interface WorkflowVersion {
    id: number;
    version_number: number;
    status: string;
    created_at: string;
    published_at: string | null;
    workflow_json: { nodes?: unknown[]; edges?: unknown[]; viewport?: unknown };
    workflow_configurations: Record<string, unknown> | null;
    template_context_variables: Record<string, string> | null;
}

interface VersionHistoryPanelProps {
    isOpen: boolean;
    onClose: () => void;
    versions: WorkflowVersion[];
    loading: boolean;
    activeVersionId: number | null;
    onSelectVersion: (version: WorkflowVersion) => void;
    hasMore: boolean;
    loadingMore: boolean;
    onLoadMore: () => void;
}

const statusLabel: Record<string, string> = {
    draft: "Draft",
    published: "Published",
    archived: "Archived",
};

/** Surface of every card in the drawer: white on drawer background. */
const DRAWER_CARD = "rounded-lg border border-border bg-card p-4 shadow-xs";

function DetailSection({
    title,
    description,
    children,
}: {
    title: string;
    description?: string;
    children: React.ReactNode;
}) {
    return (
        <section className={`${DRAWER_CARD} space-y-3`}>
            <div>
                <h4 className="text-sm font-semibold text-foreground">{title}</h4>
                {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
            </div>
            {children}
        </section>
    );
}

export const VersionHistoryPanel = ({
    isOpen,
    onClose,
    versions,
    loading,
    activeVersionId,
    onSelectVersion,
    hasMore,
    loadingMore,
    onLoadMore,
}: VersionHistoryPanelProps) => {
    return (
        <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <SheetContent side="right" className="w-full sm:w-[380px] sm:max-w-[380px]">
                <SheetHeader>
                    <SheetTitle className="text-base font-semibold truncate pr-10">
                        Version History
                    </SheetTitle>
                    <SheetDescription className="sr-only">
                        Inspect and restore previous versions of this voice agent workflow.
                    </SheetDescription>
                </SheetHeader>

                <SheetBody className="px-4 py-4 space-y-4">
                    <DetailSection
                        title="Saved Versions"
                        description="Click any version to preview its canvas nodes and configuration in read-only mode."
                    >
                        {loading ? (
                            <div className="flex items-center justify-center py-12">
                                <LoaderCircle className="w-5 h-5 text-muted-foreground animate-spin" />
                            </div>
                        ) : versions.length === 0 ? (
                            <p className="text-xs text-muted-foreground text-center py-6">
                                No versions found.
                            </p>
                        ) : (
                            <div className="space-y-2">
                                {versions.map((version) => {
                                    const isActive = version.id === activeVersionId;
                                    const date = version.published_at || version.created_at;
                                    const nodeCount = version.workflow_json?.nodes?.length ?? 0;

                                    return (
                                        <button
                                            key={version.id}
                                            type="button"
                                            className={cn(
                                                "w-full text-left p-3 rounded-lg border transition-all cursor-pointer flex flex-col gap-1.5",
                                                isActive
                                                    ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                                                    : "border-border bg-card hover:bg-accent/40 hover:border-border/80"
                                            )}
                                            onClick={() => onSelectVersion(version)}
                                        >
                                            <div className="flex items-center justify-between gap-2">
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <div
                                                        className={cn(
                                                            "p-1.5 rounded-md border shrink-0",
                                                            isActive
                                                                ? "bg-primary text-primary-foreground border-primary"
                                                                : "bg-muted text-muted-foreground border-border"
                                                        )}
                                                    >
                                                        <FileText className="w-3.5 h-3.5" />
                                                    </div>
                                                    <span className="text-xs font-semibold text-foreground truncate">
                                                        Version {version.version_number}
                                                    </span>
                                                    {isActive && (
                                                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                                                            Active
                                                        </span>
                                                    )}
                                                </div>
                                                <span
                                                    className={cn(
                                                        "text-[10px] font-medium px-2 py-0.5 rounded-full border shrink-0 capitalize",
                                                        version.status === "published"
                                                            ? "bg-secondary text-secondary-foreground border-border"
                                                            : "bg-muted text-muted-foreground border-border"
                                                    )}
                                                >
                                                    {statusLabel[version.status] ?? version.status}
                                                </span>
                                            </div>
                                            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                                                <span>
                                                    {version.published_at ? "Published" : "Saved"}{" "}
                                                    {formatDistanceToNow(new Date(date), { addSuffix: true })}
                                                </span>
                                                <span className="font-mono text-[10px]">
                                                    {nodeCount} {nodeCount === 1 ? "node" : "nodes"}
                                                </span>
                                            </div>
                                        </button>
                                    );
                                })}

                                {hasMore && (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={onLoadMore}
                                        disabled={loadingMore}
                                        className="w-full text-xs mt-2"
                                    >
                                        {loadingMore ? (
                                            <>
                                                <LoaderCircle className="w-3.5 h-3.5 animate-spin mr-1.5" />
                                                Loading more…
                                            </>
                                        ) : (
                                            "Load more versions"
                                        )}
                                    </Button>
                                )}
                            </div>
                        )}
                    </DetailSection>
                </SheetBody>

                <SheetFooter className="justify-between">
                    <div>
                        <span className="text-xs text-muted-foreground">
                            {versions.length} total {versions.length === 1 ? "version" : "versions"}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={onClose}
                        >
                            Close
                        </Button>
                    </div>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    );
};
