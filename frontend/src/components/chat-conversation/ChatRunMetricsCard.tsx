"use client";

import { RefreshCw } from "lucide-react";

import type { ChatConversationDetail } from "@/client/types.gen";
import { DASH, fmtDuration, fmtLatency, fmtTokens } from "@/components/chat-agent/chatAgentFormat";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import type { ChatConversationStats } from "./chatConversationStats";
import { ChatMetricTile } from "./ChatMetricTile";

interface ChatRunMetricsCardProps {
  conversation: ChatConversationDetail | null;
  stats: ChatConversationStats | null;
  /** Session span, `updated_at - created_at`; null while the conversation loads. */
  durationMs: number | null;
  onRefresh: () => void;
  isRefreshing: boolean;
}

/**
 * The chat analog of the voice run page's "Run Metrics" card: what this session
 * did, read straight from the stored messages (no estimates).
 */
export function ChatRunMetricsCard({
  conversation,
  stats,
  durationMs,
  onRefresh,
  isRefreshing,
}: ChatRunMetricsCardProps) {
  const totalTokens =
    stats?.promptTokens === null || stats?.completionTokens === null
      ? stats?.promptTokens ?? stats?.completionTokens ?? null
      : (stats?.promptTokens ?? 0) + (stats?.completionTokens ?? 0);

  return (
    <Card className="overflow-hidden border-border bg-card/60 shadow-sm backdrop-blur-sm">
      <CardHeader className="flex flex-row items-center justify-between border-b border-border p-4 pb-3">
        <CardTitle className="text-xs font-bold uppercase tracking-wider text-foreground">
          Run Metrics
        </CardTitle>
        <Button
          variant="outline"
          size="sm"
          onClick={onRefresh}
          disabled={isRefreshing}
          className="h-6 gap-1 border-border/60 px-2 font-mono text-[10px] uppercase tracking-wider hover:bg-muted/60"
        >
          <RefreshCw className={cn("h-3 w-3", isRefreshing && "animate-spin")} />
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3 p-4 pt-3 md:grid-cols-3">
        <ChatMetricTile label="Messages" value={conversation?.message_count ?? DASH} />
        <ChatMetricTile label="User Turns" value={stats ? stats.visitorMessages : DASH} />
        <ChatMetricTile label="Bot Turns" value={stats ? stats.assistantMessages : DASH} />
        <ChatMetricTile label="Token Usage" value={fmtTokens(totalTokens)} />
        <ChatMetricTile label="Avg Reply Time" value={fmtLatency(stats?.avgLatencyMs)} />
        <ChatMetricTile label="Session Duration" value={fmtDuration(durationMs)} />
      </CardContent>
    </Card>
  );
}
