"use client";

import { useCallback, useEffect, useState } from "react";

import { listVoicesApiV1AdminVoicesGet } from "@/client/sdk.gen";
import type { VoiceResponse } from "@/client/types.gen";
import { useAuth } from "@/lib/auth";

/**
 * Admin voice catalog (super admins only): which provider voices are curated.
 * Org users get an empty catalog and no request is made.
 */
export function useVoiceCatalog(enabled: boolean, provider: string) {
    const { user, loading: authLoading } = useAuth();
    const [entries, setEntries] = useState<VoiceResponse[]>([]);

    const refresh = useCallback(async () => {
        if (!enabled) return;
        const response = await listVoicesApiV1AdminVoicesGet({ query: { active_only: false } });
        // Catalog tags are optional decoration; a failed load just hides them.
        if (!response.error && response.data) setEntries(response.data);
    }, [enabled]);

    useEffect(() => {
        if (!enabled || authLoading || !user) return;
        void refresh();
    }, [enabled, authLoading, user, refresh]);

    const findEntry = useCallback(
        (voiceId: string) => entries.find((e) => e.provider === provider && e.voice_id === voiceId),
        [entries, provider],
    );

    return { findEntry, refresh };
}
