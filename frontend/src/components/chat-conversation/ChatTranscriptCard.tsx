"use client";

import { Download, MessageSquare, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import type { ChatMessage } from "@/client/types.gen";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { ChatMessageBubble } from "./ChatMessageBubble";
import { downloadTextFile, transcriptAsText } from "./chatTranscriptText";

interface ChatTranscriptCardProps {
  messages: ChatMessage[];
  agentName: string;
  conversationId?: number;
  /** Let the transcript fill the viewport (the "Transcript Only" tab) instead of a short scroll box. */
  tall?: boolean;
}

export function ChatTranscriptCard({ messages, agentName, conversationId, tall = false }: ChatTranscriptCardProps) {
  const [query, setQuery] = useState("");
  const needle = query.trim();

  const visible = useMemo(() => {
    const q = needle.toLowerCase();
    return q ? messages.filter((m) => m.content.toLowerCase().includes(q)) : messages;
  }, [messages, needle]);

  const hasMessages = messages.length > 0;

  const download = () => {
    downloadTextFile(transcriptAsText(messages, agentName), `chat-transcript-${conversationId ?? "conversation"}.txt`);
    toast.success("Transcript downloaded");
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-col justify-between gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 items-center gap-2">
          <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
          <CardTitle className="truncate whitespace-nowrap text-sm font-medium">Chat Transcript</CardTitle>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-56">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search transcript..."
              aria-label="Search transcript"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-8 pl-8 pr-8 text-xs"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <span className="text-xs text-muted-foreground">
            {messages.length} {messages.length === 1 ? "message" : "messages"}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={download}
            disabled={!hasMessages}
            className="h-7 gap-1.5 border-border/60 px-2.5 text-xs hover:bg-muted/50"
            title="Download Transcript"
          >
            <Download className="size-3.5 text-muted-foreground" />
            Download Transcript
          </Button>
        </div>
      </CardHeader>

      <CardContent
        className={cn(
          "overflow-y-auto p-4 sm:p-6",
          tall ? "min-h-[28rem] max-h-[calc(100dvh-16rem)]" : "max-h-[680px]",
        )}
      >
        {visible.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <MessageSquare className="size-8 text-muted-foreground/60" />
            <p className="text-sm font-medium text-foreground">
              {hasMessages ? "No messages match your search" : "No messages yet"}
            </p>
            <p className="max-w-xs text-xs text-muted-foreground">
              {hasMessages
                ? "Try a different word, or clear the search to see the whole conversation."
                : "Messages appear here as soon as the visitor and the agent start talking."}
            </p>
            {hasMessages && (
              <Button variant="outline" size="sm" className="mt-1 h-8 text-xs" onClick={() => setQuery("")}>
                Clear search
              </Button>
            )}
          </div>
        ) : (
          <ol aria-label="Chat transcript" className="space-y-5">
            {visible.map((message, index) => (
              <ChatMessageBubble key={index} message={message} agentName={agentName} query={needle} />
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
