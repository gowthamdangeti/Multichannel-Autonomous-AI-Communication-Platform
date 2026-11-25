"use client";

import type { Team } from "@stackframe/stack";
import { useRouter } from "next/navigation";
import React, { useRef } from "react";

import { useAuth } from "@/lib/auth";

const StackTeamSwitcher = React.lazy(() =>
  import("@stackframe/stack").then((mod) => ({
    default: mod.SelectedTeamSwitcher,
  }))
);

export function SidebarTeamSwitcher() {
  const router = useRouter();
  const { provider, getSelectedTeam } = useAuth();

  // Keep the reference stable so SelectedTeamSwitcher only sees a change when
  // the team ID changes, preventing a PATCH to Stack Auth on every navigation.
  const selectedTeamRef = useRef<Team | null>(null);
  const rawSelectedTeam = provider === "stack" && getSelectedTeam ? (getSelectedTeam() as Team | null) : null;
  if (rawSelectedTeam?.id !== selectedTeamRef.current?.id) {
    selectedTeamRef.current = rawSelectedTeam;
  }

  if (provider !== "stack") return null;

  return (
    <div className="notranslate" translate="no">
      <React.Suspense fallback={<div className="h-9 w-full animate-pulse rounded bg-muted" />}>
        <StackTeamSwitcher
          selectedTeam={selectedTeamRef.current || undefined}
          onChange={() => {
            router.refresh();
          }}
        />
      </React.Suspense>
    </div>
  );
}
