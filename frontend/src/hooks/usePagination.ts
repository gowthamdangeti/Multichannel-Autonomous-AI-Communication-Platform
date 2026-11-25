import { useMemo, useState } from "react";

import { clampPage, DEFAULT_PAGE_SIZE, getPageCount, getPageItems } from "@/lib/pagination";

export function usePagination<T>(items: T[], pageSize: number = DEFAULT_PAGE_SIZE) {
  const [requestedPage, setPage] = useState(1);

  const totalCount = items.length;
  const totalPages = getPageCount(totalCount, pageSize);
  const page = clampPage(requestedPage, totalPages);
  const pageItems = useMemo(() => getPageItems(items, page, pageSize), [items, page, pageSize]);

  return { pageItems, page, totalPages, totalCount, setPage };
}
