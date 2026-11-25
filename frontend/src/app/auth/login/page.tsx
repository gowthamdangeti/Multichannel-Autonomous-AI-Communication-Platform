"use client";

import { Eye, EyeOff, KeyRound, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { BRAND } from "@/brand";
import { loginApiV1AuthLoginPost } from "@/client/sdk.gen";
import { AuthEnterpriseCTA } from "@/components/auth/AuthEnterpriseCTA";
import { AuthShell } from "@/components/auth/AuthShell";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { RecoveryLoginForm } from "@/components/auth/RecoveryLoginForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getBackendApiUrl } from "@/lib/apiClient";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  // 2FA Challenge states
  const [requires2fa, setRequires2fa] = useState(false);
  const [otp, setOtp] = useState("");
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await loginApiV1AuthLoginPost({
        body: { email, password },
      });

      if (res.error || !res.data) {
        const detail = (res.error as { detail?: string })?.detail;
        toast.error(detail || "Login failed");
        return;
      }

      // Check if 2FA verification is required
      const data = res.data as { requires_2fa?: boolean; token?: string; user?: unknown; message?: string };
      if (data.requires_2fa) {
        setRequires2fa(true);
        toast.info(data.message || "Enter the 6-digit 2FA code sent to your email.");
        return;
      }

      if (data.token && data.user) {
        // Set httpOnly cookies via server route
        await fetch("/api/auth/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: data.token, user: data.user }),
        });

        window.location.href = "/after-sign-in";
      }
    } catch {
      toast.error("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const completeTwoFactorSignIn = async (data: { token: string; user: unknown }) => {
    await fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: data.token, user: data.user }),
    });

    toast.success("Two-Factor Authentication verified!");
    window.location.href = "/after-sign-in";
  };

  const handleVerify2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otp.length !== 6) {
      toast.error("Please enter a valid 6-digit verification code.");
      return;
    }

    setVerifyingOtp(true);
    try {
      const baseUrl = getBackendApiUrl();
      const res = await fetch(`${baseUrl}/api/v1/auth/login/verify-2fa`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp }),
      });

      const data = await res.json();
      if (!res.ok || !data.token) {
        toast.error(data.detail || "Invalid 2FA verification code.");
        return;
      }

      await completeTwoFactorSignIn(data);
    } catch {
      toast.error("Failed to verify code. Please check your network.");
    } finally {
      setVerifyingOtp(false);
    }
  };

  if (requires2fa) {
    return (
      <AuthShell enterpriseSlot={<AuthEnterpriseCTA />}>
        <div className="space-y-1.5 text-center">
          <div className="mx-auto size-12 rounded-full bg-muted text-foreground flex items-center justify-center mb-2">
            <ShieldCheck className="size-6" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Two-Factor Authentication</h1>
          <p className="text-sm text-muted-foreground">
            {useRecoveryCode ? (
              "Enter one of your saved recovery codes"
            ) : (
              <>
                We sent a 6-digit code to <strong className="text-foreground">{email}</strong>
              </>
            )}
          </p>
        </div>

        {useRecoveryCode ? (
          <RecoveryLoginForm
            email={email}
            password={password}
            onBack={() => setUseRecoveryCode(false)}
            onSignedIn={completeTwoFactorSignIn}
          />
        ) : (
        <form onSubmit={handleVerify2FA} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="otp">6-Digit Verification Code</Label>
            <div className="relative">
              <Input
                id="otp"
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="123456"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                required
                className="text-center font-mono text-lg tracking-widest pl-10"
                autoFocus
              />
              <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            </div>
          </div>

          <Button
            type="submit"
            className="h-12 w-full text-base font-semibold"
            disabled={verifyingOtp || otp.length !== 6}
          >
            {verifyingOtp ? "Verifying..." : "Verify & Sign In"}
          </Button>

          <Button
            type="button"
            variant="ghost"
            className="w-full text-xs text-muted-foreground"
            onClick={() => setUseRecoveryCode(true)}
          >
            Use a recovery code
          </Button>

          <Button
            type="button"
            variant="ghost"
            className="w-full text-xs text-muted-foreground"
            onClick={() => setRequires2fa(false)}
          >
            Back to login
          </Button>
        </form>
        )}
      </AuthShell>
    );
  }

  return (
    <AuthShell enterpriseSlot={<AuthEnterpriseCTA />}>
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Welcome back</h1>
        <p className="text-base text-muted-foreground">
          Log in to your {BRAND.name} console
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="h-12 px-4"
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link
              href="/auth/forgot-password"
              className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="h-12 px-4 pr-11"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground focus:outline-none transition-colors"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? (
                <EyeOff className="size-4" />
              ) : (
                <Eye className="size-4" />
              )}
            </button>
          </div>
        </div>
        <Button
          type="submit"
          className="h-12 w-full text-base font-semibold"
          disabled={loading}
        >
          {loading ? "Logging in..." : "Log in"}
        </Button>
      </form>

      <div className="flex items-center gap-3 text-xs font-medium text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        OR
        <span className="h-px flex-1 bg-border" />
      </div>

      <GoogleSignInButton text="continue_with" />

      <p className="text-center text-sm text-muted-foreground">
        New to {BRAND.name}?{" "}
        <Link href="/auth/signup" className="font-semibold text-foreground underline-offset-4 hover:underline">
          Create account
        </Link>
      </p>
    </AuthShell>
  );
}

