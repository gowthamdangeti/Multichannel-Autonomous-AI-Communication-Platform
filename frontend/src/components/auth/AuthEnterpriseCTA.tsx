"use client";

// Enterprise call-to-action rendered inside the auth brand panel. Opens the
// SAME in-app Enterprise lead modal used post-login (not the marketing site's
// /contact page). The visitor is typically NOT authenticated here: the modal
// requires a work email in that case, and submitLead persists the lead through
// the user_onboarding service's public contact-sales endpoint instead of the
// token-gated /leads/enterprise. Shared by the Stack Auth handler and the
// local/OSS auth pages.

import posthog from "posthog-js";
import { useState } from "react";

import { EnterpriseModal } from "@/components/lead-forms/EnterpriseModal";
import { Button } from "@/components/ui/button";
import { PostHogEvent } from "@/constants/posthog-events";

export function AuthEnterpriseCTA() {
  const [open, setOpen] = useState(false);

  const openModal = () => {
    setOpen(true);
    posthog.capture(PostHogEvent.ENTERPRISE_LEAD_OPENED, { source: "auth_page" });
  };

  return (
    <>
      <Button
        variant="outline"
        onClick={openModal}
        // Same surface as the highlight chips in AuthShell (translucent fill +
        // hairline border + blur), so the panel's animated background shows
        // through both identically.
        className="shrink-0 rounded-md border border-auth-panel-foreground/25 bg-auth-panel-foreground/10 px-5 text-auth-panel-foreground shadow-none backdrop-blur-sm transition-colors hover:translate-x-0 hover:translate-y-0 hover:bg-auth-panel-foreground/20 hover:text-auth-panel-foreground active:translate-x-0 active:translate-y-0"
      >
        Enterprise Enquiry
      </Button>
      <EnterpriseModal open={open} onOpenChange={setOpen} source="auth_page" />
    </>
  );
}
