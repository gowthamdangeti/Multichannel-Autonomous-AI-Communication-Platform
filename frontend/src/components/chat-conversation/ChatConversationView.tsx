"use client";

import {
  Activity,
  Calendar,
  Clock,
  Cpu,
  Eye,
  MessageSquare,
  Pencil,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import {
  fmtWhen,
  modelConfigNameOf,
  websiteOf,
} from "@/components/chat-agent/chatAgentFormat";
import type { ChatAgent } from "@/components/chat-agent/editor/chatAgentDraft";
import { ChatAgentEditorDrawer } from "@/components/chat-agent/editor/ChatAgentEditorDrawer";
import { useChatAgent } from "@/components/chat-agent/hooks/useChatAgent";
import { useModelPresets } from "@/components/chat-agent/hooks/useModelPresets";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { UnderlineTabs } from "@/components/ui/underline-tabs";
import {
  type ConversationCompleteness,
  ConversationCompletenessCard,
} from "@/components/workflow/ConversationCompleteness";
import { PageHeader } from "@/context/HeaderContext";
import { useOrgConfig } from "@/context/OrgConfigContext";
import { accountHolderName } from "@/lib/accountHolder";
import { readReturnTo } from "@/lib/returnTo";
import { cn } from "@/lib/utils";

import { ChatAnalyticsCharts } from "./ChatAnalyticsCharts";
import { ChatContextCard } from "./ChatContextCard";
import { ChatConversationEmbedConfigCard } from "./ChatConversationEmbedConfigCard";
import { ChatConversationIdentifiersCard } from "./ChatConversationIdentifiersCard";
import { ChatConversationLeadInfoCard } from "./ChatConversationLeadInfoCard";
import { ChatConversationSessionOverviewCard } from "./ChatConversationSessionOverviewCard";
import { summarizeConversation } from "./chatConversationStats";
import { ChatRunMetricsCard } from "./ChatRunMetricsCard";
import { ChatSessionSidebar } from "./ChatSessionSidebar";
import { ChatTranscriptCard } from "./ChatTranscriptCard";
import { ChatUsageBreakdownCard } from "./ChatUsageBreakdownCard";
import { useChatConversation } from "./hooks/useChatConversation";

type ConversationTab = "dashboard" | "transcript" | "analytics";

const TABS: { value: ConversationTab; label: string }[] = [
  { value: "dashboard", label: "Dashboard View" },
  { value: "transcript", label: "Transcript Only" },
  { value: "analytics", label: "Analytics" },
];

function formatRunDateShort(dateString?: string | null) {
  if (!dateString) return null;
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return null;
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
    });
  } catch {
    return null;
  }
}

