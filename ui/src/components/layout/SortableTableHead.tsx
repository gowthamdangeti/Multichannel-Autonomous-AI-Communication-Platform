import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { ReactNode } from "react";

import { TableHead } from "@/components/ui/table";
import type { SortDirection } from "@/hooks/useTableSort";
import { cn } from "@/lib/utils";

interface SortableTableHeadProps<K extends string> {
    column: K;
    label: ReactNode;
    sortKey: K | null;
    sortDir: SortDirection;
    onSort: (column: K) => void;
    className?: string;
}

/** Table header that sorts its column on click, with the current direction icon. */
export function SortableTableHead<K extends string>({
    column,
    label,
    sortKey,
    sortDir,
    onSort,
    className,
}: SortableTableHeadProps<K>) {
    const isActive = sortKey === column;
    const ariaSort = isActive ? (sortDir === "asc" ? "ascending" : "descending") : "none";

    return (
        <TableHead aria-sort={ariaSort} className={cn("font-semibold text-muted-foreground", className)}>
            <button
                type="button"
                onClick={() => onSort(column)}
                className="inline-flex cursor-pointer items-center gap-1 hover:text-foreground"
            >
                {label}
                {!isActive ? (
                    <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground/60" />
                ) : sortDir === "asc" ? (
                    <ArrowUp className="h-3.5 w-3.5 text-foreground" />
                ) : (
                    <ArrowDown className="h-3.5 w-3.5 text-foreground" />
                )}
            </button>
        </TableHead>
    );
}
