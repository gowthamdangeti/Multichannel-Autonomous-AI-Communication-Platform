"use client";

import { useMemo } from "react";

import type { ChatConversationDetail } from "@/client/types.gen";
import { DetailPanel } from "@/components/detail-panel/DetailPanel";

/** Keys the backend stores for its own bookkeeping, not for the visitor session. */
const NOISE_KEY_PARTS = ["report", "trace", "node"];

/**
 * How an extracted value reads on screen: counts grouped, reply timing in ms,
 * arrays as a list. Nested objects are not extracted variables, so they are
 * skipped (`null`) rather than shown as "[object Object]".
 */
function displayValue(key: string, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim() === "" ? null : value;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    const lower = key.toLowerCase();
    if (lower.endsWith("_ms")) return `${value.toLocaleString("en-US")} ms`;
    if (lower.includes("token") || lower.includes("count") || lower.includes("messages")) {
      return value.toLocaleString("en-US");
    }
    return String(value);
  }
  if (Array.isArray(value)) {
    const items = value
      .filter((item) => item !== null && item !== undefined && typeof item !== "object" && String(item).trim() !== "")
      .map(String);
    return items.length > 0 ? items.join(", ") : null;
  }
  return null;
}

interface ChatConversationLeadInfoCardProps {
  conversation: ChatConversationDetail | null;
}

/**
 * What the session recorded about itself — the chat equivalent of the voice
 * page's extracted variables: disposition, message counts, models, tokens.
 */
export function ChatConversationLeadInfoCard({ conversation }: ChatConversationLeadInfoCardProps) {
  const entries = useMemo(() => {
    const gathered = conversation?.gathered_context ?? {};
    return Object.entries(gathered).flatMap(([key, value]) => {
      const lower = key.toLowerCase();
      if (NOISE_KEY_PARTS.some((part) => lower.includes(part))) return [];
      const text = displayValue(key, value);
      if (text === null) return [];
      const label = key
        .replace(/_ms$/, "")
        .replace(/_/g, " ")
        .replace(/^./, (c) => c.toUpperCase());
      return [{ key, label, text }];
    });
  }, [conversation?.gathered_context]);

  return (
    <DetailPanel title="Lead Info — Extracted Variables">
      {entries.length > 0 ? (
        <div className="space-y-2">
          {entries.map(({ key, label, text }) => (
            <div
              key={key}
              className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted px-2.5 py-1.5 text-xs"
            >
              <span className="font-semibold capitalize text-muted-foreground">{label}:</span>
              <span className="min-w-0 truncate font-mono text-foreground" title={text}>
                {text}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          No values recorded yet. A chat session fills this in as it runs — status, disposition, visitor and
          assistant message counts, the models used, token totals and average reply time.
        </p>
      )}
    </DetailPanel>
  );
}
