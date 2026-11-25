"use client";

import { MessageSquare } from "lucide-react";
import { type ReactNode, useMemo } from "react";

import { rangePhrase, rangeTitle } from "@/lib/dateRange";

import { OverviewEmptyState } from "../shared/OverviewEmptyState";
import { OverviewErrorCard } from "../shared/OverviewErrorCard";
import { OverviewHeader } from "../shared/OverviewHeader";
import { OverviewSection } from "../shared/OverviewSection";
import { OverviewTiming } from "../shared/OverviewTiming";
import { OverviewTrendChart } from "../shared/OverviewTrendChart";
import { ChatAgentRoster } from "./ChatAgentRoster";
import { ChatBreakdown } from "./ChatBreakdown";
import { ChatKpiGrid } from "./ChatKpiGrid";
import { useChatOverview } from "./hooks/useChatOverview";

export function ChatOverview({ days, headerControls }: { days: number; headerControls: ReactNode }) {
  const { data: overview, isLoading, isRefreshing, error, reload } = useChatOverview(days);
  const trend = useMemo(
    () => (overview?.daily ?? []).map((d) => ({ date: d.date, primary: d.conversations, secondary: d.messages })),
    [overview],
  );

  return (
    <>
      <OverviewHeader
        subtitle={`${rangeTitle(days)} of conversations across every website chat agent`}
        onRefresh={reload}
        isRefreshing={isRefreshing}
        headerControls={headerControls}
      />
      {error && !overview ? (
        <OverviewErrorCard message={error} onRetry={reload} />
      ) : overview && overview.agents.length === 0 ? (
        <OverviewEmptyState
          icon={MessageSquare}
          title="No website chat agents yet"
          body="Create a chat agent from the Chat Agents page and add its widget to your site. Its conversations will show up here."
        />
      ) : (
        <>
          <OverviewSection id="chat-glance" title="At a glance" description={`How your chat agents did over ${rangePhrase(days)}`}>
            <ChatKpiGrid summary={overview?.summary ?? null} days={days} loading={isLoading} />
          </OverviewSection>
          <OverviewSection id="chat-activity" title="Conversation activity" description="Conversations started and messages exchanged per day">
            <OverviewTrendChart rows={trend} primaryLabel="Conversations" secondaryLabel="Messages" emptyLabel="No conversations in this period" loading={isLoading} />
          </OverviewSection>
          <ChatAgentRoster
            id="chat-agents"
            title="Your chat agents"
            description="Every agent, busiest first"
            agents={overview?.agents ?? []}
            loading={isLoading}
          />
          <OverviewSection id="chat-sources" title="Where chats come from and how far they go" description="Websites and conversation length">
            <ChatBreakdown overview={overview} loading={isLoading} />
          </OverviewSection>
          <OverviewSection id="chat-timing" title="When visitors chat" description="Times are when the conversation started">
            <OverviewTiming hourly={overview?.hourly ?? []} weekday={overview?.weekday ?? []} unit="conversations" loading={isLoading} />
          </OverviewSection>
        </>
      )}
    </>
  );
}
