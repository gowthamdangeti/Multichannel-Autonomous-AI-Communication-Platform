"use client";

import { Building2, Globe } from "lucide-react";

import type { ChatConversationDetail } from "@/client/types.gen";
import { DetailPanel, PanelDetailRow, PanelIdentifier } from "@/components/detail-panel/DetailPanel";

interface ChatConversationIdentifiersCardProps {
  conversation: ChatConversationDetail | null;
  organizationName: string | null;
}

/** The IDs behind this session, in the same order as the voice run page. */
export function ChatConversationIdentifiersCard({
  conversation,
  organizationName,
}: ChatConversationIdentifiersCardProps) {
  return (
    <DetailPanel title="Session Identifiers">
      <PanelIdentifier
        label="Conversation ID"
        value={conversation ? `convo_${conversation.id}` : "convo_—"}
      />
      <PanelDetailRow icon={Globe} label="Channel" sublabel="Visitor Channel">
        Website chat
      </PanelDetailRow>
      {conversation && (
        <PanelIdentifier label="Chat Agent ID" value={String(conversation.chat_agent_id)} />
      )}
      {organizationName && (
        <PanelDetailRow icon={Building2} label="Organization" sublabel="Account Holder">
          {organizationName}
        </PanelDetailRow>
      )}
    </DetailPanel>
  );
}
