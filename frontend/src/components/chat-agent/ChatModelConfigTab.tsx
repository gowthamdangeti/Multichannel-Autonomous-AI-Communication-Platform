"use client";

import { Loader2 } from "lucide-react";

import type { ModelConfigurationOption } from "@/client/types.gen";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface ChatModelConfigTabProps {
  presets: ModelConfigurationOption[];
  loading: boolean;
  value: number | null;
  onChange: (presetId: number | null) => void;
}

/** Picks the platform model preset (LLM, keys, temperature) this chat agent replies with. */
export function ChatModelConfigTab({ presets, loading, value, onChange }: ChatModelConfigTabProps) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
        Loading configurations...
      </div>
    );
  }
  if (presets.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No model configurations yet. Create one on the Model Configurations page to choose it here.
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      <Label htmlFor="chat-model-cfg" className="text-xs font-semibold">
        Platform Model Configuration
      </Label>
      <Select value={value ? String(value) : ""} onValueChange={(v) => onChange(v ? Number(v) : null)}>
        <SelectTrigger id="chat-model-cfg" className="w-full cursor-pointer text-xs">
          <SelectValue placeholder="Select a configuration" />
        </SelectTrigger>
        <SelectContent>
          {presets.map((p) => (
            <SelectItem key={p.id} value={String(p.id)} className="cursor-pointer text-xs">
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-[11px] text-muted-foreground">
        The language model, API key and temperature this chat agent uses to reply.
      </p>
    </div>
  );
}
