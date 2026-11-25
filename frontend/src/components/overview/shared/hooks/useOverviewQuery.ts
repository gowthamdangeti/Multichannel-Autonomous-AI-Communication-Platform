import { useCallback, useEffect, useRef, useState } from "react";

import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { detailFromError } from "@/lib/apiError";
import { useAuth } from "@/lib/auth";

/** What a generated-client call resolves to. */
interface ClientResult<T> {
  data?: T;
  error?: unknown;
}

type LoadMode = "initial" | "refresh" | "silent";

/**
 * Loads one channel's overview for a date range and keeps it live.
 * `fetchOverview` must be stable (a module-level function), or every render refetches.
 */
export function useOverviewQuery<T>(
  fetchOverview: (days: number) => Promise<ClientResult<T>>,
  days: number,
  loadError: string,
  options: {
    /** False leaves the query idle (no request) until it is needed. */
    enabled?: boolean;
    /**
     * Keep showing the previous range's data while a new range loads, instead of
     * emptying it. `loadedDays` then says which range the data on screen is for.
     */
    keepPrevious?: boolean;
  } = {},
) {
  const { enabled = true, keepPrevious = false } = options;
  const { user, loading: authLoading } = useAuth();
  const [data, setData] = useState<T | null>(null);
  const [loadedDays, setLoadedDays] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestRequest = useRef(0);
  const isFetching = useRef(false);

  const load = useCallback(
    async (mode: LoadMode = "initial") => {
      if (mode === "silent" && isFetching.current) return;
      const request = ++latestRequest.current;
      isFetching.current = true;
      if (mode === "initial") setIsLoading(true);
      if (mode === "refresh") setIsRefreshing(true);
      const response = await fetchOverview(days).catch(() => null);
      // A newer request owns the state: this one may be for the previous range.
      if (request !== latestRequest.current) return;
      isFetching.current = false;
      if (response?.data) {
        setData(response.data);
        setLoadedDays(days);
        setError(null);
      } else {
        setError(response?.error ? detailFromError(response.error, loadError) : loadError);
      }
      setIsLoading(false);
      setIsRefreshing(false);
    },
    [fetchOverview, days, loadError],
  );

  const isReady = !authLoading && Boolean(user) && enabled;

  useEffect(() => {
    if (!isReady) return;
    // Numbers from another range must not sit under the new heading, unless the
    // caller labels them with `loadedDays` and wants them kept to avoid a flash.
    if (!keepPrevious) setData(null);
    void load();
  }, [isReady, load, keepPrevious]);

  useLiveRefresh(
    useCallback(() => void load("silent"), [load]),
    isReady,
  );

  const reload = useCallback(() => void load("refresh"), [load]);

  return { data, loadedDays, isLoading, isRefreshing, error, reload };
}
