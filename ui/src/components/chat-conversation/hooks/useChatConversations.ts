import { useCallback, useEffect, useState } from "react";

import { listConversationsApiV1ChatConversationsGet } from "@/client/sdk.gen";
import type { ChatConversationSummary } from "@/client/types.gen";
import { detailFromError } from "@/lib/apiError";
import { useAuth } from "@/lib/auth";

const LOAD_ERROR = "We could not load the chat conversations.";

/**
 * Every chat conversation in the organization; `rows` is null until the first
 * load finishes. Pass `enabled: false` to defer the fetch until the list is
 * actually on screen (e.g. a tab that is not open yet).
 */
export function useChatConversations({ enabled = true }: { enabled?: boolean } = {}) {
  const { user, loading: authLoading } = useAuth();
  const [rows, setRows] = useState<ChatConversationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const load = useCallback(async () => {
    setIsRefreshing(true);
    const res = await listConversationsApiV1ChatConversationsGet().catch(() => null);
    if (res?.data) {
      setRows(res.data);
      setError(null);
    } else {
      setError(res?.error ? detailFromError(res.error, LOAD_ERROR) : LOAD_ERROR);
    }
    setIsRefreshing(false);
  }, []);

  useEffect(() => {
    if (!enabled || authLoading || !user) return;
    void load();
  }, [enabled, authLoading, user, load]);

  return { rows, error, isRefreshing, reload: load };
}
