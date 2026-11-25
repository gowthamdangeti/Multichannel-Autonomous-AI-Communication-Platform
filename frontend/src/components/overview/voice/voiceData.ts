import type { VoiceAgentRow } from "@/client/types.gen";

import { titleCase } from "../shared/format";
import type { RosterFilterOption } from "../shared/OverviewRosterFilters";
import type { StatusTone } from "../shared/OverviewStatusBadge";

export type VoiceActivity = "live" | "idle" | "archived";

export const VOICE_ACTIVITY: Record<VoiceActivity, { label: string; tone: StatusTone }> = {
  live: { label: "Taking calls", tone: "on" },
  idle: { label: "No calls", tone: "idle" },
  archived: { label: "Archived", tone: "off" },
};

export const VOICE_FILTERS: RosterFilterOption<VoiceActivity>[] = [
  { value: "all", label: "All" },
  { value: "live", label: VOICE_ACTIVITY.live.label },
  { value: "idle", label: VOICE_ACTIVITY.idle.label },
  { value: "archived", label: VOICE_ACTIVITY.archived.label },
];

const CHANNEL_LABELS: Record<string, string> = {
  webrtc: "Web call",
  smallwebrtc: "Web call",
  ari: "Asterisk",
  twilio: "Twilio",
  plivo: "Plivo",
  vonage: "Vonage",
  vobiz: "Vobiz",
  cloudonix: "Cloudonix",
  telnyx: "Telnyx",
};

const STATE_LABELS: Record<string, string> = {
  completed: "Completed",
  running: "In progress",
  initialized: "Never connected",
};

export const channelLabel = (mode: string | null | undefined) =>
  mode ? (CHANNEL_LABELS[mode] ?? titleCase(mode)) : "—";

export const stateLabel = (state: string) => STATE_LABELS[state] ?? titleCase(state);

export function voiceActivity(agent: VoiceAgentRow): VoiceActivity {
  if (agent.status === "archived") return "archived";
  return agent.calls > 0 ? "live" : "idle";
}

export const voiceSearchText = (agent: VoiceAgentRow) => `${agent.name} ${agent.folder_name ?? ""}`;

export const voiceAgentHref = (agent: VoiceAgentRow) => `/workflow/${agent.id}`;
