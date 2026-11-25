"use client";

import { Activity, Clock, Globe, Languages, MessageSquare } from "lucide-react";

import type { ChatConversationDetail } from "@/client/types.gen";
import { DASH, fmtDuration } from "@/components/chat-agent/chatAgentFormat";
import { DetailPanel, PanelTile, PanelTimeline } from "@/components/detail-panel/DetailPanel";
import { ChatStatusBadge } from "@/components/workflow-runs/RunBadges";
import { formatDateTime } from "@/lib/formatDateTime";

interface ChatConversationSessionOverviewCardProps {
  conversation: ChatConversationDetail | null;
  /** `updated_at - created_at`; null while the conversation loads. */
  durationMs: number | null;
}

/**
 * The voice run page's Session Overview, for a website chat session: channel,
 * language, duration and message count, the status, then the start/end times.
 */
export function ChatConversationSessionOverviewCard({
  conversation,
  durationMs,
}: ChatConversationSessionOverviewCardProps) {
  const runtime = (conversation?.initial_context?.runtime_configuration ?? {}) as Record<string, unknown>;
  const language = typeof runtime.language === "string" ? runtime.language.toUpperCase() : "";

  // The row's own `updated_at - created_at` is the live span; the stored
  // duration is the fallback when the timestamps are missing.
  const spanMs = durationMs ?? (conversation?.duration_seconds != null ? conversation.duration_seconds * 1000 : null);
  const startMs = conversation?.created_at ? new Date(conversation.created_at).getTime() : Number.NaN;
  const endedAt = Number.isFinite(startMs) && spanMs ? new Date(startMs + spanMs) : null;

  const timeline = [
    { label: "Started", value: conversation?.created_at ? formatDateTime(conversation.created_at) : DASH },
    ...(endedAt ? [{ label: "Ended", value: formatDateTime(endedAt.toISOString()) }] : []),
  ];

  return (
    <DetailPanel title="Session Overview">
      <div className="grid grid-cols-2 gap-2.5">
        <PanelTile icon={Globe} label="Channel">Website chat</PanelTile>
        <PanelTile icon={Languages} label="Language">{language || DASH}</PanelTile>
        <PanelTile icon={Clock} label="Duration">{fmtDuration(spanMs)}</PanelTile>
        <PanelTile icon={MessageSquare} label="Messages">
          {conversation ? conversation.message_count.toLocaleString("en-US") : DASH}
        </PanelTile>
      </div>
      <PanelTile icon={Activity} label="Status">
        {conversation ? <ChatStatusBadge status={conversation.status ?? "completed"} /> : DASH}
      </PanelTile>
      <PanelTimeline items={timeline} />
    </DetailPanel>
  );
}
