'use client';

import { ArrowDown, ArrowUp, ArrowUpDown, FileText, Loader2, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import {
  deleteDocumentApiV1KnowledgeBaseDocumentsDocumentUuidDelete,
  listDocumentsApiV1KnowledgeBaseDocumentsGet,
} from '@/client/sdk.gen';
import type { DocumentResponseSchema } from '@/client/types.gen';
import { RowAction, RowActionsMenu } from "@/components/layout/RowActionsMenu";
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { Skeleton } from '@/components/ui/skeleton';
import logger from '@/lib/logger';
import { matchesFilter } from "@/lib/searchFilter";

interface DocumentListProps {
  refreshTrigger: number;
  searchQuery: string;
  statusFilter: string;
  onLoadingChange?: (loading: boolean) => void;
}

export default function DocumentList({ refreshTrigger, searchQuery, statusFilter, onLoadingChange }: DocumentListProps) {
  const [documents, setDocuments] = useState<DocumentResponseSchema[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);

  // Delete confirmation modal state
  const [deleteTarget, setDeleteTarget] = useState<{ uuid: string; filename: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  const fetchDocuments = useCallback(async () => {
    try {
      setIsLoading(true);
      onLoadingChange?.(true);
      setError(null);

      const response = await listDocumentsApiV1KnowledgeBaseDocumentsGet({
        query: {
          limit: 100,
          offset: 0,
        },
      });

      if (response.error || !response.data) {
        throw new Error('Failed to fetch documents');
      }

      setDocuments(response.data.documents);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch documents');
      logger.error('Error fetching documents:', err);
    } finally {
      setIsLoading(false);
      onLoadingChange?.(false);
    }
  }, [onLoadingChange]);

  // Fetch documents on mount and when refreshTrigger changes
  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments, refreshTrigger]);

  // Poll for documents that are processing
  useEffect(() => {
    const processingDocs = documents.filter(
      (doc) => doc.processing_status === 'processing' || doc.processing_status === 'pending'
    );

    if (processingDocs.length === 0) return;

    const pollInterval = setInterval(() => {
      logger.info(`Polling for ${processingDocs.length} processing documents...`);
      fetchDocuments();
    }, 5000); // Poll every 5 seconds

    return () => clearInterval(pollInterval);
  }, [documents, fetchDocuments]);

  const handleDeleteClick = (documentUuid: string, filename: string) => {
    setDeleteTarget({ uuid: documentUuid, filename });
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget || isDeleting) return;
    const { uuid, filename } = deleteTarget;
    setIsDeleting(true);

    try {
      const response = await deleteDocumentApiV1KnowledgeBaseDocumentsDocumentUuidDelete({
        path: {
          document_uuid: uuid,
        },
      });

      if (response.error) {
        throw new Error('Failed to delete document');
      }

      toast.success(`Deleted "${filename}"`);
      setDeleteTarget(null);
      fetchDocuments();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete document');
      logger.error('Error deleting document:', err);
    } finally {
      setIsDeleting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return (
          <Badge className="border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20 font-medium">
            Completed
          </Badge>
        );
      case 'processing':
        return (
          <Badge className="border-transparent bg-blue-500/15 text-blue-700 dark:text-blue-400 hover:bg-blue-500/20 animate-pulse font-medium">
            Processing
          </Badge>
        );
      case 'pending':
        return (
          <Badge className="border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-400 hover:bg-amber-500/20 font-medium">
            Pending
          </Badge>
        );
      case 'failed':
        return (
          <Badge className="border-transparent bg-red-500/15 text-red-700 dark:text-red-400 hover:bg-red-500/20 font-medium">
            Failed
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="font-medium">
            {status}
          </Badge>
        );
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  };

  const filteredDocuments = documents.filter((doc) =>
    matchesFilter(doc.processing_status, statusFilter) &&
    (doc.filename.toLowerCase().includes(searchQuery.toLowerCase()) ||
      String(doc.id).includes(searchQuery) ||
      doc.document_uuid.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  // Header sorting (client-side, current list only; null = server order).
  type DocSortKey = 'id' | 'filename' | 'processing_status' | 'file_size_bytes' | 'total_chunks' | 'created_at';
  const [sortKey, setSortKey] = useState<DocSortKey | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const toggleSort = (key: DocSortKey) => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir('asc');
    } else if (sortDir === 'asc') {
      setSortDir('desc');
    } else {
      setSortKey(null);
      setSortDir('asc');
    }
    setCurrentPage(1);
  };
  const SortIcon = ({ column }: { column: DocSortKey }) => {
    if (sortKey !== column) return <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground/60" />;
    return sortDir === 'asc'
      ? <ArrowUp className="h-3.5 w-3.5 text-foreground" />
      : <ArrowDown className="h-3.5 w-3.5 text-foreground" />;
  };
  const sortedDocuments = useMemo(() => {
    if (!sortKey) return filteredDocuments;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filteredDocuments].sort((a, b) => {
      switch (sortKey) {
        case 'id':
          return (a.id - b.id) * dir;
        case 'filename':
          return (a.filename ?? '').localeCompare(b.filename ?? '') * dir;
        case 'processing_status':
          return (a.processing_status ?? '').localeCompare(b.processing_status ?? '') * dir;
        case 'file_size_bytes':
          return ((a.file_size_bytes ?? 0) - (b.file_size_bytes ?? 0)) * dir;
        case 'total_chunks':
          return ((a.total_chunks ?? -1) - (b.total_chunks ?? -1)) * dir;
        case 'created_at':
          return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir;
      }
    });
  }, [filteredDocuments, sortKey, sortDir]);

  const ITEMS_PER_PAGE = 8;
  const totalCount = sortedDocuments.length;
  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);
  const activePage = Math.min(currentPage, Math.max(1, totalPages));
  const paginatedDocuments = sortedDocuments.slice(
    (activePage - 1) * ITEMS_PER_PAGE,
    activePage * ITEMS_PER_PAGE
  );

  if (isLoading && documents.length === 0) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center justify-between p-4 border rounded-lg">
            <div className="space-y-2 flex-1">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-64" />
            </div>
            <Skeleton className="h-8 w-24" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive">
        {error}
      </div>
    );
  }

  return (
    <>
      {/* Delete confirmation popup dialog */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open && !isDeleting) setDeleteTarget(null);
        }}
      >
        <DialogContent className="p-6 sm:max-w-[420px] rounded-xl border border-border/40 shadow-xl bg-card gap-5">
          {/* Header */}
          <DialogHeader className="p-0 text-left space-y-1">
            <DialogTitle className="text-lg font-semibold tracking-tight text-foreground">
              Delete Document
            </DialogTitle>
          </DialogHeader>

          {/* Text-Based Body */}
          <div className="space-y-2 text-sm leading-relaxed">
            <p className="text-muted-foreground">
              Are you sure you want to delete{' '}
              <span className="font-semibold text-foreground break-all">
                {deleteTarget?.filename}
              </span>
              ?
            </p>
            <p className="text-xs text-muted-foreground/80">
              This action cannot be undone. The document and all its chunks will be permanently removed.
            </p>
          </div>

          {/* Footer */}
          <DialogFooter className="p-0 sm:justify-end gap-2.5">
            <Button
              type="button"
              variant="outline"
              disabled={isDeleting}
              onClick={() => setDeleteTarget(null)}
              className="rounded-lg h-9 px-4 font-medium"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={isDeleting}
              onClick={handleDeleteConfirm}
              className="rounded-lg h-9 px-4 font-medium gap-2"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Deleting...</span>
                </>
              ) : (
                <span>Delete</span>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="w-full">
        {sortedDocuments.length === 0 ? (
          <div className="text-center py-12">
            <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">
              {searchQuery
                ? 'No documents match your search'
                : 'No documents uploaded yet'}
            </p>
          </div>
        ) : (
          <div className="relative w-full overflow-auto">
            <table className="w-full caption-bottom text-sm">
              <thead className="[&_tr]:border-b border-border">
                <tr className="border-b border-border transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
                  <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">
                    <button onClick={() => toggleSort('id')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by ID">
                      ID <SortIcon column="id" />
                    </button>
                  </th>
                  <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">
                    <button onClick={() => toggleSort('filename')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by document name">
                      Document Name <SortIcon column="filename" />
                    </button>
                  </th>
                  <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">
                    <button onClick={() => toggleSort('processing_status')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by status">
                      Status <SortIcon column="processing_status" />
                    </button>
                  </th>
                  <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">
                    Retrieval Mode
                  </th>
                  <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">
                    <button onClick={() => toggleSort('file_size_bytes')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by file size">
                      File Size <SortIcon column="file_size_bytes" />
                    </button>
                  </th>
                  <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">
                    <button onClick={() => toggleSort('total_chunks')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by chunks">
                      Chunks <SortIcon column="total_chunks" />
                    </button>
                  </th>
                  <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">
                    <button onClick={() => toggleSort('created_at')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by uploaded date">
                      Uploaded At <SortIcon column="created_at" />
                    </button>
                  </th>
                  <th className="h-10 px-4 align-middle font-medium text-muted-foreground text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="[&_tr:last-child]:border-0">
                {paginatedDocuments.map((doc) => (
                  <tr
                    key={doc.document_uuid}
                    className="border-b border-border transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted"
                  >
                    <td className="p-4 align-middle">
                      <span className="font-mono text-xs text-muted-foreground">
                        #{doc.id}
                      </span>
                    </td>
                    <td className="p-4 align-middle font-medium">
                      <div className="flex items-center gap-3">
                        <FileText className="w-4 h-4 text-primary shrink-0" />
                        <span className="truncate max-w-[280px]" title={doc.filename}>
                          {doc.filename}
                        </span>
                      </div>
                      {doc.processing_error && (
                        <p className="text-xs text-destructive mt-1">
                          Error: {doc.processing_error}
                        </p>
                      )}
                      {doc.docling_metadata &&
                       typeof doc.docling_metadata === 'object' &&
                       'duplicate_of' in doc.docling_metadata && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Duplicate of another document
                        </p>
                      )}
                    </td>
                    <td className="p-4 align-middle">
                      {getStatusBadge(doc.processing_status)}
                    </td>
                    <td className="p-4 align-middle">
                      {doc.retrieval_mode === 'full_document' ? (
                        <Badge variant="outline" className="text-xs">Full Document</Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs">Chunked</Badge>
                      )}
                    </td>
                    <td className="p-4 align-middle text-foreground font-mono text-xs">
                      {formatFileSize(doc.file_size_bytes)}
                    </td>
                    <td className="p-4 align-middle text-foreground">
                      {doc.processing_status === 'completed' && doc.retrieval_mode !== 'full_document'
                        ? `${doc.total_chunks} chunks`
                        : '—'}
                    </td>
                    <td className="p-4 align-middle text-foreground whitespace-nowrap">
                      {formatDate(doc.created_at)}
                    </td>
                    <td className="p-4 align-middle text-right">
                        <RowActionsMenu label={`Actions for ${doc.filename}`}>
                            <RowAction icon={<Trash2 />} onClick={() => handleDeleteClick(doc.document_uuid, doc.filename)} destructive>Delete</RowAction>
                        </RowActionsMenu>
</td>
                  </tr>
                ))}
              </tbody>
            </table>
          {totalPages > 1 && (
            <div className="flex items-center justify-between p-4 px-6 border-t border-border bg-muted/10">
              <p className="text-sm text-muted-foreground">
                Page {activePage} of {totalPages} ({totalCount} total items)
              </p>
              <Pagination className="mx-0 w-auto justify-end">
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      onClick={() => setCurrentPage(activePage - 1)}
                      className={activePage <= 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                    />
                  </PaginationItem>
                  {(() => {
                    const pages: (number | 'ellipsis')[] = [];
                    if (totalPages <= 7) {
                      for (let i = 1; i <= totalPages; i++) pages.push(i);
                    } else {
                      pages.push(1);
                      if (activePage > 3) pages.push('ellipsis');
                      for (let i = Math.max(2, activePage - 1); i <= Math.min(totalPages - 1, activePage + 1); i++) {
                        pages.push(i);
                      }
                      if (activePage < totalPages - 2) pages.push('ellipsis');
                      pages.push(totalPages);
                    }
                    return pages.map((p, idx) =>
                      p === 'ellipsis' ? (
                        <PaginationItem key={`e-${idx}`}>
                          <PaginationEllipsis />
                        </PaginationItem>
                      ) : (
                        <PaginationItem key={p}>
                          <PaginationLink
                            isActive={p === activePage}
                            onClick={() => setCurrentPage(p)}
                            className="cursor-pointer"
                          >
                            {p}
                          </PaginationLink>
                        </PaginationItem>
                      )
                    );
                  })()}
                  <PaginationItem>
                    <PaginationNext
                      onClick={() => setCurrentPage(activePage + 1)}
                      className={activePage >= totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}
        </div>
      )}
    </div>
    </>
  );
}
