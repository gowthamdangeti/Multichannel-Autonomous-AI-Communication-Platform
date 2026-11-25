"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { EmbedCodeBlock } from "./EmbedCodeBlock";

interface ChatAgentEmbedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentName?: string;
  embedScript?: string | null;
  allowedDomains?: string[] | null;
}

/** The agent's website embed snippet in a popup, with Copy and Cancel in the footer. */
export function ChatAgentEmbedDialog({
  open,
  onOpenChange,
  agentName,
  embedScript,
  allowedDomains,
}: ChatAgentEmbedDialogProps) {
  const [copied, setCopied] = useState(false);

  // Each opening starts from "Copy", not a stale "Copied".
  useEffect(() => {
    if (open) setCopied(false);
  }, [open]);

  useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timeout);
  }, [copied]);

  const handleCopy = async () => {
    if (!embedScript) return;
    try {
      await navigator.clipboard.writeText(embedScript);
      setCopied(true);
      toast.success("Embed code copied");
    } catch {
      toast.error("Could not copy. Select the code and copy it manually.");
    }
  };

  const domains = (allowedDomains ?? []).filter(Boolean);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Embed {agentName ? `“${agentName}”` : "chat agent"}</DialogTitle>
          <DialogDescription>
            Paste this snippet into your website&apos;s HTML, just before the closing &lt;/body&gt; tag.
          </DialogDescription>
        </DialogHeader>

        {embedScript ? (
          <EmbedCodeBlock code={embedScript} />
        ) : (
          <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            Embed code is not available for this agent.
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          {domains.length > 0
            ? `Works only on: ${domains.join(", ")}. Change this in Customize Agent → Domains.`
            : "Works on any website. Add allowed domains in Customize Agent → Domains to restrict it."}
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void handleCopy()} disabled={!embedScript}>
            {copied ? <Check /> : <Copy />}
            {copied ? "Copied" : "Copy code"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
