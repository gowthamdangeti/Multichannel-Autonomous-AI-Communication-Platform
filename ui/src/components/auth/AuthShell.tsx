// Shared two-column auth shell, used by BOTH the Stack Auth handler
// (/handler/[...stack], cloud) and the local/OSS auth pages (/auth/login,
// /auth/signup, /auth/forgot-password).
// LEFT (lg+ only): an inset, rounded monochrome brand panel with the
// animated FloatingPaths SVG flow illustration from login-03 — logo on top,
// tagline + proof points at the bottom, and a slim enterprise row.
// RIGHT: the auth form (`children`) on the plain page background with ambient glow.

"use client";

import type { ReactNode } from "react";

import { BRAND } from "@/brand";
import { BrandLogo } from "@/components/BrandLogo";
import { FloatingPaths } from "@/components/ui/login-03";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const HIGHLIGHTS = [
  {
    title: "Autonomous Agents",
    description: "Multi-agent coordination across research, engineering, and communications.",
  },
  {
    title: "MCP & Tool Integration",
    description: "Native Model Context Protocol support to connect agents with external systems.",
  },
  {
    title: "Enterprise Governance",
    description: "Controlled autonomy with human-in-the-loop approval gates and cryptographic audits.",
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
        <div className="sticky top-4 flex h-[calc(100dvh-2rem)] flex-col justify-between overflow-hidden rounded-3xl border border-border bg-card p-10 text-foreground xl:p-12 relative">
          {/* Subtle gradient overlay */}
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none z-0"
            style={{
              background:
                "linear-gradient(to bottom, transparent, transparent, var(--background))",
            }}
          />

          {/* FloatingPaths illustration from login-03 */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
            <FloatingPaths position={1} />
            <FloatingPaths position={-1} />
          </div>

          <div className="relative z-10">
            <BrandLogo inverse={false} className="text-3xl font-bold" />
          </div>

          <div className="relative z-10 space-y-6">
            <div className="space-y-4">
              <h2 className="text-4xl font-semibold leading-[1.12] tracking-tight xl:text-[2.75rem]">
                {BRAND.tagline}
              </h2>
              <p className="max-w-md text-base leading-relaxed text-muted-foreground">
                Manage your digital workforce, deploy autonomous multi-agent
                workflows, and scale enterprise automation.
              </p>
            </div>

            <ul className="flex flex-wrap gap-2">
              {HIGHLIGHTS.map((point) => (
                <li key={point.title}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-block cursor-help rounded-full border border-border bg-muted/60 px-3.5 py-1.5 text-xs font-semibold backdrop-blur-sm transition-colors hover:bg-muted">
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
              <div className="flex items-center justify-between gap-4 border-t border-border pt-5">
                <p className="text-sm text-muted-foreground">
                  Need on-prem, data residency &amp; a data perimeter?
                </p>
                {enterpriseSlot}
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Form column (RIGHT) — scrolls and stays centered so tall forms never clip */}
      <main className="relative flex min-h-dvh flex-col overflow-y-auto">
        {/* Ambient radial glow */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-0 opacity-40 overflow-hidden"
        >
          <div
            className="absolute end-0 top-0 h-[30rem] w-[20rem] -translate-y-24 rounded-full"
            style={{
              background:
                "radial-gradient(68.54% 68.72% at 55.02% 31.46%, color-mix(in oklch, var(--foreground) 6%, transparent) 0, color-mix(in oklch, var(--foreground) 2%, transparent) 50%, color-mix(in oklch, var(--foreground) 1%, transparent) 80%)",
            }}
          />
        </div>

        <div className="relative z-10 flex min-h-full flex-1 items-center justify-center px-6 py-10 sm:px-10">
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
