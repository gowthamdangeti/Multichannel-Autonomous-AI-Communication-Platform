import type { AgentNodeUsage } from "@/client/types.gen";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { rangePhrase } from "@/lib/dateRange";

import { formatResponseTime } from "./agentAnalyticsFormat";

interface AgentNodesTableProps {
  nodes: AgentNodeUsage[];
  days: number;
  loading: boolean;
}

export function AgentNodesTable({ nodes, days, loading }: AgentNodesTableProps) {
  return (
    <Card className="overflow-hidden">
      <div className="p-5 pb-3">
        <h3 className="text-sm font-semibold text-foreground">Workflow Nodes</h3>
        <p className="mt-1 text-xs text-muted-foreground">Activity per node over {rangePhrase(days)}</p>
      </div>
      {loading ? (
        <div className="p-5 pt-0">
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="px-5">Node</TableHead>
              <TableHead className="px-5 text-right">Turns</TableHead>
              <TableHead className="px-5 text-right">Share of turns</TableHead>
              <TableHead className="px-5 text-right">Avg response</TableHead>
              <TableHead className="px-5 text-right">Tool calls</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {nodes.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={5} className="h-28 text-center text-muted-foreground">
                  No node activity in this period
                </TableCell>
              </TableRow>
            ) : (
              nodes.map((node) => (
                <TableRow key={node.name}>
                  <TableCell className="px-5 py-3 font-medium">{node.name}</TableCell>
                  <TableCell className="px-5 py-3 text-right tabular-nums">{node.turns}</TableCell>
                  <TableCell className="px-5 py-3 text-right tabular-nums">{node.share}%</TableCell>
                  <TableCell className="px-5 py-3 text-right tabular-nums">{formatResponseTime(node.avg_response_ms)}</TableCell>
                  <TableCell className="px-5 py-3 text-right tabular-nums">{node.tool_calls}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
