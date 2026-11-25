"use client";

import { Copy, Download, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface RecoveryCodesDialogProps {
  codes: string[] | null;
  onDone: () => void;
}

export function RecoveryCodesDialog({ codes, onDone }: RecoveryCodesDialogProps) {
  const text = (codes ?? []).join("\n");

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    toast.success("Recovery codes copied.");
  };

  const handleDownload = () => {
    const url = URL.createObjectURL(new Blob([`Autonomous AI OS 2FA recovery codes\n\n${text}\n`], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "autonomous_ai_os-recovery-codes.txt";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={Boolean(codes)}>
      {/* Closing by accident would lose the codes, so only Done dismisses this. */}
      <DialogContent
        hideCloseButton
        className="sm:max-w-lg"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Save your recovery codes</DialogTitle>
          <DialogDescription>
            If you lose access to your email, each code signs you in once, together with your password.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-foreground">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-status-warning" />
          <p>You won&apos;t see these again. Keep them somewhere safe, like a password manager.</p>
        </div>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(codes ?? []).map((code) => (
            <li key={code} className="rounded-md border border-border bg-muted/40 p-2 text-center font-mono text-sm tracking-wider">
              {code}
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => void handleCopy()}>
            <Copy />
            Copy all
          </Button>
          <Button type="button" variant="outline" onClick={handleDownload}>
            <Download />
            Download
          </Button>
          <Button type="button" onClick={onDone}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
