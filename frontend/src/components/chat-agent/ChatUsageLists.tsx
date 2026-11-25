"use client";

import type { LucideIcon } from "lucide-react";
import { Cpu, MessageSquare } from "lucide-react";
import Link from "next/link";

import type { ChatHeavyConversation, ChatModelUsage } from "@/client/types.gen";
import { formatTokenCount } from "@/components/agent-view/agentAnalyticsFormat";
import { DASH, fmtWhen, websiteOf } from "@/components/chat-agent/chatAgentFormat";

function UsagePanel({
  icon: Icon,
  title,
  empty,
  emptyLabel,
  children,
}: {
  icon: LucideIcon;
  title: string;
  empty: boolean;
  emptyLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-muted p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Icon className="size-4 text-muted-foreground" />
        {title}
      </p>
      {empty ? (
        <p className="mt-3 text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="mt-3 space-y-3">{children}</div>
      )}
    </div>
  );
}

/** Replies grouped by the model stack that produced them, heaviest first. */
export function ChatModelList({ models }: { models: ChatModelUsage[] }) {
  const total = models.reduce((sum, model) => sum + model.prompt_tokens + model.completion_tokens, 0);

  return (
    <UsagePanel icon={Cpu} title="By Model Stack" empty={models.length === 0} emptyLabel="No model usage yet">
      {models.slice(0, 5).map((model) => {
        const tokens = model.prompt_tokens + model.completion_tokens;
        const share = total ? Math.round((tokens / total) * 100) : 0;
        return (
          <div key={model.name}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{model.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {[model.provider, model.model].filter(Boolean).join(" · ")}
                  {[model.provider, model.model].some(Boolean) ? " · " : ""}
                  {model.replies} {model.replies === 1 ? "reply" : "replies"}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-semibold tabular-nums text-foreground">{formatTokenCount(tokens)}</p>
                <p className="text-xs tabular-nums text-muted-foreground">{share}%</p>
              </div>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-border">
              <div className="h-full rounded-full bg-run-chart-1" style={{ width: `${share}%` }} />
            </div>
          </div>
        );
      })}
    </UsagePanel>
  );
}

/** Conversations that reported the most tokens, with a link to each transcript. */
export function ChatHeaviestList({ conversations }: { conversations: ChatHeavyConversation[] }) {
  return (
    <UsagePanel
      icon={MessageSquare}
      title="Heaviest Conversations"
      empty={conversations.length === 0}
      emptyLabel="No conversations with token usage yet"
    >
      {conversations.map((conversation) => (
        <Link
          key={conversation.id}
          href={`/chat/conversations/${conversation.id}`}
          className="flex items-start justify-between gap-3 rounded-md hover:underline"
        >
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-foreground">
              {conversation.title?.trim() || `#${conversation.id} · ${websiteOf(conversation.origin)}`}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {fmtWhen(conversation.created_at)}
              {` · ${conversation.messages} messages`}
            </span>
          </span>
          <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
            {conversation.total_tokens > 0 ? formatTokenCount(conversation.total_tokens) : DASH}
          </span>
        </Link>
      ))}
    </UsagePanel>
  );
}
