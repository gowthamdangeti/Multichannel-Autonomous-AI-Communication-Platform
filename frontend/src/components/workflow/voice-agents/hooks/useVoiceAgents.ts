import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { getWorkflowsApiV1WorkflowFetchGet, listFoldersApiV1FolderGet } from "@/client/sdk.gen";
import type { FolderResponse, WorkflowListResponse } from "@/client/types.gen";
import { useAuth } from "@/lib/auth";

export type FolderFilter = "all" | "uncategorized" | "archived" | number;

function getFolderLabel(selected: FolderFilter, folders: FolderResponse[]): string {
  if (selected === "all") return "All Agents";
  if (selected === "uncategorized") return "Uncategorized";
  if (selected === "archived") return "Archived";
  return folders.find((f) => Number(f.id) === Number(selected))?.name ?? "Unknown";
}

function sortNewestFirst(workflows: WorkflowListResponse[]): WorkflowListResponse[] {
  return [...workflows].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

export function useVoiceAgents(initialWorkflows: WorkflowListResponse[], initialFolders: FolderResponse[]) {
  const { isAuthenticated } = useAuth();
  const [workflows, setWorkflows] = useState(initialWorkflows);
  const [folders, setFolders] = useState(initialFolders);
  const [isLoading, setIsLoading] = useState(initialWorkflows.length === 0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFolder, setSelectedFolder] = useState<FolderFilter>("all");

  // Sync server props into local state when router.refresh() delivers new data
  // after folder create/rename/delete or agent move.
  useEffect(() => {
    setFolders(initialFolders);
  }, [initialFolders]);

  useEffect(() => {
    setWorkflows(initialWorkflows);
  }, [initialWorkflows]);

  // If the selected folder disappears (e.g. deleted elsewhere), fall back to
  // "all" instead of showing an empty table with an "Unknown" label.
  useEffect(() => {
    if (typeof selectedFolder === "number" && !folders.some((f) => Number(f.id) === selectedFolder)) {
      setSelectedFolder("all");
    }
  }, [folders, selectedFolder]);

  const fetchAgents = useCallback(async () => {
    const [workflowResponse, folderResponse] = await Promise.all([
      getWorkflowsApiV1WorkflowFetchGet({ query: { status: "active,archived" } }).catch(() => null),
      listFoldersApiV1FolderGet().catch(() => null),
    ]);
    if (workflowResponse?.data) {
      const data = workflowResponse.data;
      setWorkflows(Array.isArray(data) ? data : [data]);
    }
    if (folderResponse?.data) setFolders(folderResponse.data);
    return Boolean(workflowResponse?.data && folderResponse?.data);
  }, []);

  // Client-side fallback when the server render returned an empty list.
  useEffect(() => {
    if (initialWorkflows.length > 0 || !isAuthenticated) {
      setIsLoading(false);
      return;
    }
    void fetchAgents().finally(() => setIsLoading(false));
  }, [isAuthenticated, initialWorkflows.length, fetchAgents]);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    const isFresh = await fetchAgents();
    if (!isFresh) toast.error("Couldn't refresh voice agents. Please try again.");
    setIsRefreshing(false);
  }, [fetchAgents]);

  const handleFolderCreated = useCallback((folder: FolderResponse) => {
    setFolders((prev) => (prev.some((f) => Number(f.id) === Number(folder.id)) ? prev : [...prev, folder]));
  }, []);

  const handleWorkflowMoved = useCallback((workflowId: number, folderId: number | null) => {
    setWorkflows((prev) => prev.map((w) => (w.id === workflowId ? { ...w, folder_id: folderId } : w)));
  }, []);

  const handleWorkflowStatusChanged = useCallback((workflowId: number, status: string) => {
    setWorkflows((prev) => prev.map((w) => (w.id === workflowId ? { ...w, status } : w)));
  }, []);

  const query = searchQuery.toLowerCase().trim();
  const matches = query ? workflows.filter((w) => (w.name ?? "").toLowerCase().includes(query)) : workflows;
  const activeWorkflows = sortNewestFirst(matches.filter((w) => w.status === "active"));
  const archivedWorkflows = sortNewestFirst(matches.filter((w) => w.status === "archived"));

  // Number() guards against string/number id mismatches with the API payload.
  const folderIds = new Set(folders.map((f) => Number(f.id)));
  const isArchivedView = selectedFolder === "archived";

  function getVisibleWorkflows() {
    if (isArchivedView) return archivedWorkflows;
    if (selectedFolder === "all") return activeWorkflows;
    if (selectedFolder === "uncategorized") {
      return activeWorkflows.filter((w) => w.folder_id == null || !folderIds.has(Number(w.folder_id)));
    }
    return activeWorkflows.filter((w) => w.folder_id != null && Number(w.folder_id) === Number(selectedFolder));
  }

  return {
    folders,
    isLoading,
    isRefreshing,
    searchQuery,
    setSearchQuery,
    selectedFolder,
    setSelectedFolder,
    selectedFolderLabel: getFolderLabel(selectedFolder, folders),
    archivedCount: archivedWorkflows.length,
    visibleWorkflows: getVisibleWorkflows(),
    isArchivedView,
    currentFolderId: typeof selectedFolder === "number" ? selectedFolder : null,
    refresh,
    handleFolderCreated,
    handleWorkflowMoved,
    handleWorkflowStatusChanged,
  };
}
