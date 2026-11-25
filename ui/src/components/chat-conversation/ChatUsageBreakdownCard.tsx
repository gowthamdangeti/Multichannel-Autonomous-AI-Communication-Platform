"use client";

import { ChevronDown, ChevronRight, Coins } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ModelPricingRule } from "@/context/OrgConfigContext";
import { formatExactUsd, formatItemCost, formatTotalCost, resolveLLMPricing } from "@/lib/modelPricing";
import { cn } from "@/lib/utils";

import type { ReplyPoint } from "./chatConversationStats";

const HEAD_CELL = "py-2.5 px-3 text-right text-[10px] uppercase font-semibold text-muted-foreground tracking-wider";
const BODY_CELL = "py-2.5 px-3 text-right font-mono text-[11px]";

const num = (value: number | null) => (value === null ? "—" : value.toLocaleString());

/**
 * Per-reply usage exactly as the provider reported it — the chat counterpart of
 * the voice run page's token usage breakdown, in the same card chrome. Nothing
 * here is estimated; a reply that reported no usage says so.
 */
export function ChatUsageBreakdownCard({
  replies,
  modelPricingRules,
}: {
  replies: ReplyPoint[];
  modelPricingRules: ModelPricingRule[];
}) {
  const [isTableExpanded, setIsTableExpanded] = useState(false);

  const rows = replies.map((r) => {
    const rate = resolveLLMPricing(r.model ?? "", modelPricingRules);
    const reported = r.promptTokens !== null || r.completionTokens !== null;
    const cost = ((r.promptTokens ?? 0) / 1_000_000) * rate.inputPer1M + ((r.completionTokens ?? 0) / 1_000_000) * rate.outputPer1M;
    const totalUnits =
      r.promptTokens === null && r.completionTokens === null ? null : (r.promptTokens ?? 0) + (r.completionTokens ?? 0);
    return { reply: r, rate, reported, cost, totalUnits };
  });

  const promptTokens = replies.reduce((sum, r) => sum + (r.promptTokens ?? 0), 0);
  const completionTokens = replies.reduce((sum, r) => sum + (r.completionTokens ?? 0), 0);
  const totalCostUsd = rows.reduce((sum, row) => sum + (row.rate.priced ? row.cost : 0), 0);
  const unpricedEntries = rows.filter((row) => row.reported && !row.rate.priced).length;
  const models = [...new Set(replies.flatMap((r) => (r.model ? [r.model] : [])))];
  const recorded = rows.filter((row) => row.reported).length;

  return (
    <Card className="border-border/70 bg-card/60 backdrop-blur-sm overflow-hidden shadow-sm transition-all duration-200">
      <CardHeader
        className={cn(
          "p-4 transition-colors select-none cursor-pointer hover:bg-muted/30",
          isTableExpanded ? "pb-3" : "py-3.5",
        )}
        onClick={() => setIsTableExpanded(!isTableExpanded)}
        role="button"
        aria-expanded={isTableExpanded}
        title={isTableExpanded ? "Click to collapse table" : "Click to expand table"}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {isTableExpanded ? (
              <ChevronDown className="h-4 w-4 text-sky-400 shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 text-sky-400 shrink-0" />
            )}
            <CardTitle className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-foreground">
              <Coins className="h-4 w-4 text-sky-400" />
              Token Usage Breakdown
            </CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="h-5 px-2 text-[10px] font-mono font-medium border-border bg-muted text-foreground">
              {replies.length} {replies.length === 1 ? "reply" : "replies"} • {recorded}/{replies.length} reported
            </Badge>
            <Badge
              variant="outline"
              className="h-5 px-2 text-[10px] font-mono font-bold border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
            >
              Estimated: {formatTotalCost(formatExactUsd, totalCostUsd, unpricedEntries)}
            </Badge>
          </div>
        </div>
      </CardHeader>
      {isTableExpanded && (
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-xs">
            <thead className="border-y border-border/50 bg-muted/40">
              <tr>
                <th className="py-2.5 px-3 text-left text-[10px] uppercase font-semibold text-muted-foreground tracking-wider w-[200px]">
                  Reply / Model
                </th>
                <th className="py-2.5 px-3 text-center text-[10px] uppercase font-semibold text-muted-foreground tracking-wider w-[80px]">
                  Entries
                </th>
                <th className="py-2.5 px-3 text-center text-[10px] uppercase font-semibold text-muted-foreground tracking-wider w-[70px]">
                  Type
                </th>
                <th className={cn(HEAD_CELL, "w-[110px]")}>Input Tokens</th>
                <th className={cn(HEAD_CELL, "w-[100px]")}>Output Tokens</th>
                <th className={cn(HEAD_CELL, "w-[110px]")}>Cache R / W</th>
                <th className={cn(HEAD_CELL, "w-[100px]")}>Total Units</th>
                <th className={cn(HEAD_CELL, "w-[90px]")}>Est. Cost</th>
                <th className={cn(HEAD_CELL, "w-[120px]")}>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t-2 border-border/70 bg-muted/30">
                <td className="py-3 px-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-foreground">Conversation</span>
                  </div>
                </td>
                <td className="py-3 px-3 text-center">
                  <span className="text-[11px] font-mono font-medium text-foreground">
                    {replies.length} {replies.length === 1 ? "entry" : "entries"}
                  </span>
                </td>
                <td className="py-3 px-3 text-center">
                  <div className="flex flex-wrap items-center justify-center gap-1">
                    <Badge variant="outline" className="text-[9px] px-1.5 py-0 font-mono font-medium bg-blue-500/10 text-blue-500 border-blue-500/30">
                      LLM
                    </Badge>
                  </div>
                </td>
                <td className={cn(BODY_CELL, "font-semibold")}>
                  {promptTokens > 0 ? promptTokens.toLocaleString() : "—"}
                </td>
                <td className={cn(BODY_CELL, "font-semibold")}>
                  {completionTokens > 0 ? completionTokens.toLocaleString() : "—"}
                </td>
                <td className={cn(BODY_CELL, "font-semibold text-muted-foreground/50")}>—</td>
                <td className={cn(BODY_CELL, "font-semibold text-foreground")}>
                  {promptTokens + completionTokens > 0 ? `${(promptTokens + completionTokens).toLocaleString()} tok` : "—"}
                </td>
                <td className={cn(BODY_CELL, "font-bold text-emerald-400")}>
                  <div>{formatTotalCost(formatExactUsd, totalCostUsd, unpricedEntries)}</div>
                  {totalCostUsd > 0 && <div className="text-[9px] font-normal text-muted-foreground">100.0%</div>}
                </td>
                <td
                  className={cn(
                    "py-3 px-3 text-right text-[10px] max-w-[150px] truncate",
                    recorded > 0 ? "text-foreground font-medium" : "text-muted-foreground/60",
                  )}
                  title={recorded === replies.length ? `${replies.length} replies reported usage` : `${recorded} of ${replies.length} replies reported usage`}
                >
                  {recorded === 0
                    ? "usage not recorded"
                    : `${recorded} reported${recorded === replies.length ? "" : ` • ${replies.length - recorded} unrecorded`}`}
                </td>
              </tr>
              {rows.map(({ reply, rate, reported, cost, totalUnits }) => (
                <tr key={reply.reply} className="hover:bg-muted/50 transition-colors border-b border-border">
                  <td
                    className="py-2.5 px-3 pl-10 font-sans text-xs text-foreground max-w-[240px]"
                    title={reply.model ?? "unknown model"}
                  >
                    <div className="font-medium truncate">{reply.model ?? "Unknown model"}</div>
                    <div className="text-[10px] text-muted-foreground truncate">Reply #{reply.reply}</div>
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    <span className="text-[10px] font-mono text-muted-foreground">1 entry</span>
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    <Badge variant="outline" className="text-[9px] px-1.5 py-0 font-mono bg-blue-500/10 text-blue-500 border-blue-500/30">
                      LLM
                    </Badge>
                  </td>
                  <td className={BODY_CELL}>{num(reply.promptTokens)}</td>
                  <td className={BODY_CELL}>{num(reply.completionTokens)}</td>
                  <td className={cn(BODY_CELL, "text-muted-foreground/60")}>
                    <span
                      className="text-[10px] font-sans font-medium"
                      title="Chat replies store no cache token counts, so the real value is unknown (not zero)."
                    >
                      Not recorded
                    </span>
                  </td>
                  <td className={cn(BODY_CELL, "text-foreground")}>
                    {totalUnits === null ? "—" : `${totalUnits.toLocaleString()} tok`}
                  </td>
                  <td className={cn(BODY_CELL, "font-semibold text-emerald-400")}>
                    <div>{reported ? formatItemCost(formatExactUsd, cost, rate.priced) : "—"}</div>
                  </td>
                  <td className="py-2.5 px-3" />
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-border/70 bg-muted/40">
              <tr className="text-xs font-bold">
                <td className="py-3 px-3">
                  <span className="uppercase tracking-wider text-foreground text-[11px]">Grand Total</span>
                  <span className="ml-2 text-[10px] font-mono font-normal text-muted-foreground">
                    (all {models.length} {models.length === 1 ? "model" : "models"})
                  </span>
                </td>
                <td className="py-3 px-3 text-center font-mono font-bold text-foreground text-[11px]">
                  {replies.length} {replies.length === 1 ? "entry" : "entries"}
                </td>
                <td className="py-3 px-3" />
                <td className={cn(BODY_CELL, "font-bold text-foreground")}>{promptTokens.toLocaleString()}</td>
                <td className={cn(BODY_CELL, "font-bold text-foreground")}>{completionTokens.toLocaleString()}</td>
                <td className={cn(BODY_CELL, "font-bold text-amber-400")}>—</td>
                <td className={cn(BODY_CELL, "font-bold text-foreground")}>
                  <div>{(promptTokens + completionTokens).toLocaleString()} tok</div>
                </td>
                <td className={cn(BODY_CELL, "font-bold text-emerald-400 text-sm")}>
                  {formatTotalCost(formatExactUsd, totalCostUsd, unpricedEntries)}
                </td>
                <td className="py-3 px-3" />
              </tr>
            </tfoot>
          </table>
        </CardContent>
      )}
    </Card>
  );
}
