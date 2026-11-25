"use client";

import { Bot, Cpu, Globe, KeyRound } from "lucide-react";

import type { ChatConversationDetail } from "@/client/types.gen";
import { DASH } from "@/components/chat-agent/chatAgentFormat";
import { DetailPanel, PanelDetailRow } from "@/components/detail-panel/DetailPanel";

interface ChatConversationEmbedConfigCardProps {
  conversation: ChatConversationDetail | null;
  /** The agent's public key — the identifier its embed snippet uses. */
  agentKey: string | null;
  /** The model configuration the agent replies with. */
  modelConfigName: string | null;
}

/**
 * How this session reached the agent: the embedding site, the agent, its embed
 * key and the model preset it runs on. Chat has one channel, so this replaces
 * the voice page's per-channel configuration cards.
 */
export function ChatConversationEmbedConfigCard({
  conversation,
  agentKey,
  modelConfigName,
}: ChatConversationEmbedConfigCardProps) {
  return (
    <DetailPanel title="Embed Configuration">
      <div className="space-y-2">
        <PanelDetailRow icon={Globe} label="Origin" sublabel="Embed Source Domain">
          {conversation?.origin || DASH}
        </PanelDetailRow>
        <PanelDetailRow icon={Bot} label="Agent" sublabel="Chat Agent">
          {conversation?.agent_name || DASH}
        </PanelDetailRow>
        <PanelDetailRow icon={KeyRound} label="Public key" sublabel="Embed Key">
          {agentKey ?? DASH}
        </PanelDetailRow>
        <PanelDetailRow icon={Cpu} label="Preset" sublabel="Active Model Preset">
          {modelConfigName ?? DASH}
        </PanelDetailRow>
      </div>
    </DetailPanel>
  );
}
