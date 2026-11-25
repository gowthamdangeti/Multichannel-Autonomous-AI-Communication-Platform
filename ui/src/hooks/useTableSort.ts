import { useMemo, useState } from "react";

export type SortDirection = "asc" | "desc";

/** Value a column sorts by; strings compare naturally ("Org 2" before "Org 10"). */
export type SortValue = string | number | boolean | null | undefined;

export interface TableSortState<K extends string> {
    sortKey: K | null;
    sortDir: SortDirection;
}

export interface UseTableSortResult<T, K extends string> extends TableSortState<K> {
    sortedItems: T[];
    /** Same column cycles ascending -> descending -> unsorted; a new column starts ascending. */
    toggleSort: (key: K) => void;
}

const isEmpty = (value: SortValue) => value === null || value === undefined || value === "" || value === "—";

function compareValues(a: SortValue, b: SortValue): number {
    if (typeof a === "number" && typeof b === "number") return a - b;
    if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

/**
 * Client-side header sorting for a table. `accessors` maps each sortable
 * column to the value it sorts by; define it outside the component so it stays
 * stable. Empty values ("", "—", null) always sink to the bottom.
 */
export function useTableSort<T, K extends string>(
    items: T[],
    accessors: Record<K, (item: T) => SortValue>,
    initial: TableSortState<K> = { sortKey: null, sortDir: "asc" },
): UseTableSortResult<T, K> {
    const [sortKey, setSortKey] = useState<K | null>(initial.sortKey);
    const [sortDir, setSortDir] = useState<SortDirection>(initial.sortDir);

    const toggleSort = (key: K) => {
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

    const sortedItems = useMemo(() => {
        if (!sortKey) return items;
        const accessor = accessors[sortKey];
        const direction = sortDir === "asc" ? 1 : -1;
        return [...items].sort((a, b) => {
            const aValue = accessor(a);
            const bValue = accessor(b);
            if (isEmpty(aValue) || isEmpty(bValue)) {
                return Number(isEmpty(aValue)) - Number(isEmpty(bValue));
            }
            return compareValues(aValue, bValue) * direction;
        });
    }, [items, accessors, sortKey, sortDir]);

    return { sortedItems, sortKey, sortDir, toggleSort };
}
