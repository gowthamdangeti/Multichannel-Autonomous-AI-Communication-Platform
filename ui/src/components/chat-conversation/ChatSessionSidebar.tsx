"use client";

/**
 * The right-hand column of the chat conversation page: the voice run page's
 * analytics column, minus the cards chat has no data for (its Node Switches
 * card, its STT/TTS rows).
 */

import { Check, Copy, Cpu, Info } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import type { ChatConversationDetail } from "@/client/types.gen";
import { DASH, fmtTokens } from "@/components/chat-agent/chatAgentFormat";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ModelPricingRule } from "@/context/OrgConfigContext";
import type { ChatEvaluation } from "@/lib/chatConversationAnalytics";
import { IDLE_WINDOW_SECONDS, summarizeChatAnalytics } from "@/lib/chatConversationAnalytics";
import { formatExactUsd, formatTotalCost, resolveLLMPricing } from "@/lib/modelPricing";
import { cn } from "@/lib/utils";

import type { ChatConversationStats } from "./chatConversationStats";

interface ChatSessionSidebarProps {
  conversation: ChatConversationDetail | null;
  stats: ChatConversationStats | null;
  /** Session span, `updated_at - created_at`; null while the conversation loads. */
  durationMs: number | null;
  /** The evaluation that ran, else the one saved with the conversation. */
  evaluation: ChatEvaluation | null;
  /** The agent's model configuration, resolved the way the agent pages do. */
  modelConfigName: string | null;
  /** The agent's public key — the only stable agent identifier the API exposes. */
  agentKey: string | null;
  organizationName: string | null;
  modelPricingRules?: ModelPricingRule[];
}

