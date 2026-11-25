import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface OverviewRosterFrameProps {
  loading: boolean;
  isEmpty: boolean;
  onClearFilters: () => void;
  /** Desktop layout, shown from md up. */
  table: ReactNode;
  /** Phone layout: `<li>` cards, shown below md. */
  cards: ReactNode;
}

export function OverviewRosterFrame({ loading, isEmpty, onClearFilters, table, cards }: OverviewRosterFrameProps) {
  return (
    <Card className="overflow-hidden p-0">
      {loading ? (
        <div className="flex flex-col gap-2 p-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : isEmpty ? (
        <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
          <p className="text-sm text-muted-foreground">No agents match these filters.</p>
          <Button variant="outline" size="sm" onClick={onClearFilters}>
            Clear filters
          </Button>
        </div>
      ) : (
        <>
          <div className="hidden md:block">{table}</div>
          <ul className="divide-y divide-border md:hidden">{cards}</ul>
        </>
      )}
    </Card>
  );
}
