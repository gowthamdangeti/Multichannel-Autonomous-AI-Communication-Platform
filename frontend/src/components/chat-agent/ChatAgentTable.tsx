"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Brain, Code2, Eye, Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import type { ChatAgentResponse, ModelConfigurationOption } from "@/client/types.gen";
import { RowAction, RowActionSeparator, RowActionsMenu } from "@/components/layout/RowActionsMenu";
import { TableNameLink } from "@/components/layout/TableNameLink";
import { TablePagination } from "@/components/layout/TablePagination";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePagination } from "@/hooks/usePagination";

import { DASH, modelConfigNameOf } from "./chatAgentFormat";

type SortKey = "id" | "name" | "model" | "created_at" | "total_runs";
type SortDir = "asc" | "desc";

/** The fields the table reads, so any chat-agent shape that has them fits. */
type TableAgent = Pick<ChatAgentResponse, "id" | "name" | "is_active" | "created_at"> & {
  model_config_ref?: Record<string, unknown>;
  total_runs?: number | null;
};

interface ChatAgentTableProps<T extends TableAgent> {
  agents: T[];
  presets: ModelConfigurationOption[];
  onEmbed: (agent: T) => void;
  onEdit: (agent: T) => void;
  onDelete: (agent: T) => void;
}

const HEADERS: Array<{ key: SortKey; label: string }> = [
  { key: "id", label: "ID" },
  { key: "name", label: "Agent Name" },
  { key: "model", label: "Model Config" },
  { key: "created_at", label: "Created At" },
  { key: "total_runs", label: "Total Runs" },
];

export function ChatAgentTable<T extends TableAgent>({ agents, presets, onEmbed, onEdit, onDelete }: ChatAgentTableProps<T>) {
  const router = useRouter();
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Click cycles ascending, descending, then back to server order.
  const toggleSort = (key: SortKey) => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
    } else if (sortDir === "asc") {
      setSortDir("desc");
    } else {
      setSortKey(null);
      setSortDir("asc");
    }
  };

  const sorted = useMemo(() => {
    if (!sortKey) return agents;
    const dir = sortDir === "asc" ? 1 : -1;
    const value = (a: T): string | number => {
      switch (sortKey) {
        case "id":
          return a.id;
        case "name":
          return a.name.toLowerCase();
        case "model":
          return (modelConfigNameOf(a, presets) ?? "").toLowerCase();
        case "created_at":
          return a.created_at ? new Date(a.created_at).getTime() : 0;
        case "total_runs":
          return a.total_runs ?? 0;
      }
    };
    return [...agents].sort((a, b) => {
      const [x, y] = [value(a), value(b)];
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
  }, [agents, presets, sortKey, sortDir]);

  const pagination = usePagination(sorted);

  const SortIcon = ({ column }: { column: SortKey }) => {
    if (sortKey !== column) return <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground/60" />;
    return sortDir === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />;
  };

  return (
    <Card className="nb-card overflow-hidden border border-border">
      <CardContent className="p-0">
        <Table>
          <TableHeader className="nb-table-header">
            <TableRow>
              {HEADERS.map((h) => (
                <TableHead key={h.key} className={`font-semibold ${h.key === "total_runs" ? "text-center" : ""}`}>
                  <button
                    type="button"
                    onClick={() => toggleSort(h.key)}
                    className="inline-flex cursor-pointer items-center gap-1 hover:text-foreground"
                    aria-label={`Sort by ${h.label}`}
                  >
                    {h.label} <SortIcon column={h.key} />
                  </button>
                </TableHead>
              ))}
              <TableHead className="text-right font-semibold">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagination.pageItems.map((a) => {
              const model = modelConfigNameOf(a, presets);
              const href = `/chat/agents/${a.id}/view`;
              return (
                <TableRow key={a.id} onClick={() => router.push(href)} className="cursor-pointer transition-colors hover:bg-accent/50">
                  <TableCell className="font-mono text-muted-foreground">#{a.id}</TableCell>
                  <TableCell className="font-medium">
                    <TableNameLink href={href}>{a.name}</TableNameLink>
                  </TableCell>
                  <TableCell>
                    {model ? (
                      <span className="inline-flex items-center gap-1.5 rounded-md border border-primary/20 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                        <Brain className="h-3.5 w-3.5" /> {model}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">{DASH}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {a.created_at
                      ? new Date(a.created_at).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
                      : DASH}
                  </TableCell>
                  <TableCell className="text-center">
                    <span className="inline-flex min-w-[2rem] items-center justify-center rounded-full bg-muted px-2 py-1 text-sm font-semibold text-foreground">
                      {a.total_runs || 0}
                    </span>
                  </TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    <RowActionsMenu label={`Actions for ${a.name}`}>
                      <RowAction icon={<Eye />} href={href}>View</RowAction>
                      <RowAction icon={<Code2 />} onClick={() => onEmbed(a)}>Embed</RowAction>
                      <RowAction icon={<Pencil />} onClick={() => onEdit(a)}>Edit</RowAction>
                      <RowActionSeparator />
                      <RowAction icon={<Trash2 />} onClick={() => onDelete(a)} destructive>Delete</RowAction>
                    </RowActionsMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <TablePagination {...pagination} />
      </CardContent>
    </Card>
  );
}
