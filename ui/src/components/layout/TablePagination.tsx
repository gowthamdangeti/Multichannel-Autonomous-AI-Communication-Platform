import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { getPageNumbers } from "@/lib/pagination";

const DISABLED_CLASS = "pointer-events-none opacity-50";

interface TablePaginationProps {
  page: number;
  totalPages: number;
  totalCount: number;
  setPage: (page: number) => void;
  /** What one row is, for the footer count ("items" when the table does not say). */
  itemLabel?: string;
}

export function TablePagination({ page, totalPages, totalCount, setPage, itemLabel = "items" }: TablePaginationProps) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/10 p-4 px-6">
      <p className="text-sm text-muted-foreground">
        Page {page} of {totalPages} ({totalCount} total {itemLabel})
      </p>
      <Pagination className="mx-0 w-auto justify-end">
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              onClick={() => setPage(page - 1)}
              className={page <= 1 ? DISABLED_CLASS : "cursor-pointer"}
            />
          </PaginationItem>
          {getPageNumbers(page, totalPages).map((number, index) =>
            number === "ellipsis" ? (
              <PaginationItem key={`ellipsis-${index}`}>
                <PaginationEllipsis />
              </PaginationItem>
            ) : (
              <PaginationItem key={number}>
                <PaginationLink isActive={number === page} onClick={() => setPage(number)} className="cursor-pointer">
                  {number}
                </PaginationLink>
              </PaginationItem>
            )
          )}
          <PaginationItem>
            <PaginationNext
              onClick={() => setPage(page + 1)}
              className={page >= totalPages ? DISABLED_CLASS : "cursor-pointer"}
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}
