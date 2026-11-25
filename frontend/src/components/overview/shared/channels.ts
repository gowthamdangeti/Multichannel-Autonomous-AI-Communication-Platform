export type OverviewChannel = "voice" | "chat" | "whatsapp" | "email";

export interface OverviewChannelOption {
  id: OverviewChannel;
  label: string;
  /** Set while the channel has no agents to report on yet. */
  unavailable?: string;
}

export const OVERVIEW_CHANNELS: OverviewChannelOption[] = [
  { id: "voice", label: "Voice" },
  { id: "chat", label: "Website chat" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "email", label: "Email", unavailable: "Soon" },
];

export const DEFAULT_CHANNEL: OverviewChannel = "voice";

export function toChannel(value: string | null): OverviewChannel {
  const match = OVERVIEW_CHANNELS.find((c) => c.id === value && !c.unavailable);
  return match?.id ?? DEFAULT_CHANNEL;
}
