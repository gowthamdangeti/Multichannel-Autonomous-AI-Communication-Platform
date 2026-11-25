// Single submission seam for all lead forms.
// Fires a PostHog capture and POSTs to the IN-HOUSE backend first
// (data-residency safe: POST /api/v1/leads/enterprise, no auth), then to the
// legacy external user_onboarding service (best-effort — never blocks the user).
// No auth token: identity is the email in the payload.

import posthog from "posthog-js";

import { PostHogEvent } from "@/constants/posthog-events";
import { getBackendApiUrl } from "@/lib/apiClient";

import { detectCountry } from "./detectCountry";
import type { LeadKind, LeadOrigin, LeadSource } from "./leadFieldOptions";
import { postLeadToService } from "./onboardingServiceClient";

const SUBMIT_EVENT: Record<LeadKind, string> = {
  hire_expert: PostHogEvent.HIRE_EXPERT_SUBMITTED,
  enterprise: PostHogEvent.ENTERPRISE_LEAD_SUBMITTED,
};

export interface SubmitLeadArgs {
  kind: LeadKind;
  source: LeadSource;
  // Deployment provenance (analytics only): "cloud_app" | "oss_app".
  origin: LeadOrigin;
  // Field values, already validated by the caller. Includes the contact email.
  payload: Record<string, unknown>;
}

async function postLeadToLocalBackend(kind: LeadKind, body: Record<string, unknown>): Promise<void> {
  // In-house store — primary for on-prem / data residency. Best-effort with a
  // short timeout so a down backend never blocks the user. Only enterprise
  // leads have a local endpoint today; hire-expert keeps the legacy path.
  if (kind !== "enterprise") return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const baseUrl = getBackendApiUrl();
    const res = await fetch(`${baseUrl}/api/v1/leads/enterprise`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "true" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error(`[leads] local POST /leads/enterprise failed with HTTP ${res.status}`);
    }
  } catch (err) {
    console.error("[leads] local POST /leads/enterprise did not complete:", err);
  } finally {
    clearTimeout(timer);
  }
}

export async function submitLead({ kind, source, origin, payload }: SubmitLeadArgs): Promise<void> {
  // `country` is detected silently (timezone/locale) and sent in the body — no visible
  // field. It feeds the founders-notification email subject server-side.
  const body = { source, origin, country: detectCountry(), ...payload };
  // PostHog capture — analytics only, always fired.
  posthog.capture(SUBMIT_EVENT[kind], body);
  // Persist in-house first (data residency), then legacy external service.
  await postLeadToLocalBackend(kind, body);
  // Persist to the separate user_onboarding service (best-effort, public).
  await postLeadToService(kind, body);
}
