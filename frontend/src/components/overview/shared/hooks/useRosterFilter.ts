import { useMemo, useState } from "react";

/** Search plus an activity filter over one channel's agent roster. */
export function useRosterFilter<T, A extends string>(
  items: T[],
  activityOf: (item: T) => A,
  searchTextOf: (item: T) => string,
) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<A | "all">("all");

  const counts = useMemo(() => {
    const tally: Record<string, number> = { all: items.length };
    for (const item of items) {
      const activity = activityOf(item);
      tally[activity] = (tally[activity] ?? 0) + 1;
    }
    return tally;
  }, [items, activityOf]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      if (filter !== "all" && activityOf(item) !== filter) return false;
      return !needle || searchTextOf(item).toLowerCase().includes(needle);
    });
  }, [items, filter, query, activityOf, searchTextOf]);

  const clear = () => {
    setQuery("");
    setFilter("all");
  };

  return { query, setQuery, filter, setFilter, counts, visible, clear };
}
