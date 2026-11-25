import { getWhatsappAgentsOverviewApiV1OrganizationsReportsWhatsappAgentsOverviewGet } from "@/client/sdk.gen";

import { useOverviewQuery } from "../../shared/hooks/useOverviewQuery";

const LOAD_ERROR = "We couldn't load your WhatsApp overview.";

const fetchWhatsAppOverview = (days: number) =>
  getWhatsappAgentsOverviewApiV1OrganizationsReportsWhatsappAgentsOverviewGet({ query: { days } });

export function useWhatsAppOverview(days: number) {
  return useOverviewQuery(fetchWhatsAppOverview, days, LOAD_ERROR);
}
