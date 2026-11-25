"use client";

import { PieChart as PieChartIcon } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import type { AgentNodeUsage } from "@/client/types.gen";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const SLICE_COLORS = [1, 2, 3, 4, 5].map((n) => `var(--chart-palette-${n})`);

interface ShareTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: AgentNodeUsage }>;
}

function ShareTooltip({ active, payload }: ShareTooltipProps) {
  const node = payload?.[0]?.payload;
  if (!active || !node) return null;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-sm text-popover-foreground">
      <p className="font-medium">{node.name}</p>
      <p className="text-muted-foreground">
        {node.turns} turns · {node.share}%
      </p>
    </div>
  );
}

export function AgentExecutionShareCard({ nodes, loading }: { nodes: AgentNodeUsage[]; loading: boolean }) {
  const top = nodes[0];

  return (
    <Card className="flex flex-col p-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <PieChartIcon className="size-4 text-muted-foreground" />
        Execution Share Distribution
      </h3>
      <div className="mt-4 h-72 shrink-0">
        {loading ? (
          <Skeleton className="size-full" />
        ) : !top ? (
          <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No turns in this period
          </p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={nodes}
                dataKey="turns"
                nameKey="name"
                outerRadius="85%"
                stroke="var(--card)"
                strokeWidth={nodes.length > 1 ? 2 : 0}
                isAnimationActive={false}
              >
                {nodes.map((node, index) => (
                  <Cell key={node.name} fill={SLICE_COLORS[index % SLICE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip content={<ShareTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>
      {top && !loading && (
        <div className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-3 text-xs text-muted-foreground">
          <span className="min-w-0 truncate">
            Top node: <span className="font-medium text-foreground">{top.name}</span>
          </span>
          <span className="shrink-0 font-medium text-foreground">{top.share}% of turns</span>
        </div>
      )}
    </Card>
  );
}
