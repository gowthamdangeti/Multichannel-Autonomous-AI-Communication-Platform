"use client";

import { BookOpen, Loader2, Wrench } from "lucide-react";

import { DocumentResponseSchema, ToolResponse } from "@/client/types.gen";
import { Switch } from "@/components/ui/switch";

import { AgentDraft } from "./chatAgentDraft";

export function ToolsTab({ tools, toolsLoading, draft, setDraft }: { tools: ToolResponse[]; toolsLoading: boolean; draft: AgentDraft; setDraft: (updater: (d: AgentDraft) => AgentDraft) => void; }) {
    if (toolsLoading) {
        return (
            <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (tools.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
                <Wrench className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium">No tools created yet</p>
                <p className="text-xs text-muted-foreground">
                    Create tools from the Tools page to make them available here.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-2">
            {tools.map((tool) => (
                <div
                    key={tool.id}
                    className="flex items-center gap-3 rounded-lg border border-border p-3 hover:bg-accent/30 transition-colors"
                >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                        <Wrench className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{tool.name}</p>
                        {tool.description && (
                            <p className="text-xs text-muted-foreground truncate">{tool.description}</p>
                        )}
                    </div>
                    <span className="shrink-0 rounded-md border border-border bg-muted px-2 py-0.5 text-[11px] font-medium capitalize text-muted-foreground">
                        {tool.category.replace(/_/g, " ")}
                    </span>
                    <Switch
                        checked={draft.tool_ids.includes(tool.id)}
                        onCheckedChange={(c) => {
                            setDraft(d => ({
                                ...d,
                                tool_ids: c ? [...d.tool_ids, tool.id] : d.tool_ids.filter(id => id !== tool.id)
                            }));
                        }}
                    />
                </div>
            ))}
        </div>
    );
}

export function KnowledgeTab({ documents, documentsLoading, draft, setDraft }: { documents: DocumentResponseSchema[]; documentsLoading: boolean; draft: AgentDraft; setDraft: (updater: (d: AgentDraft) => AgentDraft) => void; }) {
    const getStatusBadge = (status: string) => {
        switch (status) {
            case "completed":
                return <span className="text-xs text-status-success font-medium">Completed</span>;
            case "processing":
                return <span className="text-xs text-primary font-medium animate-pulse">Processing</span>;
            case "pending":
                return <span className="text-xs text-status-warning font-medium">Pending</span>;
            case "failed":
                return <span className="text-xs text-destructive font-medium">Failed</span>;
            default:
                return <span className="text-xs text-muted-foreground">{status}</span>;
        }
    };

    if (documentsLoading) {
        return (
            <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (documents.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
                <BookOpen className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium">No documents uploaded yet</p>
                <p className="text-xs text-muted-foreground">
                    Upload documents from the Knowledge Base page to make them available here.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-2">
            {documents.map((doc) => (
                <div
                    key={doc.document_uuid}
                    className="flex items-center gap-3 rounded-lg border border-border p-3 hover:bg-accent/30 transition-colors"
                >
                    <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{doc.filename}</p>
                        <p className="text-xs text-muted-foreground">
                            {(doc.file_size_bytes / 1024).toFixed(1)} KB &middot; {doc.total_chunks} chunks
                        </p>
                    </div>
                    {getStatusBadge(doc.processing_status)}
                    <Switch
                        checked={draft.document_uuids.includes(doc.document_uuid)}
                        onCheckedChange={(c) => {
                            setDraft(d => ({
                                ...d,
                                document_uuids: c ? [...d.document_uuids, doc.document_uuid] : d.document_uuids.filter(id => id !== doc.document_uuid)
                            }));
                        }}
                    />
                </div>
            ))}
        </div>
    );
}
