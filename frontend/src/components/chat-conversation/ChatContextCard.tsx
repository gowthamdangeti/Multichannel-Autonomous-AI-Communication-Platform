"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface ChatContextCardProps {
  title: string;
  subtitle?: string;
  context: object | null | undefined;
  className?: string;
}

/** A titled JSON block with a Copy button, styled like the voice run page's context cards. */
export function ChatContextCard({ title, subtitle, context, className }: ChatContextCardProps) {
  const [copied, setCopied] = useState(false);
  const hasData = !!context && Object.keys(context).length > 0;

  const copy = () => {
    if (!hasData) return;
    void navigator.clipboard.writeText(JSON.stringify(context, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card className={cn("overflow-hidden border-border bg-card/60 shadow-sm backdrop-blur-sm", className)}>
      <CardHeader className="flex shrink-0 flex-row items-center justify-between border-b border-border px-4 py-3">
        <div className="leading-snug">
          <CardTitle className="text-sm font-bold uppercase tracking-wide text-foreground">{title}</CardTitle>
          {subtitle && <p className="mt-1 text-xs font-medium text-muted-foreground">{subtitle}</p>}
        </div>
        {hasData && (
          <Button variant="ghost" size="sm" onClick={copy} className="h-7 gap-1 px-2.5 text-xs">
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        )}
      </CardHeader>
      <CardContent className="p-4">
        {hasData ? (
          <pre className="max-h-80 overflow-auto rounded-lg border border-border bg-muted p-3.5 font-mono text-xs leading-relaxed text-foreground/90 sm:text-sm">
            {JSON.stringify(context, null, 2)}
          </pre>
        ) : (
          <p className="text-sm text-muted-foreground">No data available</p>
        )}
      </CardContent>
    </Card>
  );
}
