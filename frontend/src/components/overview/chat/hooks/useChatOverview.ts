import { getChatAgentsOverviewApiV1OrganizationsReportsChatAgentsOverviewGet } from "@/client/sdk.gen";

import { useOverviewQuery } from "../../shared/hooks/useOverviewQuery";

const LOAD_ERROR = "We couldn't load your website chat overview.";

const fetchChatOverview = (days: number) =>
  getChatAgentsOverviewApiV1OrganizationsReportsChatAgentsOverviewGet({ query: { days } });

export function useChatOverview(days: number) {
  return useOverviewQuery(fetchChatOverview, days, LOAD_ERROR);
}
