"use client";

import { ThumbsDown, ThumbsUp } from "lucide-react";
import { Fragment } from "react";

import type { ChatMessage } from "@/client/types.gen";
import { fmtLatency, fmtTokens } from "@/components/chat-agent/chatAgentFormat";
import { cn } from "@/lib/utils";

import { speakerOf } from "./chatTranscriptText";

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `text` with every occurrence of `query` wrapped in a highlight. */
function Highlighted({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const parts = text.split(new RegExp(`(${escapeRegExp(query)})`, "gi"));
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <mark key={index} className="rounded-sm bg-primary/20 px-0.5 text-inherit">
            {part}
          </mark>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}

interface ChatMessageBubbleProps {
  message: ChatMessage;
  agentName: string;
  /** The transcript filter, highlighted inside the message. */
  query: string;
}

/** One message: speaker line, bubble, and (for replies) model and timing. */
export function ChatMessageBubble({ message, agentName, query }: ChatMessageBubbleProps) {
  const isVisitor = message.role === "user";

  const tokens = (message.prompt_tokens ?? 0) + (message.completion_tokens ?? 0);

  return (
    <li className={cn("flex", isVisitor ? "justify-end" : "justify-start", message.superseded && "opacity-60")}>
      <div className="flex max-w-[85%] min-w-0 flex-col gap-1">
        <div className={cn("flex items-center gap-2 px-1 text-xs text-muted-foreground", isVisitor && "justify-end")}>
          <span className="font-medium text-foreground">{speakerOf(message, agentName)}</span>
          {message.superseded && (
            <span title="The visitor asked for this reply again; its usage still counts">Replaced by retry</span>
          )}
        </div>

        <div
          className={cn(
            "min-w-0 whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
            isVisitor
              ? "rounded-br-md bg-primary text-primary-foreground"
              : "rounded-bl-md border border-border bg-muted text-foreground",
          )}
        >
          <Highlighted text={message.content} query={query} />
        </div>

        {!isVisitor && (message.latency_ms != null || message.model || tokens > 0 || message.feedback) && (
          <p className="flex flex-wrap items-center gap-x-2 px-1 font-mono text-[11px] text-muted-foreground">
            {message.model && <span>{message.model}</span>}
            {message.latency_ms != null && <span>{fmtLatency(message.latency_ms)}</span>}
            {tokens > 0 && <span>{fmtTokens(tokens)} tokens</span>}
            {message.feedback === "like" && (
              <span className="inline-flex items-center gap-1" title="The visitor rated this reply as good">
                <ThumbsUp className="size-3" /> Good response
              </span>
            )}
            {message.feedback === "dislike" && (
              <span className="inline-flex items-center gap-1" title="The visitor rated this reply as bad">
                <ThumbsDown className="size-3" /> Bad response
              </span>
            )}
          </p>
        )}
      </div>
    </li>
  );
}