/** One labelled value in the Account Details card. */
function AccountRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      toast.success(`Copied ${label} to clipboard`);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-muted px-3 py-2.5">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="truncate pr-2 font-mono text-xs font-medium text-foreground">{value}</div>
      </div>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${label}`}
        className="ml-2 shrink-0 text-muted-foreground transition-colors hover:text-foreground"
      >
        {copied ? <Check className="h-4 w-4 text-status-success" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );
}

/** One labelled value in the model stack snapshot. */
function StackRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1 rounded-lg border border-border bg-muted px-3 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="truncate text-xs font-bold text-foreground">{value}</div>
    </div>
  );
}

/**
 * The right-hand column of the chat conversation page, matching the voice run
 * page's analytics column. Chat has no nodes and no call-length cap, so the
 * Node Switches card is absent and the progress bar measures how far the
 * session is into the 30-minute idle window that ends it.
 */
export function ChatSessionSidebar({
  conversation,
  stats,
  durationMs,
  evaluation,
  modelConfigName,
  agentKey,
  organizationName,
  modelPricingRules,
}: ChatSessionSidebarProps) {
  const summary = useMemo(
    () =>
      summarizeChatAnalytics({
        replies: stats?.replies ?? [],
        durationMs,
        recordedDurationSeconds: conversation?.duration_seconds,
        updatedAt: conversation?.updated_at,
        evaluation,
        rateFor: (model) => resolveLLMPricing(model, modelPricingRules),
      }),
    [stats, durationMs, conversation?.duration_seconds, conversation?.updated_at, evaluation, modelPricingRules],
  );

  const runtime = useMemo(() => {
    const config = conversation?.initial_context?.runtime_configuration;
    return (config && typeof config === "object" ? config : {}) as Record<string, unknown>;
  }, [conversation?.initial_context]);
  const scalar = (value: unknown) =>
    typeof value === "string" || typeof value === "number" ? String(value) || DASH : DASH;
  const providerModel = [runtime.llm_provider, runtime.llm_model]
    .filter((v) => typeof v === "string" && v)
    .join(" / ");

  const { durationSeconds, cost, response, success, idle } = summary;
  const durationFormatted =
    durationSeconds === null ? DASH : `${durationSeconds.toFixed(1)}s • ${Math.ceil(durationSeconds / 60)} min`;

  const isCompleted = conversation?.status === "completed";
  const isDisconnected = conversation?.status === "disconnected";
  const windowMinutes = IDLE_WINDOW_SECONDS / 60;

  // Reply accounting for the Feature / Status table. Nothing is implied: a row
  // is only "live" when the provider reported the numbers behind it, and a
  // transcript that has not loaded has no row that can be called live.
  const assistantCount = stats?.assistantMessages ?? 0;
  const countStatus = (reported: number): "live" | "partial" | "missing" =>
    stats === null
      ? "missing"
      : reported === 0
        ? "missing"
        : reported < assistantCount
          ? "partial"
          : "live";
  const tokenReplyCount = stats?.replies.filter((r) => r.promptTokens !== null || r.completionTokens !== null).length ?? 0;
  const tokenStatus = countStatus(tokenReplyCount);
  const latencyStatus = countStatus(response?.reported ?? 0);
  const badgeVariant = (status: "live" | "partial" | "missing") =>
    status === "live" ? "success" : status === "partial" ? "warning" : "outline";

  return (
    <div className="w-full space-y-4">
      {/* ── CARD 1: USAGE ── */}
      <Card className="overflow-hidden border-border bg-card/60 shadow-sm backdrop-blur-sm">
        <CardHeader className="flex flex-row items-center justify-between border-b border-border p-4 pb-2.5">
          <CardTitle className="text-xs font-bold uppercase tracking-wider text-foreground">Usage</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3.5 p-4 pt-3">
          {/* Duration, and the idle window that closes the session */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-muted-foreground">Conversation duration</span>
              <span className="font-mono font-bold text-foreground">{durationFormatted}</span>
            </div>
            <p className="text-[10px] text-muted-foreground">
              {isCompleted
                ? "Completed • the visitor ended the chat"
                : isDisconnected
                  ? "Disconnected • the visitor left without ending the chat"
                  : idle.remainingMinutes === null
                    ? `In progress • marked disconnected after ${windowMinutes} min without a message`
                    : `In progress • marked disconnected in ${idle.remainingMinutes} min without a message`}
            </p>
          </div>

          {/* Feature / This conversation / Status */}
          <div className="overflow-hidden rounded-lg border border-border bg-muted">
            <table className="w-full text-xs">
              <thead className="border-b border-border bg-muted/80 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Feature</th>
                  <th className="px-3 py-2 text-center">This conversation</th>
                  <th className="px-3 py-2 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30 text-xs">
                <tr>
                  <td className="px-3 py-2 font-medium text-foreground">Replies</td>
                  <td className="px-3 py-2 text-center font-mono text-foreground">{stats ? assistantCount : DASH}</td>
                  <td className="px-3 py-2 text-right">
                    <Badge variant={badgeVariant(countStatus(assistantCount))} className="h-4 px-1.5 font-mono text-[9px]">
                      {countStatus(assistantCount)}
                    </Badge>
                  </td>
                </tr>
                <tr>
                  <td className="px-3 py-2 font-medium text-foreground">Visitor messages</td>
                  <td className="px-3 py-2 text-center font-mono text-foreground">
                    {stats ? stats.visitorMessages : DASH}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Badge
                      variant={badgeVariant(stats ? "live" : "missing")}
                      className="h-4 px-1.5 font-mono text-[9px]"
                    >
                      {stats ? "live" : "missing"}
                    </Badge>
                  </td>
                </tr>
                <tr>
                  <td className="px-3 py-2 font-medium text-foreground">Tokens (prompt / completion)</td>
                  <td className="px-3 py-2 text-center font-mono text-foreground">
                    {fmtTokens(stats?.promptTokens)} / {fmtTokens(stats?.completionTokens)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Badge variant={badgeVariant(tokenStatus)} className="h-4 px-1.5 font-mono text-[9px]">
                      {tokenStatus}
                    </Badge>
                  </td>
                </tr>
                <tr>
                  <td className="px-3 py-2 font-medium text-foreground">Reply time reported</td>
                  <td className="px-3 py-2 text-center font-mono text-foreground">
                    {stats ? `${response?.reported ?? 0} / ${assistantCount}` : DASH}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Badge variant={badgeVariant(latencyStatus)} className="h-4 px-1.5 font-mono text-[9px]">
                      {latencyStatus}
                    </Badge>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <p className="pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {conversation?.created_at
              ? new Date(conversation.created_at).toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })
              : DASH}
          </p>

          {/* 2x2 metric grid */}
          <div className="grid grid-cols-2 gap-2.5">
            <div className="space-y-1 rounded-lg border border-border bg-muted p-2.5">
              <div className="flex items-center justify-between text-[10px] font-semibold uppercase text-muted-foreground">
                <span>Estimated Cost</span>
                <Info className="h-3 w-3 text-muted-foreground/60" />
              </div>
              <p className="font-mono text-base font-bold text-foreground">
                {cost === null ? DASH : formatTotalCost(formatExactUsd, cost.totalUsd, cost.unpricedModels)}
              </p>
              <p className="truncate text-[9px] text-muted-foreground">
                {cost === null ? "No usage data yet" : `Across ${cost.modelCount} model(s)`}
              </p>
            </div>

            <div className="space-y-1 rounded-lg border border-border bg-muted p-2.5">
              <div className="flex items-center justify-between text-[10px] font-semibold uppercase text-muted-foreground">
                <span>Response Time</span>
                <Info className="h-3 w-3 text-muted-foreground/60" />
              </div>
              <p className="font-mono text-base font-bold text-foreground">
                {response === null ? DASH : `${response.totalMs}ms`}
              </p>
              <p className="truncate text-[9px] text-muted-foreground">
                {response === null ? "No reply timing recorded" : `${response.avgMs}ms avg • ${response.reported} replies`}
              </p>
            </div>

            <div className="space-y-1 rounded-lg border border-border bg-muted p-2.5">
              <div className="flex items-center justify-between text-[10px] font-semibold uppercase text-muted-foreground">
                <span>Conversation Success Rate</span>
                <Info className="h-3 w-3 text-muted-foreground/60" />
              </div>
              <p
                className={cn(
                  "font-mono text-base font-bold",
                  success === null
                    ? "text-foreground"
                    : success.score >= 75
                      ? "text-status-success"
                      : success.score >= 40
                        ? "text-status-warning"
                        : "text-destructive",
                )}
              >
                {success === null ? DASH : `${success.score}%`}
              </p>
              <p
                className="truncate text-[9px] capitalize text-muted-foreground"
                title={success?.verdict ? `${success.verdict} • Conversation resolution` : "Conversation resolution"}
              >
                {success === null ? "Not evaluated" : success.verdict ? `${success.verdict} • Resolution` : "Resolution"}
              </p>
            </div>

            <div className="space-y-1 rounded-lg border border-border bg-muted p-2.5">
              <div className="flex items-center justify-between text-[10px] font-semibold uppercase text-muted-foreground">
                <span>Model Stack</span>
                <Info className="h-3 w-3 text-muted-foreground/60" />
              </div>
              <p className="truncate text-base font-bold text-foreground" title={modelConfigName ?? undefined}>
                {modelConfigName ?? DASH}
              </p>
              <p className="truncate text-[9px] text-muted-foreground">Active Model Preset</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── CARD 2: ACCOUNT DETAILS ── */}
      <Card className="overflow-hidden border-border/70 bg-card/60 shadow-sm backdrop-blur-sm">
        <CardHeader className="p-4 pb-3">
          <CardTitle className="text-sm font-bold text-foreground">Account Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2.5 p-4 pt-0">
          <AccountRow label="Conversation ID" value={conversation ? String(conversation.id) : DASH} />
          <AccountRow label="Agent public key" value={agentKey ?? DASH} />
          <div className="space-y-1 rounded-lg border border-border bg-muted px-3 py-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Account holder
            </div>
            <div className="truncate text-xs font-medium text-foreground">{organizationName ?? DASH}</div>
          </div>
        </CardContent>
      </Card>

      {/* ── CARD 3: MODEL STACK SNAPSHOT ── */}
      <Card className="overflow-hidden border-border bg-card/60 shadow-sm backdrop-blur-sm">
        <CardHeader className="flex flex-row items-center justify-between border-b border-border p-4 pb-3">
          <div className="flex items-center gap-2">
            <Cpu className="h-4 w-4 shrink-0 text-muted-foreground" />
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-foreground">
              Model stack snapshot
            </CardTitle>
          </div>
          {modelConfigName && (
            <Badge variant="purple" className="h-5 max-w-[160px] truncate px-2 text-[10px] font-medium" title={modelConfigName}>
              {modelConfigName}
            </Badge>
          )}
        </CardHeader>
        <CardContent className="space-y-2.5 p-4 pt-3.5">
          <StackRow label="LLM" value={providerModel || DASH} />
          <StackRow label="Temperature" value={scalar(runtime.temperature)} />
          <StackRow label="Language" value={scalar(runtime.language)} />
        </CardContent>
      </Card>
    </div>
  );
}
