// Shared two-column auth shell, used by BOTH the Stack Auth handler
// (/handler/[...stack], cloud) and the local/OSS auth pages (/auth/login,
// /auth/signup, /auth/forgot-password).
// LEFT (lg+ only): an inset, rounded monochrome (charcoal-to-black) brand
// panel with an animated grain-gradient shader background
// (AuthPanelShader) — logo on top, tagline + proof points
// at the bottom, and a slim enterprise row (`enterpriseSlot`).
// RIGHT: the auth form (`children`) on the plain page background, no card.
// Mobile collapses to the form column with a wordmark above it. The form
// column scrolls and stays centered so tall (sign-up) forms never clip.
// Panel colors live in globals.css (--auth-panel-surface, --auth-panel-foreground).

import type { ReactNode } from "react";

import { BRAND } from "@/brand";
import { AuthPanelShader } from "@/components/auth/AuthPanelShader";
import { BrandLogo } from "@/components/BrandLogo";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const HIGHLIGHTS = [
  {
    title: "Speech-to-speech",
    description: "Low-latency conversational AI with natural, real-time voice interaction.",
  },
  {
    title: "MCP-native",
    description: "Native Model Context Protocol support to connect your agents with external tools and data.",
  },
  {
    title: "BYOK - any model",
    description: "Bring Your Own Key — run any model over Autonomous AI OS.",
  },
];

export function AuthShell({
  children,
  enterpriseSlot,
}: {
  children: ReactNode;
  enterpriseSlot?: ReactNode;
}) {
  return (
    <div className="grid min-h-dvh w-full bg-background lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      {/* Brand panel (LEFT) — hidden on mobile */}
      <aside className="hidden p-4 lg:block">
        <div className="sticky top-4 flex h-[calc(100dvh-2rem)] flex-col justify-between overflow-hidden rounded-3xl border border-auth-panel-foreground/10 bg-(image:--auth-panel-surface) bg-origin-border bg-no-repeat p-10 text-auth-panel-foreground xl:p-12">
          <AuthPanelShader />

          <div className="relative">
            <BrandLogo inverse className="text-3xl" />
          </div>

          <div className="relative space-y-6">
            <div className="space-y-4">
              <h2 className="text-4xl font-semibold leading-[1.12] tracking-tight xl:text-[2.75rem]">
                {BRAND.tagline}
              </h2>
              <p className="max-w-md text-base leading-relaxed text-auth-panel-foreground/70">
                Build, deploy and monitor voice agents across telephony and
                WebRTC — all in one console.
              </p>
            </div>

            <ul className="flex flex-wrap gap-2">
              {HIGHLIGHTS.map((point) => (
                <li key={point.title}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-block cursor-help rounded-full border border-auth-panel-foreground/25 bg-auth-panel-foreground/10 px-3.5 py-1.5 text-xs font-semibold backdrop-blur-sm transition-colors hover:bg-auth-panel-foreground/20">
                        {point.title}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" align="center" className="max-w-xs">
                      {point.description}
                    </TooltipContent>
                  </Tooltip>
                </li>
              ))}
            </ul>

            {enterpriseSlot && (
              <div className="flex items-center justify-between gap-4 border-t border-auth-panel-foreground/20 pt-5">
                <p className="text-sm text-auth-panel-foreground/85">
                  Need on-prem, data residency &amp; a data perimeter?
                </p>
                {enterpriseSlot}
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Form column (RIGHT) — scrolls and stays centered so tall forms never clip */}
      <main className="flex min-h-dvh flex-col overflow-y-auto">
        <div className="flex min-h-full flex-1 items-center justify-center px-6 py-10 sm:px-10">
          <div className="w-full max-w-md space-y-6">
            {/* Mobile-only wordmark (brand panel is hidden) */}
            <div className="lg:hidden">
              <BrandLogo className="h-7" />
            </div>
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
