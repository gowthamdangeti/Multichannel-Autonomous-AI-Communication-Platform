"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { listDocumentsApiV1KnowledgeBaseDocumentsGet, listToolsApiV1ToolsGet } from "@/client/sdk.gen";
import type { DocumentResponseSchema, ToolResponse } from "@/client/types.gen";
import { detailFromError } from "@/lib/apiError";
import { useAuth } from "@/lib/auth";

import {
  type AgentDraft,
  buildAgentPayload,
  type ChatAgent,
  type ChatCharacter,
  type ChatDrawerTab,
  DEFAULT_CHAT_CHARACTERS,
  draftFromAgent,
  DRAWER_TABS,
  emptyDraft,
} from "../editor/chatAgentDraft";
import { useModelPresets } from "./useModelPresets";

interface UseChatAgentEditorOptions {
  open: boolean;
  /** The agent being edited; null creates a new one. */
  agent: ChatAgent | null;
  onSaved: (saved: ChatAgent, created: boolean) => void;
  onOpenChange: (open: boolean) => void;
}

/**
 * State and actions behind the chat agent editor drawer. The drawer is shared by
 * the Chat Agents list and an agent's own page, so neither owns this logic.
 */
export function useChatAgentEditor({ open, agent, onSaved, onOpenChange }: UseChatAgentEditorOptions) {
  const { getAccessToken } = useAuth();
  const { presets, loading: presetsLoading } = useModelPresets();

  const [draft, setDraft] = useState<AgentDraft>(() => emptyDraft(null));
  const [activeTab, setActiveTab] = useState<ChatDrawerTab>("characters");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [characters, setCharacters] = useState<ChatCharacter[]>(DEFAULT_CHAT_CHARACTERS);
  const [tools, setTools] = useState<ToolResponse[]>([]);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [documents, setDocuments] = useState<DocumentResponseSchema[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);

  const authFetch = useCallback(
    async (path: string, opts: RequestInit = {}) => {
      const token = await getAccessToken();
      return fetch(`/api/v1${path}`, {
        ...opts,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(opts.headers ?? {}) },
      });
    },
    [getAccessToken],
  );

  // Each opening starts from the agent's saved values (or a blank one) on the first tab.
  // Keyed on the agent's id so a background refresh of the agent never clobbers edits.
  useEffect(() => {
    if (!open) return;
    const defaultPreset = presets[0]?.id ?? null;
    setDraft(agent ? draftFromAgent(agent, defaultPreset) : emptyDraft(defaultPreset));
    setError(null);
    setActiveTab("characters");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, agent?.id]);

  // Presets can arrive after the drawer opens; fill the default model in then.
  useEffect(() => {
    const first = presets[0]?.id;
    if (open && first != null) {
      setDraft((d) => (d.platform_model_configuration_id == null ? { ...d, platform_model_configuration_id: first } : d));
    }
  }, [open, presets]);

  // Tools, documents and characters are only fetched once the drawer is used.
  useEffect(() => {
    if (!open) return;
    setToolsLoading(true);
    listToolsApiV1ToolsGet()
      .then((res) => res.data && setTools(res.data))
      .catch(() => undefined)
      .finally(() => setToolsLoading(false));
    setDocumentsLoading(true);
    listDocumentsApiV1KnowledgeBaseDocumentsGet({ query: { limit: 100, offset: 0 } })
      .then((res) => res.data && setDocuments(res.data.documents))
      .catch(() => undefined)
      .finally(() => setDocumentsLoading(false));
    authFetch("/chat/characters")
      .then(async (res) => {
        const data = res.ok ? await res.json() : null;
        if (Array.isArray(data) && data.length > 0) setCharacters(data);
      })
      .catch(() => undefined);
  }, [open, authFetch]);

  const pickCharacter = (c: ChatCharacter) =>
    setDraft((d) => ({ ...d, character: c.key, system_prompt: c.persona, greeting: c.greeting }));

  const handlePrev = () => {
    setError(null);
    const idx = DRAWER_TABS.findIndex((t) => t.value === activeTab);
    if (idx > 0) setActiveTab(DRAWER_TABS[idx - 1].value);
  };

  const handleNext = () => {
    setError(null);
    if (activeTab === "general" && !draft.name.trim()) {
      setError("Agent name is required");
      toast.error("Please enter an agent name");
      return;
    }
    const idx = DRAWER_TABS.findIndex((t) => t.value === activeTab);
    if (idx !== -1 && idx < DRAWER_TABS.length - 1) setActiveTab(DRAWER_TABS[idx + 1].value);
  };

  const fail = (message: string) => {
    setError(message);
    toast.error(message);
  };

  const save = async () => {
    if (!draft.name.trim()) {
      fail("Agent name is required");
      setActiveTab("general");
      return;
    }
    setSaving(true);
    setError(null);
    const payload = buildAgentPayload(draft, agent);
    try {
      const res = draft.id
        ? await authFetch(`/chat/agents/${draft.id}`, { method: "PATCH", body: JSON.stringify(payload) })
        : await authFetch("/chat/agents", { method: "POST", body: JSON.stringify(payload) });
      if (!res.ok) {
        fail(detailFromError(await res.json().catch(() => ({})), "Failed to save agent"));
        return;
      }
      const saved: ChatAgent = await res.json();
      onSaved(saved, !draft.id);
      onOpenChange(false);
      toast.success(draft.id ? "Agent updated" : "Agent created");
    } catch {
      fail("Failed to save agent");
    } finally {
      setSaving(false);
    }
  };

  return {
    draft,
    setDraft,
    activeTab,
    setActiveTab,
    error,
    setError,
    saving,
    save,
    handlePrev,
    handleNext,
    pickCharacter,
    characters,
    presets,
    presetsLoading,
    tools,
    toolsLoading,
    documents,
    documentsLoading,
  };
}
