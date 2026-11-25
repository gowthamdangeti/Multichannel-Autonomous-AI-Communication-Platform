"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, ExternalLink } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useCallback, useMemo, useState } from "react";

import type { ChatConversationSummary } from "@/client/types.gen";
import { fmtWhen, websiteOf } from "@/components/chat-agent/chatAgentFormat";
import { RowAction, RowActionsMenu } from "@/components/layout/RowActionsMenu";
import { TableNameLink } from "@/components/layout/TableNameLink";
import { TablePagination } from "@/components/layout/TablePagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChatStatusBadge } from "@/components/workflow-runs/RunBadges";
import { useRunColumns } from "@/components/workflow-runs/useRunColumns";
import { usePagination } from "@/hooks/usePagination";
import { withReturnTo } from "@/lib/returnTo";

export type ChatConversationSortKey =
  | "id"
  | "title"
  | "messages"
  | "status"
  | "updated_at"
  | "created_at";
type SortDir = "asc" | "desc";

interface Column {
  id: ChatConversationSortKey;
  label: string;
  /** Always shown; not offered in Customize Columns. */
  required?: boolean;
  /** Only meaningful when the list spans several agents. */
  acrossAgents?: boolean;
  cellClassName?: string;
  /** `link` is the conversation's URL carrying `?returnTo=` back to this list. */
  cell: (c: ChatConversationSummary, link: string) => ReactNode;
  cellTitle?: (c: ChatConversationSummary) => string | undefined;
  sortValue: (c: ChatConversationSummary) => string | number;
}

/** The public view of a column, enough for a "Customize Columns" menu. */
export interface ChatConversationColumnOption {
  id: ChatConversationSortKey;
  label: string;
  required?: boolean;
}

export interface ChatConversationsPagination {
  pageItems: ChatConversationSummary[];
  page: number;
  totalPages: number;
  totalCount: number;
  setPage: (page: number) => void;
}

export interface ChatConversationsTableState {
  /** The list's own URL; a conversation opened from here returns to it. */
  returnTo: string;
  search: string;
  setSearch: (value: string) => void;
  /** Conversations before the search box narrows them. */
  totalCount: number;
  sortKey: ChatConversationSortKey | null;
  sortDir: "asc" | "desc";
  toggleSort: (key: ChatConversationSortKey) => void;
  available: ChatConversationColumnOption[];
  shownIds: ChatConversationSortKey[];
  isVisible: (id: string) => boolean;
  toggleColumn: (id: string) => void;
  resetColumns: () => void;
  rows: ChatConversationSummary[];
  pagination: ChatConversationsPagination;
}

const STATUS_ORDER = { error: 0, in_progress: 1, disconnected: 2, completed: 3 } as const;
const statusOf = (c: ChatConversationSummary) => c.status ?? "completed";
const statusTitle = (c: ChatConversationSummary) =>
    c.error ? `${c.error.message}${c.error.model ? ` (model: ${c.error.model})` : ""}` : undefined;

const time = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : 0);
const href = (c: ChatConversationSummary) => `/chat/conversations/${c.id}`;
/** The saved title, else the website the visitor was on; never blank. */
const titleOf = (c: ChatConversationSummary) => c.title?.trim() || websiteOf(c.origin);

/** Same column set and order as the voice conversations table, over what chat actually stores. */
const COLUMNS: Column[] = [
  {
    id: "id",
    label: "Conversation ID",
    required: true,
    cellClassName: "font-mono text-sm whitespace-nowrap",
    cell: (c) => `#${c.id}`,
    sortValue: (c) => c.id,
  },
  {
    id: "title",
    label: "Conversation",
    required: true,
    cellClassName: "max-w-64 truncate text-sm",
    // The title is the row's link, as in the voice conversations table.
    cell: (c, link) => <TableNameLink href={link}>{titleOf(c)}</TableNameLink>,
    cellTitle: titleOf,
    sortValue: (c) => titleOf(c).toLowerCase(),
  },
  { id: "messages", label: "Messages", cellClassName: "text-sm tabular-nums", cell: (c) => c.message_count, sortValue: (c) => c.message_count },
  {
    id: "status",
    label: "Status",
    cell: (c) => <ChatStatusBadge status={statusOf(c)} title={statusTitle(c)} />,
    cellTitle: statusTitle,
    sortValue: (c) => STATUS_ORDER[statusOf(c)],
  },
  { id: "updated_at", label: "Date", cellClassName: "whitespace-nowrap text-sm", cell: (c) => fmtWhen(c.updated_at), sortValue: (c) => time(c.updated_at) },
  { id: "created_at", label: "Started", cellClassName: "whitespace-nowrap text-sm", cell: (c) => fmtWhen(c.created_at), sortValue: (c) => time(c.created_at) },
];

const DEFAULT_COLUMNS = ["id", "title", "messages", "status", "updated_at"];
const DEFAULT_STORAGE_KEY = "chat-conversations-columns-v4";

