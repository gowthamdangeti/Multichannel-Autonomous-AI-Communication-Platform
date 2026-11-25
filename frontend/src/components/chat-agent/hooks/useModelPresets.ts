import { useCallback, useEffect, useState } from "react";

import { getModelConfigurationOptionsApiV1OrganizationsModelConfigurationOptionsGet } from "@/client/sdk.gen";
import type { ModelConfigurationOption } from "@/client/types.gen";
import { useAuth } from "@/lib/auth";

/** The org's model configuration presets an agent can be pointed at. */
export function useModelPresets() {
  const { user, loading: authLoading, getAccessToken } = useAuth();
  const [presets, setPresets] = useState<ModelConfigurationOption[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getAccessToken();
      const res = await getModelConfigurationOptionsApiV1OrganizationsModelConfigurationOptionsGet({
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (res.data) setPresets(res.data);
    } catch {
      /* non-critical: the caller falls back to no preset */
    } finally {
      setLoading(false);
    }
  }, [getAccessToken]);

  // Wait for authentication: the request needs the bearer token, and firing it
  // on mount only races the auth interceptor and comes back 401.
  useEffect(() => {
    if (authLoading || !user) return;
    void load();
  }, [authLoading, user, load]);

  return { presets, loading };
}
