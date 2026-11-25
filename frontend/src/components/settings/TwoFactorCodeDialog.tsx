"use client";

import { type FormEvent, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { TwoFactorAction } from "./hooks/useTwoFactor";

const CODE_LENGTH = 6;
const RESEND_SECONDS = 60;

const COPY: Record<TwoFactorAction, { title: string; submit: string }> = {
  enable: { title: "Turn on Two-Factor Authentication", submit: "Verify and turn on" },
  disable: { title: "Turn off Two-Factor Authentication", submit: "Verify and turn off" },
  regenerate: { title: "Generate new recovery codes", submit: "Verify and generate" },
};

interface TwoFactorCodeDialogProps {
  action: TwoFactorAction | null;
  email: string;
  isSubmitting: boolean;
  isSending: boolean;
  onResend: () => Promise<boolean>;
  onSubmit: (otp: string) => Promise<void>;
  onCancel: () => void;
}

export function TwoFactorCodeDialog({
  action,
  email,
  isSubmitting,
  isSending,
  onResend,
  onSubmit,
  onCancel,
}: TwoFactorCodeDialogProps) {
  const [code, setCode] = useState("");
  const [countdown, setCountdown] = useState(RESEND_SECONDS);

  useEffect(() => {
    if (!action) return;
    setCode("");
    setCountdown(RESEND_SECONDS);
  }, [action]);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setTimeout(() => setCountdown((seconds) => seconds - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (code.length === CODE_LENGTH) void onSubmit(code);
  };

  const handleResend = async () => {
    if (await onResend()) setCountdown(RESEND_SECONDS);
  };

  const copy = action ? COPY[action] : null;

  return (
    <Dialog open={Boolean(action)} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{copy?.title}</DialogTitle>
            <DialogDescription>
              We sent a 6-digit code to <strong className="text-foreground">{email}</strong>. It expires in 10 minutes.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="two-factor-code">Verification code</Label>
            <Input
              id="two-factor-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={CODE_LENGTH}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
              className="text-center font-mono text-lg tracking-widest"
              autoFocus
            />
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Didn&apos;t get the code?</span>
            {countdown > 0 ? (
              <span className="tabular-nums">Resend in {countdown}s</span>
            ) : (
              <Button type="button" variant="link" size="sm" className="h-auto p-0" disabled={isSending} onClick={() => void handleResend()}>
                Resend code
              </Button>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || code.length !== CODE_LENGTH}>
              {isSubmitting ? "Verifying..." : copy?.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
