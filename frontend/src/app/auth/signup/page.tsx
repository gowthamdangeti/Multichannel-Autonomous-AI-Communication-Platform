"use client";

import { Eye, EyeOff, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { signupApiV1AuthSignupPost } from "@/client/sdk.gen";
import { AuthEnterpriseCTA } from "@/components/auth/AuthEnterpriseCTA";
import { AuthShell } from "@/components/auth/AuthShell";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface CountryOption {
  code: string;
  name: string;
  flag: string;
  dialCode: string;
}

const COUNTRY_OPTIONS: CountryOption[] = [
  { code: "IN", name: "India", flag: "🇮🇳", dialCode: "+91" },
  { code: "US", name: "United States", flag: "🇺🇸", dialCode: "+1" },
  { code: "GB", name: "United Kingdom", flag: "🇬🇧", dialCode: "+44" },
  { code: "AU", name: "Australia", flag: "🇦🇺", dialCode: "+61" },
  { code: "DE", name: "Germany", flag: "🇩🇪", dialCode: "+49" },
  { code: "FR", name: "France", flag: "🇫🇷", dialCode: "+33" },
  { code: "CA", name: "Canada", flag: "🇨🇦", dialCode: "+1" },
  { code: "JP", name: "Japan", flag: "🇯🇵", dialCode: "+81" },
  { code: "AE", name: "United Arab Emirates", flag: "🇦🇪", dialCode: "+971" },
  { code: "BR", name: "Brazil", flag: "🇧🇷", dialCode: "+55" },
];

export default function SignupPage() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [selectedCountryCode, setSelectedCountryCode] = useState("IN");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const selectedCountry =
    COUNTRY_OPTIONS.find((c) => c.code === selectedCountryCode) || COUNTRY_OPTIONS[0];

  // Auto-detect country based on browser timezone
  useEffect(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
      if (tz.includes("Kolkata") || tz.includes("Calcutta") || tz.includes("India")) {
        setSelectedCountryCode("IN");
      } else {
        setSelectedCountryCode("US");
      }
    } catch {
      // Fallback to default
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!firstName.trim()) {
      toast.error("Please enter your first name");
      return;
    }

    if (!lastName.trim()) {
      toast.error("Please enter your last name");
      return;
    }

    if (!email.trim() || !email.includes("@")) {
      toast.error("Please enter a valid email address");
      return;
    }

    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }

    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    setLoading(true);

    try {
      const fullPhone = phone ? `${selectedCountry.dialCode} ${phone.trim()}` : "";
      const fullName = `${firstName.trim()} ${lastName.trim()}`;

      const res = await signupApiV1AuthSignupPost({
        body: {
          email,
          password,
          name: fullName,
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          country: selectedCountry.name,
          phone_number: fullPhone,
        } as unknown as { email: string; password: string },
      });

      if (res.error || !res.data) {
        const detail = (res.error as { detail?: string })?.detail;
        toast.error(detail || "Signup failed");
        return;
      }

      // Set httpOnly session cookies via server route
      await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: res.data.token, user: res.data.user }),
      });

      toast.success("Account created successfully!");
      window.location.href = "/after-sign-in";
    } catch {
      toast.error("An error occurred during account creation. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell enterpriseSlot={<AuthEnterpriseCTA />}>
      <div className="space-y-1.5 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Create an account</h1>
        <p className="text-xs text-muted-foreground">Enter your personal details to get started with Convozent</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Row 1: First Name & Last Name */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="firstName">First name</Label>
            <Input
              id="firstName"
              type="text"
              placeholder="John"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lastName">Last name</Label>
            <Input
              id="lastName"
              type="text"
              placeholder="Doe"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
            />
          </div>
        </div>

        {/* Row 2: Country & Phone Number */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="country">Country</Label>
            <Select value={selectedCountryCode} onValueChange={setSelectedCountryCode}>
              <SelectTrigger id="country" className="w-full">
                <SelectValue placeholder="Select country" />
              </SelectTrigger>
              <SelectContent>
                {COUNTRY_OPTIONS.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    <span className="mr-2">{c.flag}</span>
                    <span>{c.name}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="phone">Phone number</Label>
            <div className="flex gap-2">
              <span className="inline-flex items-center px-3 rounded-md border bg-muted text-xs font-mono font-medium text-muted-foreground shrink-0">
                {selectedCountry.dialCode}
              </span>
              <Input
                id="phone"
                type="tel"
                placeholder="98765 43210"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Row 3: Email */}
        <div className="space-y-1.5">
          <Label htmlFor="email">Email address</Label>
          <Input
            id="email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        {/* Row 4: Password */}
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground focus:outline-none transition-colors"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>

        {/* Row 5: Confirm Password */}
        <div className="space-y-1.5">
          <Label htmlFor="confirmPassword">Confirm password</Label>
          <div className="relative">
            <Input
              id="confirmPassword"
              type={showConfirmPassword ? "text" : "password"}
              placeholder="Confirm your password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground focus:outline-none transition-colors"
              aria-label={showConfirmPassword ? "Hide password" : "Show password"}
            >
              {showConfirmPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>

        {/* Password Validation Indicator */}
        {password.length > 0 && (
          <div className="rounded-lg border bg-muted/40 p-2.5 space-y-1 text-xs">
            <div className="flex items-center gap-2">
              <span className={password.length >= 8 ? "text-emerald-500 font-bold" : "text-muted-foreground"}>
                {password.length >= 8 ? "✓" : "○"}
              </span>
              <span className={password.length >= 8 ? "text-foreground font-medium" : "text-muted-foreground"}>
                At least 8 characters
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className={password === confirmPassword && confirmPassword.length > 0 ? "text-emerald-500 font-bold" : "text-muted-foreground"}>
                {password === confirmPassword && confirmPassword.length > 0 ? "✓" : "○"}
              </span>
              <span className={password === confirmPassword && confirmPassword.length > 0 ? "text-foreground font-medium" : "text-muted-foreground"}>
                Passwords match
              </span>
            </div>
          </div>
        )}

        <Button type="submit" className="w-full gap-2 py-5 font-semibold" disabled={loading}>
          {loading ? (
            "Creating account..."
          ) : (
            <>
              <Sparkles className="size-4" />
              <span>Create account</span>
            </>
          )}
        </Button>
      </form>

      <div className="relative my-4">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-2 text-muted-foreground">
            Or sign up with
          </span>
        </div>
      </div>

      <GoogleSignInButton text="signup_with" />

      <p className="text-center text-xs text-muted-foreground pt-2">
        Already have an account?{" "}
        <Link href="/auth/login" className="text-primary font-medium underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