function formatDurationTimestamp(seconds?: number | null) {
  if (seconds == null || Number.isNaN(seconds) || seconds <= 0) return "0:00";
  const totalSecs = Math.round(seconds);
  const hours = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  if (hours > 0) {
    return `${hours}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function ChatConversationView({
  conversationId,
}: {
  conversationId: number;
}) {
  const [tab, setTab] = useState<ConversationTab>("dashboard");
  const [editorOpen, setEditorOpen] = useState(false);
  const {
    conversation,
    error,
    isRefreshing,
    refresh,
    completeness,
    isEvaluating,
    evaluate,
  } = useChatConversation(conversationId);
  const messages = useMemo(() => conversation?.messages ?? [], [conversation]);
  const stats = useMemo(
    () => (conversation ? summarizeConversation(messages, Boolean(conversation.error)) : null),
    [conversation, messages],
  );
  // Same gate as the voice run page (which plots only turns that produced
  // telemetry): a conversation whose replies recorded no tokens or latency has
  // nothing to chart, so it gets the empty state instead of empty charts.
  const hasAnalyticsData = Boolean(
    stats &&
    ((stats.promptTokens ?? 0) > 0 ||
      (stats.completionTokens ?? 0) > 0 ||
      stats.replies.some(
        (r) =>
          r.promptTokens !== null ||
          r.completionTokens !== null ||
          r.latencyMs !== null,
      )),
  );
  const analyticsStats = hasAnalyticsData ? stats : null;
  const title = conversation
    ? conversation.title?.trim() || websiteOf(conversation.origin)
    : `Conversation #${conversationId}`;
  const agentName = conversation?.agent_name ?? "Assistant";

  // The agent's model configuration, resolved the same way the agent pages do.
  const { agent, reload: reloadAgent } = useChatAgent(
    conversation?.chat_agent_id ?? null,
  );
  const { presets } = useModelPresets();
  const modelConfigName = modelConfigNameOf(agent ?? {}, presets);
  const initCtx = conversation?.initial_context as Record<string, unknown> | undefined;
  const rtConf = initCtx?.runtime_configuration as Record<string, unknown> | undefined;
  const runtimePreset =
    (rtConf?.preset_name as string | undefined) ||
    (initCtx?.preset_name as string | undefined) ||
    (rtConf?.llm_model as string | undefined);
  const displayStackName = runtimePreset || modelConfigName;
  const { modelPricingRules, user } = useOrgConfig();
  const organizationName = accountHolderName(user);
  const formattedDateShort = formatRunDateShort(conversation?.created_at);

  // Session span; the conversation row is the only timing source chat stores.
  const durationMs = useMemo(() => {
    if (!conversation?.created_at || !conversation?.updated_at) return null;
    const span =
      new Date(conversation.updated_at).getTime() -
      new Date(conversation.created_at).getTime();
    return Number.isNaN(span) ? null : Math.max(span, 0);
  }, [conversation]);

  // The completeness card counts turns and, for its Response bar, the model's
  // time to reply: each assistant reply's recorded latency is its TTFB, so the
  // bar is the real figure and replies that stored none add no event.
  const completenessLogs = useMemo(
    () => ({
      realtime_feedback_events: messages.flatMap((m) => {
        if (m.role !== "assistant") {
          return [{ type: "rtf-user-transcription", payload: { text: m.content, final: true } }];
        }
        const turn = { type: "rtf-bot-text", payload: { text: m.content, final: true } };
        return m.latency_ms == null
          ? [turn]
          : [turn, { type: "rtf-ttfb-metric", payload: { ttfb_seconds: m.latency_ms / 1000 } }];
      }),
    }),
    [messages],
  );

  // The fresh evaluation if one just ran, otherwise the one saved with the
  // conversation. Loading never evaluates: that would spend a model call and
  // rewrite the conversation just for being viewed.
  const savedEvaluation = useMemo<ConversationCompleteness | null>(() => {
    const saved = conversation?.qa_results;
    if (!saved || Object.keys(saved).length === 0) return null;
    return saved as unknown as ConversationCompleteness;
  }, [conversation?.qa_results]);
  const evaluation = completeness ?? savedEvaluation;

  // Usage/cost/model stack, the chat counterpart of the voice page's
  // AnalyticsSidebar. Voice shows it on Analytics only, so chat does too.
  const sidebarProps = {
    conversation,
    stats,
    durationMs,
    evaluation,
    modelConfigName,
    agentKey: agent?.public_key ?? null,
    organizationName,
    modelPricingRules,
  };

  // The session's own facts, in the voice run page's order. Voice's Dashboard
  // and Transcript columns carry exactly these four cards and nothing else.
  const sessionCards = (
    <>
      <ChatConversationSessionOverviewCard
        conversation={conversation}
        durationMs={durationMs}
      />
      <ChatConversationLeadInfoCard conversation={conversation} />
      <ChatConversationEmbedConfigCard
        conversation={conversation}
        agentKey={agent?.public_key ?? null}
        modelConfigName={modelConfigName}
      />
      <ChatConversationIdentifiersCard
        conversation={conversation}
        organizationName={organizationName}
      />
    </>
  );

  // The trail follows where the visitor of this page came from (`?returnTo=` set
  // by the list), like the voice run page: from the global list it is
  // Chat conversations > title; otherwise Chat agents > agent > Conversations > title.
  const returnTo = readReturnTo(useSearchParams());
  const breadcrumbs = useMemo(() => {
    const current = { label: title };
    if (returnTo && /^\/chat\/conversations(?=[/?]|$)/.test(returnTo)) {
      return [{ label: "Chat conversations", href: returnTo }, current];
    }
    if (!conversation) return [{ label: "Chat conversations", href: "/chat/conversations" }, current];
    const agentHref = `/chat/agents/${conversation.chat_agent_id}/view`;
    return [
      { label: "Chat agents", href: "/chat/agents" },
      { label: agentName, href: agentHref },
      { label: "Conversations", href: returnTo ?? `${agentHref}?tab=conversations` },
      current,
    ];
  }, [conversation, agentName, title, returnTo]);

  return (
    <div data-detail-page className="space-y-4 px-4 pb-6 pt-4 lg:px-6">
      <PageHeader
        title={title}
        breadcrumbs={breadcrumbs}
        actions={
          <div className="flex items-center gap-2">
            {conversation && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={() => setEditorOpen(true)}
                disabled={!agent}
              >
                <Pencil className="h-3.5 w-3.5" />
                Customize Agent
              </Button>
            )}
            {conversation && (
              <Button asChild variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                <Link href={`/chat/agents/${conversation.chat_agent_id}/view`}>
                  <Eye className="h-3.5 w-3.5" />
                  View Agent
                </Link>
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0"
              aria-label="Refresh conversation"
              title="Refresh"
              onClick={() => void refresh()}
              disabled={isRefreshing}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")} />
            </Button>
          </div>
        }
      />

      {error && !conversation ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : (
        <>
          <Card>
            <CardHeader className="space-y-3 p-4 pb-0 sm:p-5">
              <div className="space-y-1">
                <div className="flex min-w-0 items-center gap-2">
                  <h1
                    className="truncate font-sans text-lg font-bold uppercase leading-none tracking-tight text-foreground sm:text-xl"
                    title={title}
                  >
                    {title}
                  </h1>
                </div>
                <p className="truncate text-xs leading-relaxed text-muted-foreground">
                  {agentName}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2.5 pt-0.5 text-xs text-muted-foreground">
                {formattedDateShort && (
                  <span className="inline-flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span>Created {formattedDateShort}</span>
                  </span>
                )}
                {durationMs != null && (
                  <>
                    <span className="text-muted-foreground/40 select-none" aria-hidden="true">|</span>
                    <span className="inline-flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span>Duration {formatDurationTimestamp(Math.round(durationMs / 1000))}</span>
                    </span>
                  </>
                )}
                <span className="text-muted-foreground/40 select-none" aria-hidden="true">|</span>
                <span className="inline-flex items-center gap-1.5">
                  <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span>{conversation?.message_count ?? 0} messages</span>
                </span>
                {displayStackName && (
                  <>
                    <span className="text-muted-foreground/40 select-none" aria-hidden="true">|</span>
                    <span className="inline-flex items-center gap-1.5">
                      <Cpu className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span>Stack: {displayStackName}</span>
                    </span>
                  </>
                )}
              </div>
              <div className="pt-3">
                <UnderlineTabs
                  value={tab}
                  onValueChange={(v) => setTab(v as ConversationTab)}
                  items={TABS}
                />
              </div>
            </CardHeader>
          </Card>

          {conversation?.error && (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              <p className="font-medium">The assistant could not reply</p>
              <p className="mt-0.5 break-words text-xs">
                {conversation.error.message}
                {conversation.error.model
                  ? ` · model: ${conversation.error.model}`
                  : ""}
                {conversation.error.at
                  ? ` · ${fmtWhen(conversation.error.at)}`
                  : ""}
              </p>
            </div>
          )}

          {tab === "analytics" ? (
            <div className="w-full space-y-6 [&_.recharts-tooltip-cursor]:!fill-transparent [&_.recharts-tooltip-cursor]:!stroke-transparent [&_.recharts-tooltip-cursor]:opacity-0 [&_.recharts-wrapper]:!cursor-pointer [&_.recharts-surface]:!cursor-pointer [&_.recharts-surface_*]:!cursor-pointer">
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                <div className="space-y-4 lg:col-span-8">
                  {analyticsStats ? (
                    <>
                      <ChatUsageBreakdownCard
                        replies={analyticsStats.replies}
                        modelPricingRules={modelPricingRules}
                      />
                      <ChatAnalyticsCharts
                        replies={analyticsStats.replies}
                        requests={analyticsStats.requests}
                        errorDetail={conversation?.error ?? null}
                        promptTokens={analyticsStats.promptTokens}
                        completionTokens={analyticsStats.completionTokens}
                        avgLatencyMs={analyticsStats.avgLatencyMs}
                        modelPricingRules={modelPricingRules}
                      />
                      <div className="pt-2 text-center">
                        <p className="text-[11px] font-medium tracking-wide text-muted-foreground/70">
                          Production Real Time Telemetry • Multi-Channel
                          Model-Aware Analytics Suite
                        </p>
                      </div>
                    </>
                  ) : (
                    <Card className="overflow-hidden border-border bg-card shadow-sm">
                      <CardContent className="p-8 text-center">
                        <Activity className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
                        <p className="text-sm font-medium text-muted-foreground">
                          No analytics data
                        </p>
                        <p className="text-xs text-muted-foreground/70 mt-1">
                          Usage data will appear here once the conversation
                          processes tokens.
                        </p>
                      </CardContent>
                    </Card>
                  )}
                </div>
                <div className="space-y-4 lg:col-span-4">
                  <ChatSessionSidebar {...sidebarProps} />
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
              <div className="space-y-4 lg:col-span-8">
                {tab === "dashboard" && (
                  <>
                    <ChatRunMetricsCard
                      conversation={conversation}
                      stats={stats}
                      durationMs={durationMs}
                      onRefresh={() => void refresh()}
                      isRefreshing={isRefreshing}
                    />
                    <ConversationCompletenessCard
                      completeness={evaluation}
                      onRetry={() => void evaluate()}
                      retrying={isEvaluating}
                      logs={completenessLogs}
                    />

                    <div className="grid gap-6 md:grid-cols-2">
                      <ChatContextCard
                        title="Initial Context"
                        subtitle="Session parameters and variables passed at start"
                        context={conversation?.initial_context}
                      />
                      <ChatContextCard
                        title="Gathered Context"
                        subtitle="Extracted variables and values captured during session"
                        context={conversation?.gathered_context}
                      />
                    </div>

                    {savedEvaluation && (
                      <ChatContextCard
                        title="QA Results"
                        subtitle="Quality assurance annotations and evaluation flags"
                        context={savedEvaluation}
                      />
                    )}
                  </>
                )}
                {tab === "transcript" && (
                  <ChatTranscriptCard
                    messages={messages}
                    agentName={agentName}
                    conversationId={conversationId}
                    tall
                  />
                )}
              </div>
              <div className="space-y-4 lg:col-span-4">{sessionCards}</div>
            </div>
          )}
        </>
      )}

      <ChatAgentEditorDrawer
        open={editorOpen}
        agent={agent as ChatAgent | null}
        onOpenChange={setEditorOpen}
        onSaved={() => {
          void reloadAgent();
          void refresh();
        }}
      />
    </div>
  );
}
