"use client";

import type { ChatAgentAnalyticsResponse } from "@/client/types.gen";
import { RangeTabs } from "@/components/charts/RangeTabs";
import { ChatBreakdown } from "@/components/overview/chat/ChatBreakdown";
import { OverviewSection } from "@/components/overview/shared/OverviewSection";
import { OverviewTiming } from "@/components/overview/shared/OverviewTiming";
import { Card } from "@/components/ui/card";
import { rangePhrase } from "@/lib/dateRange";

interface ChatAgentAnalyticsTabProps {
  analytics: ChatAgentAnalyticsResponse | null;
  days: number;
  loading: boolean;
  onDaysChange: (days: number) => void;
}

export function ChatAgentAnalyticsTab({ analytics, days, loading, onDaysChange }: ChatAgentAnalyticsTabProps) {
  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <p className="text-sm text-muted-foreground">Trends for {rangePhrase(days)}</p>
        <RangeTabs days={days} onChange={onDaysChange} />
      </Card>
      <OverviewSection id="chat-agent-sources" title="Where chats come from and how far they go" description="Websites and conversation length">
        <ChatBreakdown overview={analytics} loading={loading} />
      </OverviewSection>
      <OverviewSection id="chat-agent-timing" title="When visitors chat" description="Times are when the conversation started">
        <OverviewTiming hourly={analytics?.hourly ?? []} weekday={analytics?.weekday ?? []} unit="conversations" loading={loading} />
      </OverviewSection>
    </div>
  );
}
