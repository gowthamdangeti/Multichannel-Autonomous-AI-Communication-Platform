import { useCallback, useEffect, useState } from "react";

import { getAgentApiV1ChatAgentsAgentIdGet } from "@/client/sdk.gen";
import type { ChatAgentResponse } from "@/client/types.gen";
import { detailFromError } from "@/lib/apiError";
import { useAuth } from "@/lib/auth";

const LOAD_ERROR = "We could not load this chat agent.";

/** `agentId` is null while the caller does not know it yet (e.g. a conversation still loading). */
export function useChatAgent(agentId: number | null) {
  const { user, loading: authLoading } = useAuth();
  const [agent, setAgent] = useState<ChatAgentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (agentId === null) return;
    const res = await getAgentApiV1ChatAgentsAgentIdGet({ path: { agent_id: agentId } }).catch(() => null);
    if (res?.data) {
      setAgent(res.data);
      setError(null);
    } else {
      setError(res?.error ? detailFromError(res.error, LOAD_ERROR) : LOAD_ERROR);
    }
  }, [agentId]);

  useEffect(() => {
    if (authLoading || !user || agentId === null) return;
    void load();
  }, [authLoading, user, agentId, load]);

  return { agent, error, reload: load };
}
