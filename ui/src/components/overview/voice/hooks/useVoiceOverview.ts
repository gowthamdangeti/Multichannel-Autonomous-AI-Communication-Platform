import { getVoiceAgentsOverviewApiV1OrganizationsReportsVoiceAgentsOverviewGet } from "@/client/sdk.gen";

import { useOverviewQuery } from "../../shared/hooks/useOverviewQuery";

const LOAD_ERROR = "We couldn't load your voice agents overview.";

const fetchVoiceOverview = (days: number) =>
  getVoiceAgentsOverviewApiV1OrganizationsReportsVoiceAgentsOverviewGet({ query: { days } });

export function useVoiceOverview(days: number) {
  return useOverviewQuery(fetchVoiceOverview, days, LOAD_ERROR);
}
