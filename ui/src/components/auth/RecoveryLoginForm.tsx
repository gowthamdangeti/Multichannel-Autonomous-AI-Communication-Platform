"use client";

import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getBackendApiUrl } from "@/lib/apiClient";

interface RecoveryLoginFormProps {
  email: string;
  password: string;
  onBack: () => void;
  onSignedIn: (data: { token: string; user: unknown }) => Promise<void>;
}

export function RecoveryLoginForm({ email, password, onBack, onSignedIn }: RecoveryLoginFormProps) {
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      const response = await fetch(`${getBackendApiUrl()}/api/v1/auth/login/recovery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, code }),
      });
      const data = await response.json();
      if (!response.ok || !data.token) {
        toast.error(data.detail || "That recovery code didn't work.");
        return;
      }
      await onSignedIn(data);
    } catch {
      toast.error("Failed to verify code. Please check your network.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="recovery-code">Recovery code</Label>
        <Input
          id="recovery-code"
          autoComplete="off"
          placeholder="XXXXX-XXXXX"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          required
          className="text-center font-mono text-lg tracking-widest"
          autoFocus
        />
        <p className="text-xs text-muted-foreground">Each recovery code works once.</p>
      </div>
      <Button type="submit" className="w-full" disabled={submitting || !code.trim()}>
        {submitting ? "Verifying..." : "Verify & Sign In"}
      </Button>
      <Button type="button" variant="ghost" className="w-full text-xs text-muted-foreground" onClick={onBack}>
        Use the emailed code instead
      </Button>
    </form>
  );
}
