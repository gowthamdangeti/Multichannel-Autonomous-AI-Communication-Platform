import { Cpu, GitBranch, MessageSquare } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import type { AgentHeavyConversation, AgentModelUsage, AgentNodeUsage } from "@/client/types.gen";
import { toFilterLabel } from "@/lib/searchFilter";

import { formatResponseTime, formatTokenCount } from "./agentAnalyticsFormat";

interface UsagePanelProps {
  icon: ReactNode;
  title: string;
  isEmpty: boolean;
  emptyLabel: string;
  children: ReactNode;
}

function UsagePanel({ icon, title, isEmpty, emptyLabel, children }: UsagePanelProps) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-muted p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-foreground [&_svg]:size-4 [&_svg]:text-muted-foreground">
        {icon}
        {title}
      </p>
      {isEmpty ? <p className="mt-3 text-sm text-muted-foreground">{emptyLabel}</p> : <div className="mt-3 space-y-3">{children}</div>}
    </div>
  );
}

interface ShareRowProps {
  title: string;
  subtitle?: string;
  value: string;
  detail: string;
  share: number;
  barClass: string;
}

function ShareRow({ title, subtitle, value, detail, share, barClass }: ShareRowProps) {
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{title}</p>
          {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold tabular-nums text-foreground">{value}</p>
          <p className="text-xs tabular-nums text-muted-foreground">{detail}</p>
        </div>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-border">
        <div className={`h-full rounded-full ${barClass}`} style={{ width: `${share}%` }} />
      </div>
    </div>
  );
}

export function AgentModelList({ models }: { models: AgentModelUsage[] }) {
  const modelsWithUsage = models.filter((model) => model.total_tokens > 0);

  return (
    <UsagePanel icon={<Cpu />} title="By Model Stack" isEmpty={modelsWithUsage.length === 0} emptyLabel="No model usage yet">
      {modelsWithUsage.slice(0, 5).map((model) => (
        <ShareRow
          key={model.name}
          title={model.name}
          subtitle={[model.provider, model.model].filter(Boolean).join(" · ")}
          value={formatTokenCount(model.total_tokens)}
          detail={`${model.share}% · ${model.conversations} conv`}
          share={model.share}
          barClass="bg-run-chart-1"
        />
      ))}
    </UsagePanel>
  );
}

export function AgentNodeList({ nodes }: { nodes: AgentNodeUsage[] }) {
  return (
    <UsagePanel icon={<GitBranch />} title="By Workflow Node" isEmpty={nodes.length === 0} emptyLabel="No node activity yet">
      {nodes.slice(0, 5).map((node) => (
        <ShareRow
          key={node.name}
          title={node.name}
          subtitle={`Avg response ${formatResponseTime(node.avg_response_ms)}`}
          value={`${node.turns} turns`}
          detail={`${node.share}%`}
          share={node.share}
          barClass="bg-run-chart-2"
        />
      ))}
    </UsagePanel>
  );
}

interface AgentHeaviestListProps {
  conversations: AgentHeavyConversation[];
  workflowId: number;
}

export function AgentHeaviestList({ conversations, workflowId }: AgentHeaviestListProps) {
  return (
    <UsagePanel
      icon={<MessageSquare />}
      title="Heaviest Conversations"
      isEmpty={conversations.length === 0}
      emptyLabel="No conversations with token usage yet"
    >
      {conversations.map((conversation) => (
        <Link
          key={conversation.run_id}
          href={`/voice/agents/${workflowId}/run/${conversation.run_id}`}
          className="flex items-start justify-between gap-3 rounded-md hover:underline"
        >
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-foreground">{conversation.title}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {new Date(conversation.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              {conversation.disposition ? ` · ${toFilterLabel(conversation.disposition)}` : ""}
            </span>
          </span>
          <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
            {formatTokenCount(conversation.total_tokens)}
          </span>
        </Link>
      ))}
    </UsagePanel>
  );
}
