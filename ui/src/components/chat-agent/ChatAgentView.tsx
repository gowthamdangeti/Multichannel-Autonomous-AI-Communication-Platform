"use client";

import { Code, Pencil, RefreshCw } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { ChatAgent } from "@/components/chat-agent/editor/chatAgentDraft";
import { ChatAgentEditorDrawer } from "@/components/chat-agent/editor/ChatAgentEditorDrawer";
import { useChatConversations } from "@/components/chat-conversation/hooks/useChatConversations";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/context/HeaderContext";
import { DEFAULT_RANGE_DAYS } from "@/lib/dateRange";
import { cn } from "@/lib/utils";

import { ChatAgentAnalyticsTab } from "./ChatAgentAnalyticsTab";
import { ChatAgentConversationsTab } from "./ChatAgentConversationsTab";
import { ChatAgentDashboardTab } from "./ChatAgentDashboardTab";
import { ChatAgentEmbedDialog } from "./ChatAgentEmbedDialog";
import { modelConfigNameOf } from "./chatAgentFormat";
import { CHAT_AGENT_TAB_LABELS, ChatAgentHeader, type ChatAgentTab } from "./ChatAgentHeader";
import { useChatAgent } from "./hooks/useChatAgent";
import { useChatAgentAnalytics } from "./hooks/useChatAgentAnalytics";
import { useModelPresets } from "./hooks/useModelPresets";

export function ChatAgentView({ agentId }: { agentId: number }) {
  // `?tab=` lets a breadcrumb or Back link land on a tab, as on the voice agent page.
  const requestedTab = useSearchParams().get("tab");
  const [tab, setTab] = useState<ChatAgentTab>(
    requestedTab && requestedTab in CHAT_AGENT_TAB_LABELS ? (requestedTab as ChatAgentTab) : "dashboard",
  );
  const [days, setDays] = useState(DEFAULT_RANGE_DAYS);
  const [conversationCount, setConversationCount] = useState<number | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [embedOpen, setEmbedOpen] = useState(false);
  const { agent, error: agentError, reload: reloadAgent } = useChatAgent(agentId);
  const { data: analytics, isLoading, isRefreshing, error, reload } = useChatAgentAnalytics(agentId, days);
  // The token usage card has its own range: changing it refetches only that card's
  // numbers, so the rest of the dashboard never reloads. While it matches the page
  // range it reuses the page's data and makes no second request.
  const [tokenDays, setTokenDays] = useState(DEFAULT_RANGE_DAYS);
  const tokenSeparate = tokenDays !== days;
  const tokenQuery = useChatAgentAnalytics(agentId, tokenDays, { enabled: tokenSeparate, keepPrevious: true });
  // What the card shows: its own data once it has some, else the page's. Either way
  // the previous numbers stay on screen (labelled with their own range) until the
  // new range arrives, so the card never empties or reflows.
  const tokenShown = tokenSeparate ? (tokenQuery.data ?? analytics) : analytics;
  const tokenShownDays = tokenSeparate && tokenQuery.data ? (tokenQuery.loadedDays ?? tokenDays) : days;
  const tokenRefreshing = tokenSeparate && tokenQuery.isLoading;
  const { presets } = useModelPresets();

  // The Conversations tab's rows and table state live here, deferred until that
  // tab is actually opened.
  const { rows: conversationRows, error: conversationsError, reload: reloadConversations } = useChatConversations({
    enabled: tab === "conversations",
  });
  const myConversations = useMemo(
    () => (conversationRows ?? []).filter((c) => c.chat_agent_id === agentId),
    [conversationRows, agentId],
  );

  useEffect(() => {
    if (conversationRows) setConversationCount(myConversations.length);
  }, [conversationRows, myConversations.length]);

  const modelConfigName = modelConfigNameOf(agent ?? {}, presets);

  const handleRefresh = useCallback(() => {
    reload();
    if (tokenSeparate) tokenQuery.reload();
    void reloadAgent();
    if (tab === "conversations") void reloadConversations();
  }, [reload, tokenQuery, tokenSeparate, reloadAgent, reloadConversations, tab]);

  const failure = agentError ?? (error && !analytics ? error : null);

  return (
    <div className="space-y-4 px-4 pb-6 pt-2 lg:px-6">
      <PageHeader
        title={agent?.name ?? "Chat Agent"}
        breadcrumbs={[
          { label: "Chat agents", href: "/chat/agents" },
          ...(agent?.name
            ? [{ label: agent.name, href: tab !== "dashboard" ? `/chat/agents/${agentId}/view` : undefined }]
            : []),
          { label: CHAT_AGENT_TAB_LABELS[tab] },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => setEditorOpen(true)}
            >
              <Pencil className="h-3.5 w-3.5" />
              Customize Agent
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => setEmbedOpen(true)}
            >
              <Code className="h-3.5 w-3.5" />
              Embed
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={handleRefresh}
              disabled={isLoading || isRefreshing}
              aria-label="Refresh agent"
              title="Refresh"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", (isLoading || isRefreshing) && "animate-spin")} />
            </Button>
          </div>
        }
      />
      <ChatAgentHeader
        name={agent?.name}
        description={agent?.description}
        createdAt={agent?.created_at}
        conversations={conversationCount ?? analytics?.summary.conversations ?? null}
        modelConfigName={modelConfigName}
        activeTab={tab}
        isRefreshing={isRefreshing}
        onTabChange={setTab}
        onRefresh={handleRefresh}
        onCustomize={() => setEditorOpen(true)}
        onEmbed={() => setEmbedOpen(true)}
      />
      {failure ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{failure}</div>
      ) : tab === "dashboard" ? (
        <ChatAgentDashboardTab
          analytics={analytics}
          days={days}
          loading={isLoading}
          tokenAnalytics={tokenShown}
          tokenDays={tokenDays}
          tokenDataDays={tokenShownDays}
          tokenLoading={tokenSeparate ? tokenQuery.isLoading : isLoading}
          tokenRefreshing={tokenRefreshing}
          onTokenDaysChange={setTokenDays}
        />
      ) : tab === "analytics" ? (
        <ChatAgentAnalyticsTab analytics={analytics} days={days} loading={isLoading} onDaysChange={setDays} />
      ) : (
        <ChatAgentConversationsTab
          conversations={myConversations}
          loading={conversationRows === null}
          error={conversationsError}
          agentId={agentId}
        />
      )}
      <ChatAgentEmbedDialog
        open={embedOpen}
        onOpenChange={setEmbedOpen}
        agentName={agent?.name}
        embedScript={agent?.embed_script}
        allowedDomains={agent?.allowed_domains}
      />
      <ChatAgentEditorDrawer
        open={editorOpen}
        agent={agent as ChatAgent | null}
        onOpenChange={setEditorOpen}
        onSaved={() => {
          // The page's name, model config and counts all come from the saved agent.
          void reloadAgent();
          reload();
        }}
      />
    </div>
  );
}
