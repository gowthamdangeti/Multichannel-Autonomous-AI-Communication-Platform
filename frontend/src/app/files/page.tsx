"use client";

import { ExternalLink, Upload, X } from "lucide-react";
import { useEffect, useState } from "react";

import { PageFilterSelect } from "@/components/layout/PageFilterSelect";
import { PageSearchInput } from "@/components/layout/PageSearchInput";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/context/HeaderContext";
import { useAuth } from "@/lib/auth";
import { ALL_FILTER } from "@/lib/searchFilter";

import DocumentList from "./DocumentList";
import DocumentUpload from "./DocumentUpload";

const DOCUMENT_STATUS_OPTIONS = [
    { value: "completed", label: "Completed" },
    { value: "processing", label: "Processing" },
    { value: "pending", label: "Pending" },
    { value: "failed", label: "Failed" },
];

export default function FilesPage() {
    const { user, redirectToLogin, loading } = useAuth();
    const [refreshKey, setRefreshKey] = useState(0);
    const [isUploadOpen, setIsUploadOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState(ALL_FILTER);
    const [isListLoading, setIsListLoading] = useState(false);

    // Redirect if not authenticated
    useEffect(() => {
        if (!loading && !user) {
            redirectToLogin();
        }
    }, [loading, user, redirectToLogin]);

    const handleUploadSuccess = () => {
        setRefreshKey(prev => prev + 1);
        setIsUploadOpen(false);
    };

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

    return (
        <div className="px-4 lg:px-6 pt-2 pb-6">
            <PageHeader
                title="Knowledge Base Files"
                subtitle={
                    <span>
                        Upload and manage documents for your voice agents to reference.{" "}
                        <a href="https://docs.convozent.ai/voice-agent/knowledge-base" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 underline">
                            Learn more <ExternalLink className="h-3 w-3" />
                        </a>
                    </span>
                }
                onRefresh={() => setRefreshKey((prev) => prev + 1)}
                isRefreshing={isListLoading}
                primaryAction={<Button onClick={() => setIsUploadOpen(true)}>
                        <Upload className="w-4 h-4 mr-2" />
                        Upload Document
                    </Button>}
                toolbar={
                    <>
                        <PageSearchInput placeholder="Search documents..." value={searchQuery} onChange={setSearchQuery} />
                        <PageFilterSelect allLabel="All statuses" value={statusFilter} options={DOCUMENT_STATUS_OPTIONS} onChange={setStatusFilter} />
                    </>
                }
            />

            <div className="mt-4">
                <Card className="overflow-hidden">
                    <CardContent className="p-0">
                        <DocumentList
                            refreshTrigger={refreshKey}
                            searchQuery={searchQuery}
                            statusFilter={statusFilter}
                            onLoadingChange={setIsListLoading}
                        />
                    </CardContent>
                </Card>
            </div>

            <Dialog open={isUploadOpen} onOpenChange={setIsUploadOpen}>
                <DialogContent className="[&>button]:hidden">
                    <DialogHeader className="flex flex-row justify-between items-start gap-4 sm:text-left">
                        <div className="flex flex-col gap-1">
                            <DialogTitle>Upload Document</DialogTitle>
                            <DialogDescription>
                                Upload a PDF or document file to add to your knowledge base
                            </DialogDescription>
                        </div>
                        <DialogClose asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="custom-close-btn h-9 w-9 shrink-0 hover:bg-accent rounded-md"
                            >
                                <X className="w-5 h-5" />
                                <span className="sr-only">Close</span>
                            </Button>
                        </DialogClose>
                    </DialogHeader>
                    <DocumentUpload onUploadSuccess={handleUploadSuccess} />
                </DialogContent>
            </Dialog>
        </div>
    );
}
