import type { ChatAgentRow, ChatOverviewCount } from "@/client/types.gen";

import type { RosterFilterOption } from "../shared/OverviewRosterFilters";
import type { StatusTone } from "../shared/OverviewStatusBadge";

export type ChatActivity = "live" | "idle" | "paused";

export const CHAT_ACTIVITY: Record<ChatActivity, { label: string; tone: StatusTone }> = {
  live: { label: "Chatting", tone: "on" },
  idle: { label: "No chats", tone: "idle" },
  paused: { label: "Paused", tone: "off" },
};

export const CHAT_FILTERS: RosterFilterOption<ChatActivity>[] = [
  { value: "all", label: "All" },
  { value: "live", label: CHAT_ACTIVITY.live.label },
  { value: "idle", label: CHAT_ACTIVITY.idle.label },
  { value: "paused", label: CHAT_ACTIVITY.paused.label },
];

/** Bands by how many messages the visitor sent, shortest first. */
const LENGTH_BANDS: Array<{ key: string; label: string }> = [
  { key: "greeting_only", label: "Greeting only" },
  { key: "one_message", label: "1 visitor message" },
  { key: "two_to_five", label: "2–5 visitor messages" },
  { key: "six_plus", label: "6+ visitor messages" },
];

export function toLengthBands(lengths: ChatOverviewCount[]) {
  const counts = new Map(lengths.map((l) => [l.key, l.count]));
  return LENGTH_BANDS.map((band) => ({ name: band.label, calls: counts.get(band.key) ?? 0 }));
}

export const websiteLabel = (key: string) => (key === "unknown" ? "Unknown website" : key);

export function chatActivity(agent: ChatAgentRow): ChatActivity {
  if (!agent.is_active) return "paused";
  return agent.conversations > 0 ? "live" : "idle";
}

export const chatSearchText = (agent: ChatAgentRow) => `${agent.name} ${agent.top_website ?? ""}`;

// Chat agents are edited from one list page; there is no per-agent page yet.
export const CHAT_AGENTS_HREF = "/chat/agents";