export interface ChatConversationsTableOptions {
  /** Remembers the viewer's column choice; also the scope for what counts as `required`. */
  storageKey?: string;
  /** Show which agent each conversation belongs to (hide it on a single agent's list). */
  showAgent?: boolean;
  /** Where a conversation's breadcrumb returns to; defaults to the current page. */
  returnTo?: string;
}

/**
 * Search, sort, columns and pagination over a list of conversations. The page
 * header owns the controls (like the voice conversations page), so both the page
 * and the table read this one state.
 */
export function useChatConversationsTable(
  conversations: ChatConversationSummary[],
  { storageKey = DEFAULT_STORAGE_KEY, showAgent = true, returnTo }: ChatConversationsTableOptions = {},
): ChatConversationsTableState {
  const pathname = usePathname();
  const columnState = useRunColumns(storageKey, DEFAULT_COLUMNS);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<ChatConversationSortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const available = useMemo(() => COLUMNS.filter((c) => showAgent || !c.acrossAgents), [showAgent]);
  const shown = available.filter((c) => c.required || columnState.isVisible(c.id));

  // Click cycles ascending, descending, then back to the newest-first server order.
  const toggleSort = useCallback(
    (key: ChatConversationSortKey) => {
      if (sortKey !== key) {
        setSortKey(key);
        setSortDir("asc");
      } else if (sortDir === "asc") {
        setSortDir("desc");
      } else {
        setSortKey(null);
        setSortDir("asc");
      }
    },
    [sortKey, sortDir],
  );

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matched = q
      ? conversations.filter((c) =>
          [String(c.id), titleOf(c), websiteOf(c.origin), c.agent_name ?? ""].some((v) => v.toLowerCase().includes(q)),
        )
      : conversations;
    const column = COLUMNS.find((c) => c.id === sortKey);
    if (!column) return matched;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...matched].sort((a, b) => {
      const [x, y] = [column.sortValue(a), column.sortValue(b)];
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
  }, [conversations, search, sortKey, sortDir]);

  return {
    returnTo: returnTo ?? pathname,
    search,
    setSearch,
    totalCount: conversations.length,
    sortKey,
    sortDir,
    toggleSort,
    available: available.map(({ id, label, required }) => ({ id, label, required })),
    shownIds: shown.map((c) => c.id),
    isVisible: columnState.isVisible,
    toggleColumn: columnState.toggle,
    resetColumns: columnState.reset,
    rows,
    pagination: usePagination(rows),
  };
}

interface ChatConversationsTableProps {
  table: ChatConversationsTableState;
  loading: boolean;
  emptyMessage?: string;
}

/**
 * The conversation table itself: flat card, sortable headers, footer pagination.
 * It renders no controls of its own — search, filters and the columns menu live
 * in the breadcrumb section of the top bar, driven by the same table state.
 */
export function ChatConversationsTable({
  table,
  loading,
  emptyMessage = "No conversations found",
}: ChatConversationsTableProps) {
  const router = useRouter();
  const { rows, pagination, sortKey, sortDir, toggleSort, search, shownIds, returnTo } = table;
  const link = (conv: ChatConversationSummary) => withReturnTo(href(conv), returnTo);
  const shown = COLUMNS.filter((c) => shownIds.includes(c.id));

  const SortIcon = ({ id }: { id: ChatConversationSortKey }) => {
    if (sortKey !== id) return <ArrowUpDown className="h-4 w-4 text-muted-foreground" />;
    return sortDir === "asc" ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />;
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-pulse text-sm text-muted-foreground">Loading conversations...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {conversationsEmptyLabel(emptyMessage, search)}
        </p>
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-card)] border-[length:var(--surface-border-width)] border-border bg-card shadow-surface">
          <div className="overflow-x-auto">
            <Table className="min-w-max">
              <TableHeader>
                <TableRow className="bg-muted/50">
                  {shown.map((c) => (
                    <TableHead key={c.id} className="font-semibold">
                      <button type="button" className="inline-flex cursor-pointer items-center gap-1 hover:text-foreground" onClick={() => toggleSort(c.id)}>
                        {c.label}
                        <SortIcon id={c.id} />
                      </button>
                    </TableHead>
                  ))}
                  <TableHead className="text-right font-semibold">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagination.pageItems.map((conv) => (
                  <TableRow key={conv.id} className="cursor-pointer hover:bg-muted/50" onClick={() => router.push(link(conv))}>
                    {shown.map((c) => (
                      <TableCell key={c.id} className={c.cellClassName} title={c.cellTitle?.(conv)}>
                        {c.cell(conv, link(conv))}
                      </TableCell>
                    ))}
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <RowActionsMenu label={`Actions for conversation ${conv.id}`}>
                        <RowAction icon={<ExternalLink />} href={link(conv)}>View conversation</RowAction>
                      </RowActionsMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <TablePagination {...pagination} itemLabel="conversations" />
        </div>
      )}
    </div>
  );
}

/** A search that matches nothing is not the same as a channel with no conversations yet. */
function conversationsEmptyLabel(emptyMessage: string, search: string) {
  return search.trim() ? "No conversations match your search" : emptyMessage;
}
