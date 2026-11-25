/** Shared formatting for chat-agent pages; a missing value is a dash, never a zero. */
export const DASH = "—";

export const fmtTokens = (value: number | null | undefined) =>
  value === null || value === undefined ? DASH : value.toLocaleString("en");

export function fmtLatency(ms: number | null | undefined) {
  if (ms === null || ms === undefined) return DASH;
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
}

export function fmtWhen(iso: string | null | undefined) {
  if (!iso) return DASH;
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function websiteOf(origin: string | null | undefined) {
  if (!origin) return "Website visitor";
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}

/** A session span as `12s`, `4m 30s` or `1h 5m`; a dash when it is unknown. */
export function fmtDuration(ms: number | null | undefined) {
  if (ms === null || ms === undefined || Number.isNaN(ms) || ms < 0) return DASH;
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

/** Anything carrying an agent's optional model configuration reference. */
type AgentLike = { model_config_ref?: Record<string, unknown> | null };

/**
 * The name of the model configuration this agent replies with, or null when the
 * organization has none.
 *
 * Mirrors the runtime resolution order — the selected preset, then the default
 * preset, which the model-configuration-options endpoint returns first — so an
 * agent with nothing stored still shows the configuration it actually runs on.
 */
export function modelConfigNameOf(agent: AgentLike, presets: readonly { id: number; name: string }[]) {
  const id = agent.model_config_ref?.platform_model_configuration_id;
  const selected = id == null ? undefined : presets.find((p) => p.id === Number(id));
  return (selected ?? presets[0])?.name ?? null;
}
