"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface ChatToolsExecutionCardProps {
  cardNumber: number;
}

/**
 * Website chat has no tool or Knowledge Base path at all, so this is the voice
 * page's zero-call empty state, reached the same way (no calls to show).
 */
export function ChatToolsExecutionCard({ cardNumber }: ChatToolsExecutionCardProps) {
  return (
    <Card className="overflow-hidden border border-border bg-card shadow-sm transition-shadow">
      <CardHeader className="px-3.5 pt-3 pb-1.5">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-xs font-bold uppercase tracking-wider text-foreground">
            {cardNumber}. TOOLS &amp; RAG EXECUTION
          </CardTitle>
          <Badge
            variant="outline"
            className="h-5 px-2 text-[10px] font-mono font-medium border-purple-500/30 bg-purple-500/10 text-purple-400"
          >
            Calls: 0
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="px-2.5 pb-2.5 pt-0.5">
        <div className="h-64 sm:h-72 w-full flex flex-col items-center justify-center text-center p-2">
          <div
            className="h-10 w-10 rounded-full border flex items-center justify-center mb-2"
            style={{
              backgroundColor: "oklch(from var(--chart-violet, #7915A0) l c h / 0.15)",
              borderColor: "oklch(from var(--chart-violet, #7915A0) l c h / 0.3)",
            }}
          >
            <div className="h-3 w-3 rounded-full" style={{ backgroundColor: "var(--chart-violet, #7915A0)" }} />
          </div>
          <p className="text-xs font-bold text-foreground">Direct Conversation Flow</p>
          <p className="text-[11px] text-muted-foreground max-w-xs mt-1">
            No external tool calls or Knowledge Base searches were triggered in this session.
          </p>
        </div>
        <p className="mt-0.5 text-[10px] text-center text-muted-foreground/75 leading-relaxed">
          Tracks Knowledge Base retrievals and external tool/webhook execution frequency per turn
        </p>
      </CardContent>
    </Card>
  );
}
