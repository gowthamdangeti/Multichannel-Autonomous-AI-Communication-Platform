// Submission seam for the post-signup onboarding form.
// Fires a PostHog capture, POSTs to the IN-HOUSE backend
// (POST /api/v1/leads/onboarding — org resolved via email, no token needed),
// AND POSTs to the legacy external user_onboarding service (best-effort).
// The "show once per user" flag is stamped on the server-backed onboarding
// state by the caller, not here.
//
// No auth token. The logged-in user's email is passed in from the modal (available in
// the frontend session for both cloud and OSS) and sent in the body — there is no
// visible email field. `country` is detected silently and sent too. Onboarding is now
// COMPULSORY (no skip).

import posthog from "posthog-js";

import { PostHogEvent } from "@/constants/posthog-events";
import { getBackendApiUrl } from "@/lib/apiClient";

import { detectCountry } from "./detectCountry";
import type { LeadOrigin } from "./leadFieldOptions";
import { postOnboardingToService } from "./onboardingServiceClient";

export interface OnboardingAnswers {
  persona?: string;
  // Only present when persona unlocks the on-prem question.
  onPremNeed?: string;
  // Are you migrating from another provider? ("no" | a provider | "other").
  migratingFrom?: string;
  // Free-text provider name when migratingFrom === "other".
  migratingOtherProvider?: string;
  // Free-text "why are you switching?" (shown when migrating).
  switchReason?: string;
  // How did you hear about us?
  howHeard?: string;
  // Expected monthly call volume (0-5k | 5k-100k | 100k+ | exploring).
  volume?: string;
}

async function postOnboardingToLocalBackend(body: Record<string, unknown>): Promise<void> {
  // In-house store — primary for on-prem / data residency. The backend resolves
  // the org via the email in the body, so no Bearer token is needed here.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const baseUrl = getBackendApiUrl();
    const res = await fetch(`${baseUrl}/api/v1/leads/onboarding`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "true" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error(`[onboarding] local POST /leads/onboarding failed with HTTP ${res.status}`);
    }
  } catch (err) {
    console.error("[onboarding] local POST /leads/onboarding did not complete:", err);
  } finally {
    clearTimeout(timer);
  }
}

export async function submitOnboarding(
  answers: OnboardingAnswers,
  origin: LeadOrigin,
  email?: string,
): Promise<void> {
  posthog.capture(PostHogEvent.ONBOARDING_SUBMITTED, { ...answers, origin });
  const body = {
    source: "onboarding",
    origin,
    country: detectCountry(),
    ...(email ? { email } : {}),
    ...answers,
    skipped: false, // onboarding is compulsory now — kept for stored-shape continuity
  };
  await postOnboardingToLocalBackend(body);
  await postOnboardingToService(body);
}
