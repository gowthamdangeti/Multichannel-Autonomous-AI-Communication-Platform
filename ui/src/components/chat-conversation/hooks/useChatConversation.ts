import { useCallback, useEffect, useState } from "react";

import {
  evaluateChatConversationCompletenessApiV1ChatConversationsConversationIdCompletenessPost,
  getConversationDetailApiV1ChatConversationsConversationIdGet,
} from "@/client/sdk.gen";
import type { ChatConversationDetail } from "@/client/types.gen";
import type { ConversationCompleteness } from "@/components/workflow/ConversationCompleteness";
import { detailFromError } from "@/lib/apiError";
import { useAuth } from "@/lib/auth";

const LOAD_ERROR = "We could not load this conversation.";

export function useChatConversation(conversationId: number) {
  const { user, loading: authLoading } = useAuth();
  const [conversation, setConversation] = useState<ChatConversationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [completeness, setCompleteness] = useState<ConversationCompleteness | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);

  const evaluate = useCallback(async () => {
    setIsEvaluating(true);
    const res = await evaluateChatConversationCompletenessApiV1ChatConversationsConversationIdCompletenessPost({
      path: { conversation_id: conversationId },
    }).catch(() => null);
    if (res?.data) setCompleteness(res.data as ConversationCompleteness);
    setIsEvaluating(false);
  }, [conversationId]);

  const load = useCallback(async () => {
    const res = await getConversationDetailApiV1ChatConversationsConversationIdGet({
      path: { conversation_id: conversationId },
    }).catch(() => null);
    if (res?.data) {
      setConversation(res.data);
      setError(null);
    } else {
      setError(res?.error ? detailFromError(res.error, LOAD_ERROR) : LOAD_ERROR);
    }
  }, [conversationId]);

  useEffect(() => {
    if (authLoading || !user) return;
    void load();
  }, [authLoading, user, load]);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  }, [load]);

  return { conversation, error, isRefreshing, refresh, completeness, isEvaluating, evaluate };
}
