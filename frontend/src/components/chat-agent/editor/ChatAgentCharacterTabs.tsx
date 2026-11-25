"use client";

import { CheckCircle2, Plus, XIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { AgentDraft, ChatCharacter } from "./chatAgentDraft";

export function CharactersTab({
    characters,
    draft,
    pickCharacter,
    setDraft,
}: {
    characters: ChatCharacter[];
    draft: AgentDraft;
    pickCharacter: (c: ChatCharacter) => void;
    setDraft: (updater: (d: AgentDraft) => AgentDraft) => void;
}) {
    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    const [customName, setCustomName] = useState("");
    const [customPersona, setCustomPersona] = useState("");

    const isPresetSelected = characters.some((c) => c.key === draft.character);
    const isCustomSelected = Boolean(draft.character && (!isPresetSelected || draft.character === "custom"));

    const handleCreateCustom = () => {
        if (!customName.trim()) return;
        setDraft((d) => ({
            ...d,
            character: customName.trim(),
            system_prompt: customPersona,
        }));
        setCreateDialogOpen(false);
    };

    return (
        <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {characters.map((c) => (
                    <button
                        type="button"
                        key={c.key}
                        onClick={() => pickCharacter(c)}
                        className={cn(
                            "flex flex-col gap-0.5 rounded-lg border p-2.5 text-left transition-colors cursor-pointer",
                            draft.character === c.key ? "border-2 border-cta bg-accent/30" : "border-border hover:bg-accent"
                        )}
                    >
                        <div className="flex items-center justify-between w-full mb-0.5">
                            <span className="text-sm font-medium leading-tight">{c.name}</span>
                            {draft.character === c.key && <CheckCircle2 className="h-4 w-4 shrink-0 text-cta" />}
                        </div>
                        <span className="text-[11px] leading-tight text-muted-foreground">{c.description}</span>
                    </button>
                ))}

                {/* Create Character Card Button */}
                <button
                    type="button"
                    onClick={() => {
                        setCustomName(isCustomSelected ? (draft.character === "custom" ? "" : draft.character) : "");
                        setCustomPersona(draft.system_prompt || "");
                        setCreateDialogOpen(true);
                    }}
                    className={cn(
                        "flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed p-3 text-center transition-all cursor-pointer hover:border-cta hover:bg-accent/40",
                        isCustomSelected ? "border-2 border-cta bg-accent/20" : "border-border"
                    )}
                >
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary mb-0.5">
                        <Plus className="h-3.5 w-3.5" />
                    </div>
                    <span className="text-xs font-semibold leading-tight">
                        {isCustomSelected && draft.character !== "custom" ? draft.character : "Create Character"}
                    </span>
                    <span className="text-[10px] leading-tight text-muted-foreground">
                        {isCustomSelected ? "Click to edit persona" : "Add custom name & prompt"}
                    </span>
                </button>
            </div>

            {/* Create Character Modal Popup */}
            <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
                <DialogContent className="sm:max-w-md bg-card" hideCloseButton>
                    <DialogHeader className="text-left !gap-0.5 !space-y-0">
                        <div className="flex items-center justify-between gap-2 w-full">
                            <DialogTitle className="text-base font-semibold leading-none">Create Custom Character</DialogTitle>
                            <button
                                type="button"
                                onClick={() => setCreateDialogOpen(false)}
                                className="rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none text-muted-foreground hover:text-foreground cursor-pointer p-0.5"
                            >
                                <XIcon className="h-4 w-4" />
                                <span className="sr-only">Close</span>
                            </button>
                        </div>
                        <DialogDescription className="text-xs text-muted-foreground leading-normal mt-1">
                            Specify a character name and instructions for your agent persona.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-3.5 py-2">
                        <div className="space-y-1.5">
                            <Label htmlFor="char-name-chat" className="text-xs font-semibold">
                                Character Name
                            </Label>
                            <Input
                                id="char-name-chat"
                                placeholder="e.g. Senior Support Lead"
                                value={customName}
                                onChange={(e) => setCustomName(e.target.value)}
                                className="h-8 text-xs"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="char-persona-chat" className="text-xs font-semibold">
                                Character Persona / Instructions
                            </Label>
                            <Textarea
                                id="char-persona-chat"
                                rows={2}
                                className="text-xs min-h-[52px] max-h-32 resize-y"
                                placeholder="Write the persona instructions and guidance for this character..."
                                value={customPersona}
                                onChange={(e) => setCustomPersona(e.target.value)}
                            />
                        </div>
                    </div>

                    <DialogFooter className="flex items-center justify-end gap-3 sm:space-x-0">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setCreateDialogOpen(false)}
                            className="h-8 text-xs"
                        >
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            onClick={handleCreateCustom}
                            disabled={!customName.trim()}
                            className="h-8 text-xs"
                        >
                            Save Character
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

export function ConfigTab({
    draft,
    setDraft,
}: {
    draft: AgentDraft;
    setDraft: (updater: (d: AgentDraft) => AgentDraft) => void;
}) {
    return (
        <div className="space-y-4">
            <div className="space-y-1.5">
                <Label htmlFor="c-name" className="text-xs font-semibold">Agent Name</Label>
                <Input
                    id="c-name"
                    placeholder="e.g. Website Support"
                    value={draft.name}
                    onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                    className="text-xs"
                />
            </div>
            <div className="space-y-1.5">
                <Label htmlFor="c-desc" className="text-xs font-semibold">Description</Label>
                <Textarea
                    id="c-desc"
                    rows={2}
                    className="max-h-32 resize-none text-xs"
                    placeholder="Short summary (optional)"
                    value={draft.description}
                    onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                />
            </div>
            <div className="space-y-1.5">
                <Label htmlFor="c-prompt" className="text-xs font-semibold">Instructions (System Prompt)</Label>
                <Textarea
                    id="c-prompt"
                    rows={4}
                    className="max-h-48 resize-y text-xs font-mono"
                    placeholder="You are a friendly support agent for Acme. Help visitors with…"
                    value={draft.system_prompt}
                    onChange={(e) => setDraft((d) => ({ ...d, system_prompt: e.target.value }))}
                />
            </div>
            <div className="space-y-1.5">
                <Label htmlFor="c-greeting" className="text-xs font-semibold">Greeting (Opening Message)</Label>
                <Textarea
                    id="c-greeting"
                    rows={2}
                    className="max-h-32 resize-none text-xs"
                    placeholder="Hi! How can I help you today?"
                    value={draft.greeting}
                    onChange={(e) => setDraft((d) => ({ ...d, greeting: e.target.value }))}
                />
            </div>
        </div>
    );
}
