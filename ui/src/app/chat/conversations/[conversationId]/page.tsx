"use client";

import { useParams } from "next/navigation";

import { ChatConversationView } from "@/components/chat-conversation/ChatConversationView";

export default function ChatConversationPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  return <ChatConversationView conversationId={Number(conversationId)} />;
}
