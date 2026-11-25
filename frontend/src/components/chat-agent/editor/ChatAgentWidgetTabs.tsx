"use client";

import { Moon, Sun } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import { AgentDraft } from "./chatAgentDraft";

export function AppearanceTab({
    draft,
    setDraft,
}: {
    draft: AgentDraft;
    setDraft: (updater: (d: AgentDraft) => AgentDraft) => void;
}) {
    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                    <Label htmlFor="c-title" className="text-xs font-semibold">Header Title</Label>
                    <Input id="c-title" className="text-xs" value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} maxLength={40} />
                </div>
                <div className="space-y-1.5">
                    <Label htmlFor="c-subtitle" className="text-xs font-semibold">Header Subtitle</Label>
                    <Input id="c-subtitle" className="text-xs" value={draft.subtitle} onChange={(e) => setDraft((d) => ({ ...d, subtitle: e.target.value }))} maxLength={60} />
                </div>
                <div className="space-y-1.5">
                    <Label htmlFor="c-button-title" className="text-xs font-semibold">Button Title</Label>
                    <Input
                        id="c-button-title"
                        className="text-xs"
                        placeholder="e.g. Chat with us"
                        value={draft.button_title ?? ""}
                        onChange={(e) => setDraft((d) => ({ ...d, button_title: e.target.value }))}
                        maxLength={30}
                    />
                </div>
                <div className="space-y-1.5">
                    <Label htmlFor="c-position" className="text-xs font-semibold">Position</Label>
                    <Select value={draft.position} onValueChange={(v) => setDraft((d) => ({ ...d, position: v }))}>
                        <SelectTrigger id="c-position" className="w-full text-xs cursor-pointer"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="bottom-right" className="text-xs cursor-pointer">Bottom Right</SelectItem>
                            <SelectItem value="bottom-left" className="text-xs cursor-pointer">Bottom Left</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div className="space-y-1.5">
                    <Label htmlFor="c-placeholder" className="text-xs font-semibold">Input Placeholder</Label>
                    <Input id="c-placeholder" className="text-xs" value={draft.placeholder} onChange={(e) => setDraft((d) => ({ ...d, placeholder: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                    <Label htmlFor="c-brand-color" className="text-xs font-semibold">Brand Color</Label>
                    <div className="flex items-center gap-2">
                        <input
                            type="color"
                            aria-label="Pick brand color"
                            className="h-9 w-10 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-1"
                            value={/^#[0-9a-fA-F]{6}$/.test(draft.brand_color ?? "") ? draft.brand_color : "#18181b"}
                            onChange={(e) => setDraft((d) => ({ ...d, brand_color: e.target.value }))}
                        />
                        <Input
                            id="c-brand-color"
                            className="font-mono text-xs"
                            placeholder="Theme default"
                            value={draft.brand_color ?? ""}
                            onChange={(e) => setDraft((d) => ({ ...d, brand_color: e.target.value.trim() }))}
                            maxLength={7}
                        />
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                        Colors the chat button only. Leave empty for the theme default.
                    </p>
                </div>
                <div className="col-span-2 flex items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-accent/30">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                        {draft.theme === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0 flex-1">
                        <Label htmlFor="c-theme" className="text-sm font-medium">Dark theme</Label>
                        <p className="text-xs text-muted-foreground">
                            {draft.theme === "dark"
                                ? "The chat widget uses the dark theme. Turn off for the light theme."
                                : "The chat widget uses the light theme. Turn on for the dark theme."}
                        </p>
                    </div>
                    <Switch
                        id="c-theme"
                        checked={draft.theme === "dark"}
                        onCheckedChange={(checked) => setDraft((d) => ({ ...d, theme: checked ? "dark" : "light" }))}
                    />
                </div>
            </div>
        </div>
    );
}

export function DomainsTab({
    draft,
    setDraft,
}: {
    draft: AgentDraft;
    setDraft: (updater: (d: AgentDraft) => AgentDraft) => void;
}) {
    return (
        <div className="space-y-2">
            <Label htmlFor="c-domains" className="text-xs font-semibold">Allowed Domains</Label>
            <Textarea
                id="c-domains"
                rows={3}
                className="max-h-40 resize-y text-xs font-mono"
                placeholder="One per line, e.g.&#10;example.com&#10;*.example.com"
                value={draft.allowed_domains}
                onChange={(e) => setDraft((d) => ({ ...d, allowed_domains: e.target.value }))}
            />
            <p className="text-[11px] text-muted-foreground">Leave empty to allow embedding on any site. Otherwise only these domains can load the widget.</p>
        </div>
    );
}
