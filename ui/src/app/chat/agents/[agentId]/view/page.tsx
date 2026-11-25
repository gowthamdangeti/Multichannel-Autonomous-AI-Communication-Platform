"use client";

import { useParams } from "next/navigation";

import { ChatAgentView } from "@/components/chat-agent/ChatAgentView";

export default function ChatAgentViewPage() {
  const { agentId } = useParams<{ agentId: string }>();
  return <ChatAgentView agentId={Number(agentId)} />;
}
