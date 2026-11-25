"use client";

import { useEffect, useState } from "react";

import { getCurrentUserApiV1AuthMeGet } from "@/client/sdk.gen";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";

import { TwoFactorCard } from "./TwoFactorCard";

export function SecuritySettings() {
  const { user, loading: authLoading, getAccessToken } = useAuth();
  const authEmail =
    (user as { email?: string; primaryEmail?: string } | null)?.email ||
    (user as { email?: string; primaryEmail?: string } | null)?.primaryEmail ||
    "";

  const [userEmail, setUserEmail] = useState("");
  const [is2FAEnabled, setIs2FAEnabled] = useState(false);
  const [loadingUser, setLoadingUser] = useState(true);

  // Sync authEmail into userEmail when available
  useEffect(() => {
    if (authEmail && !userEmail) {
      setUserEmail(authEmail);
    }
  }, [authEmail, userEmail]);

  useEffect(() => {
    let isMounted = true;

    async function loadUser() {
      try {
        const token = await getAccessToken();
        const res = await getCurrentUserApiV1AuthMeGet({
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });

        if (!isMounted) return;

        if (res.data) {
          const email = res.data.email ?? authEmail;
          const enabled = (res.data as { is_2fa_enabled?: boolean }).is_2fa_enabled ?? false;
          if (email) setUserEmail(email);
          setIs2FAEnabled(enabled);
        } else if (authEmail) {
          setUserEmail(authEmail);
        }
      } catch {
        if (isMounted && authEmail) {
          setUserEmail(authEmail);
        }
      } finally {
        if (isMounted) {
          setLoadingUser(false);
        }
      }
    }

    if (!authLoading) {
      loadUser();
    }

    return () => {
      isMounted = false;
    };
  }, [authLoading, getAccessToken, authEmail]);

  const activeEmail = userEmail || authEmail || "";

  return (
    <>
      {authLoading || loadingUser ? (
        <div className="flex items-center justify-between rounded-lg border border-border p-4">
          <div className="space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3.5 w-64 max-w-full" />
          </div>
          <Skeleton className="h-5 w-9 rounded-md" />
        </div>
      ) : (
        <TwoFactorCard key={activeEmail} email={activeEmail} initiallyEnabled={is2FAEnabled} />
      )}
    </>
  );
}
