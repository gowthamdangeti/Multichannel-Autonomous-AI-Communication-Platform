import type { WhatsAppAgentRow } from "@/client/types.gen";

import { titleCase } from "../shared/format";
import type { RosterFilterOption } from "../shared/OverviewRosterFilters";
import type { StatusTone } from "../shared/OverviewStatusBadge";

export type WhatsAppActivity = "live" | "idle" | "paused";

export const WHATSAPP_ACTIVITY: Record<WhatsAppActivity, { label: string; tone: StatusTone }> = {
  live: { label: "Chatting", tone: "on" },
  idle: { label: "No chats", tone: "idle" },
  paused: { label: "Paused", tone: "off" },
};

export const WHATSAPP_FILTERS: RosterFilterOption<WhatsAppActivity>[] = [
  { value: "all", label: "All" },
  { value: "live", label: WHATSAPP_ACTIVITY.live.label },
  { value: "idle", label: WHATSAPP_ACTIVITY.idle.label },
  { value: "paused", label: WHATSAPP_ACTIVITY.paused.label },
];

const NUMBER_STATUS_LABELS: Record<string, string> = {
  connected: "Connected",
  disconnected: "Disconnected",
  connecting: "Connecting",
  qr: "Waiting for QR scan",
  created: "Not set up",
  error: "Error",
};

export const numberStatusLabel = (status: string) => NUMBER_STATUS_LABELS[status] ?? titleCase(status);

export function whatsappActivity(agent: WhatsAppAgentRow): WhatsAppActivity {
  if (!agent.is_active) return "paused";
  return agent.active_contacts > 0 || agent.new_contacts > 0 ? "live" : "idle";
}

export const whatsappSearchText = (agent: WhatsAppAgentRow) => agent.name;

export const whatsappAgentHref = (agent: WhatsAppAgentRow) => `/whatsapp/agents/${agent.id}/view`;

export function numbersLabel(agent: WhatsAppAgentRow) {
  if (agent.numbers === 0) return "No number assigned";
  const plural = agent.numbers === 1 ? "number" : "numbers";
  return `${agent.numbers} ${plural} · ${agent.connected_numbers} connected`;
}
