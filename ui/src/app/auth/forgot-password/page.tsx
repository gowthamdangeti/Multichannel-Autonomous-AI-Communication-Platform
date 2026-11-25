"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import {
  forgotPasswordApiV1AuthForgotPasswordPost,
  resetPasswordEndpointApiV1AuthResetPasswordPost,
} from "@/client/sdk.gen";
import { AuthShell } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { detailFromError } from "@/lib/apiError";

type Step = "request" | "reset";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("request");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const requestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await forgotPasswordApiV1AuthForgotPasswordPost({
        body: { email },
      });
      if (res.error) {
        toast.error(detailFromError(res.error, "Something went wrong"));
        return;
      }
      // Generic message by design (doesn't reveal whether the email exists).
      toast.success("If an account exists, a reset code has been sent.");
      setStep("reset");
    } catch {
      toast.error("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const submitReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    setLoading(true);
    try {
      const res = await resetPasswordEndpointApiV1AuthResetPasswordPost({
        body: { email, otp, new_password: newPassword },
      });
      if (res.error) {
        toast.error(detailFromError(res.error, "Invalid or expired code"));
        return;
      }
      toast.success("Password reset. Please sign in.");
      router.push("/auth/login");
    } catch {
      toast.error("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell>
      <div className="space-y-1.5 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Reset password</h1>
        <p className="text-sm text-muted-foreground">
          {step === "request"
            ? "Enter your email and we'll send you a reset code"
            : `Enter the code sent to ${email} and your new password`}
        </p>
      </div>

      {step === "request" ? (
        <form onSubmit={requestCode} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Sending..." : "Send reset code"}
          </Button>
        </form>
      ) : (
        <form onSubmit={submitReset} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="otp">Reset code</Label>
            <Input
              id="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="6-digit code"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              placeholder="At least 8 characters"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Resetting..." : "Reset password"}
          </Button>
          <button
            type="button"
            className="w-full text-center text-xs text-muted-foreground underline-offset-4 hover:underline"
            onClick={() => requestCode(new Event("submit") as unknown as React.FormEvent)}
            disabled={loading}
          >
            Didn&apos;t get a code? Resend
          </button>
        </form>
      )}

      <p className="text-center text-sm text-muted-foreground">
        Remembered it?{" "}
        <Link href="/auth/login" className="text-primary underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </p>
    </AuthShell>
  );
}
