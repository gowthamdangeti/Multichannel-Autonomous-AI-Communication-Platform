import { useCallback, useEffect, useRef, useState } from "react";

import { getWorkflowAnalyticsApiV1WorkflowWorkflowIdAnalyticsGet } from "@/client/sdk.gen";
import type { AgentAnalyticsResponse } from "@/client/types.gen";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { useAuth } from "@/lib/auth";

const LOAD_ERROR = "We couldn't load this agent's analytics.";

/** Agent analytics; with `campaignId` only that campaign's runs of the agent are counted. */
export function useAgentAnalytics(workflowId: number, days: number, campaignId?: number) {
  const { user, loading: authLoading } = useAuth();
  const [analytics, setAnalytics] = useState<AgentAnalyticsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const latestRequest = useRef(0);
  const isFetching = useRef(false);

  const load = useCallback(
    async (silent = false) => {
      if (silent && isFetching.current) return;
      const request = ++latestRequest.current;
      isFetching.current = true;
      if (!silent) setIsLoading(true);
      const response = await getWorkflowAnalyticsApiV1WorkflowWorkflowIdAnalyticsGet({
        path: { workflow_id: workflowId },
        // getTimezoneOffset is minutes behind UTC, so it flips to minutes ahead.
        query: { days, tz_offset_minutes: -new Date().getTimezoneOffset(), ...(campaignId ? { campaign_id: campaignId } : {}) },
      }).catch(() => null);
      // A newer request owns the state: this one may be for the previous range.
      if (request !== latestRequest.current) return;
      isFetching.current = false;
      if (response?.data) {
        setAnalytics(response.data);
        setError(null);
        setLastUpdated(new Date());
      } else {
        setError(LOAD_ERROR);
      }
      setIsLoading(false);
    },
    [workflowId, days, campaignId],
  );

  useEffect(() => {
    if (authLoading || !user || !workflowId) return;
    // Numbers from another range or agent must not sit under the new heading.
    setAnalytics(null);
    setLastUpdated(null);
    void load();
  }, [authLoading, user, workflowId, load]);

  useLiveRefresh(
    useCallback(() => void load(true), [load]),
    !authLoading && Boolean(user) && Boolean(workflowId),
  );

  const reload = useCallback(() => load(), [load]);

  return { analytics, isLoading, error, lastUpdated, reload };
}
