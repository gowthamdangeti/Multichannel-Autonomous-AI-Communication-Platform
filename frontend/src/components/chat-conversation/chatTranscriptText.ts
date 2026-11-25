import type { ChatMessage } from "@/client/types.gen";

/** Who said it, as shown in the transcript and in copied / downloaded text. */
export const speakerOf = (message: ChatMessage, agentName: string) => (message.role === "user" ? "Visitor" : agentName);

/** The whole conversation as plain text, one block per message. */
export function transcriptAsText(messages: ChatMessage[], agentName: string): string {
  return messages.map((m) => `[${speakerOf(m, agentName)}] ${m.content}`).join("\n\n");
}

/** Saves `text` as a .txt file through a temporary link. */
export function downloadTextFile(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
