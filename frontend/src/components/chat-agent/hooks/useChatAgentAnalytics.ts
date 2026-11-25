import { useCallback } from "react";

import { getAgentAnalyticsApiV1ChatAgentsAgentIdAnalyticsGet } from "@/client/sdk.gen";
import { useOverviewQuery } from "@/components/overview/shared/hooks/useOverviewQuery";

const LOAD_ERROR = "We could not load this chat agent's analytics.";

/** One chat agent's conversations, timing and reported reply usage for a date range. */
export function useChatAgentAnalytics(
  agentId: number,
  days: number,
  options?: { enabled?: boolean; keepPrevious?: boolean },
) {
  const fetchAnalytics = useCallback(
    (range: number) =>
      getAgentAnalyticsApiV1ChatAgentsAgentIdAnalyticsGet({ path: { agent_id: agentId }, query: { days: range } }),
    [agentId],
  );
  return useOverviewQuery(fetchAnalytics, days, LOAD_ERROR, options);
}
