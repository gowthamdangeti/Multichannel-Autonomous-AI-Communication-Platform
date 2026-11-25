"use client";

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import { getBackendApiUrl } from "@/lib/apiClient";
import { useAuth } from "@/lib/auth";

export interface TeamsAccess {
  organizationId: number;
  role: string;
  teamId: number | null;
  canView: boolean;
  canManage: boolean;
  canViewOrganization: boolean;
}

export type TeamsAccessStatus = "loading" | "allowed" | "denied" | "error";

interface TeamsAccessContextValue {
  access: TeamsAccess | null;
  status: TeamsAccessStatus;
  error: string | null;
  refresh: () => Promise<void>;
}

const TeamsAccessContext = createContext<TeamsAccessContextValue | null>(null);

function parseAccess(value: unknown): TeamsAccess | null {
  if (!value || typeof value !== "object") return null;
  if (
    !("organization_id" in value) ||
    typeof value.organization_id !== "number" ||
    !("role" in value) ||
    typeof value.role !== "string" ||
    !("can_view" in value) ||
    typeof value.can_view !== "boolean" ||
    !("can_manage" in value) ||
    typeof value.can_manage !== "boolean" ||
    !("can_view_organization" in value) ||
    typeof value.can_view_organization !== "boolean"
  ) {
    return null;
  }

  const teamId = "team_id" in value && typeof value.team_id === "number" ? value.team_id : null;
  return {
    organizationId: value.organization_id,
    role: value.role,
    teamId,
    canView: value.can_view,
    canManage: value.can_manage,
    canViewOrganization: value.can_view_organization,
  };
}

export function TeamsAccessProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading, getAccessToken } = useAuth();
  const [access, setAccess] = useState<TeamsAccess | null>(null);
  const [status, setStatus] = useState<TeamsAccessStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const hasResolved = useRef(false);
  const previousUserId = useRef<string | null>(user ? String(user.id) : null);

  const refresh = useCallback(async () => {
    if (authLoading) return;
    const currentUserId = user ? String(user.id) : null;
    if (previousUserId.current !== currentUserId) {
      previousUserId.current = currentUserId;
      hasResolved.current = false;
      setAccess(null);
      setError(null);
      setStatus("loading");
    }
    if (!user) {
      setAccess(null);
      setError(null);
      setStatus("denied");
      hasResolved.current = true;
      return;
    }
    if (inFlight.current) return inFlight.current;

    const request = (async () => {
      if (!hasResolved.current) setStatus("loading");
      try {
        const token = await getAccessToken();
        if (!token) {
          setAccess(null);
          setError(null);
          setStatus("denied");
          hasResolved.current = true;
          return;
        }
        const response = await fetch(`${getBackendApiUrl()}/api/v1/teams/access`, {
          headers: {
            Authorization: `Bearer ${token}`,
            "ngrok-skip-browser-warning": "true",
          },
          cache: "no-store",
        });
        if (response.status === 401 || response.status === 403 || response.status === 400) {
          setAccess(null);
          setError(null);
          setStatus("denied");
          hasResolved.current = true;
          return;
        }
        if (!response.ok) {
          throw new Error(`Teams access check failed (HTTP ${response.status}).`);
        }
        const parsed = parseAccess(await response.json());
        if (!parsed?.canView) {
          setAccess(null);
          setError(null);
          setStatus("denied");
          hasResolved.current = true;
          return;
        }
        setAccess(parsed);
        setError(null);
        setStatus("allowed");
        hasResolved.current = true;
      } catch (cause) {
        setAccess(null);
        setError(cause instanceof Error ? cause.message : "Teams access check failed.");
        setStatus("error");
        hasResolved.current = true;
      }
    })();

    inFlight.current = request;
    try {
      await request;
    } finally {
      inFlight.current = null;
    }
  }, [authLoading, getAccessToken, user]);

  useEffect(() => {
    void refresh();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const refreshOnMembershipChange = () => void refresh();
    window.addEventListener("focus", refreshWhenVisible);
    window.addEventListener("teams:membership-changed", refreshOnMembershipChange);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    // Other signed-in sessions receive membership changes on their next focus or
    // within this bounded interval; no logout/login cycle is required.
    const interval = window.setInterval(() => void refresh(), 60_000);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      window.removeEventListener("teams:membership-changed", refreshOnMembershipChange);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.clearInterval(interval);
    };
  }, [refresh]);

  return (
    <TeamsAccessContext.Provider value={{ access, status, error, refresh }}>
      {children}
    </TeamsAccessContext.Provider>
  );
}

export function useTeamsAccess(): TeamsAccessContextValue {
  const context = useContext(TeamsAccessContext);
  if (!context) {
    throw new Error("useTeamsAccess must be used within TeamsAccessProvider");
  }
  return context;
}
