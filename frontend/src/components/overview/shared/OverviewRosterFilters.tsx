"use client";

import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export interface RosterFilterOption<A extends string> {
  value: A | "all";
  label: string;
}

interface OverviewRosterFiltersProps<A extends string> {
  options: RosterFilterOption<A>[];
  filter: A | "all";
  onFilterChange: (filter: A | "all") => void;
  counts: Record<string, number>;
  query: string;
  onQueryChange: (query: string) => void;
  searchPlaceholder: string;
}

export function OverviewRosterFilters<A extends string>({
  options,
  filter,
  onFilterChange,
  counts,
  query,
  onQueryChange,
  searchPlaceholder,
}: OverviewRosterFiltersProps<A>) {
  return (
    <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center lg:w-auto">
      <Tabs value={filter} onValueChange={(value) => onFilterChange(value as A | "all")} className="max-w-full">
        <TabsList aria-label="Filter agents" className="w-full justify-start overflow-x-auto sm:w-auto">
          {options.map((option) => (
            <TabsTrigger key={option.value} value={option.value} className="flex-none shrink-0 px-3">
              {option.label}
              <span className="text-xs tabular-nums text-muted-foreground">{counts[option.value] ?? 0}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="relative w-full sm:w-56">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={searchPlaceholder}
          aria-label="Search agents"
          className="pl-9"
        />
      </div>
    </div>
  );
}
