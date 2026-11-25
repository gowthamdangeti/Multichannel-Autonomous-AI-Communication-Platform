"use client";

import { Brain, Check, ChevronDown, Loader2, Pause, Play, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { getModelConfigurationOptionVoicePreviewApiV1OrganizationsModelConfigurationOptionsConfigIdVoicePreviewGet as fetchPresetVoicePreview } from "@/client/sdk.gen";
import type { ModelConfigurationOption } from "@/client/types.gen";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { type StoredPreviewStatus, useStoredVoicePreview } from "@/components/voice-selector/hooks/useStoredVoicePreview";
import { cn } from "@/lib/utils";
import type { WorkflowConfigurations } from "@/types/workflow-configurations";

interface WorkflowModelPresetSelectorProps {
    workflowConfigurations: WorkflowConfigurations;
    workflowName: string;
    onSave: (configurations: WorkflowConfigurations, workflowName: string) => Promise<void>;
    options: ModelConfigurationOption[];
}

interface PresetVoice {
    previewUrl: string | null;
    gender: string | null;
}

/** "female" -> "Female voice"; unknown gender -> null. */
function genderLabel(gender: string | null | undefined): string | null {
    if (!gender) return null;
    const clean = gender.trim().toLowerCase();
    if (!clean || clean === "—" || clean === "unknown") return null;
    return `${clean.charAt(0).toUpperCase()}${clean.slice(1)} voice`;
}

/**
 * When the admin has defined model-configuration presets ("model stacks"),
 * org users pick one by display name from a searchable dropdown. Each stack
 * shows its voice gender under the name and a play button to listen to the
 * voice before choosing.
 */
export function WorkflowModelPresetSelector({
    workflowConfigurations,
    workflowName,
    onSave,
    options,
}: WorkflowModelPresetSelectorProps) {
    const current = workflowConfigurations.platform_model_configuration_id;
    const [selected, setSelected] = useState<string>(current ? String(current) : (options[0] ? String(options[0].id) : ""));
    const [saving, setSaving] = useState(false);
    const [voices, setVoices] = useState<Record<number, PresetVoice>>({});
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");
    // Closing the dropdown stops any preview that is playing.
    const player = useStoredVoicePreview([open]);

    // Follow the saved stack only when it changes (after load or save). Keeping
    // `selected` out of the deps lets the user's pick stick until they save.
    useEffect(() => {
        if (current) {
            setSelected(String(current));
        }
    }, [current]);

    useEffect(() => {
        if (!selected && options.length > 0) {
            setSelected(String(options[0].id));
        }
    }, [options, selected]);

    // Voice preview URL and gender for every stack.
    useEffect(() => {
        let active = true;
        options.forEach((opt) => {
            fetchPresetVoicePreview({ path: { config_id: opt.id } })
                .then((res) => {
                    if (!active || res.error || !res.data) return;
                    const voice: PresetVoice = {
                        previewUrl: res.data.preview_url ?? null,
                        gender: res.data.gender || opt.gender || null,
                    };
                    setVoices((prev) => ({ ...prev, [opt.id]: voice }));
                })
                .catch(() => {});
        });
        return () => {
            active = false;
        };
    }, [options]);

    const getGender = (opt: ModelConfigurationOption): string | null =>
        voices[opt.id]?.gender || opt.gender || null;

    const selectedOption = options.find((opt) => String(opt.id) === selected);
    const query = search.trim().toLowerCase();
    const filteredOptions = query
        ? options.filter((opt) =>
            [opt.name, opt.description, getGender(opt)]
                .some((text) => text?.toLowerCase().includes(query)),
        )
        : options;

    const choose = (id: number) => {
        setSelected(String(id));
        setOpen(false);
    };

    const handleOpenChange = (next: boolean) => {
        setOpen(next);
        if (!next) setSearch("");
    };

    const handleSave = async () => {
        if (!selected) return;
        setSaving(true);
        try {
            await onSave(
                { ...workflowConfigurations, platform_model_configuration_id: Number(selected) },
                workflowName,
            );
            toast.success("Configuration updated");
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card id="models">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                    <Brain className="h-4 w-4" />
                    Configuration
                </CardTitle>
                <CardDescription>
                    Choose the voice &amp; language configuration for this agent.
                </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-start gap-4">
                <Popover open={open} onOpenChange={handleOpenChange}>
                    <PopoverTrigger asChild>
                        <Button
                            type="button"
                            variant="outline"
                            role="combobox"
                            aria-expanded={open}
                            className="h-auto min-h-11 w-full max-w-sm justify-between py-1.5 font-normal"
                        >
                            {selectedOption ? (
                                <PresetLabel name={selectedOption.name} gender={getGender(selectedOption)} />
                            ) : (
                                <span className="text-muted-foreground">Select a configuration</span>
                            )}
                            <ChevronDown className="ml-2 size-4 shrink-0 opacity-50" />
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-(--radix-popover-trigger-width) min-w-72 p-2" align="start">
                        <div className="relative mb-2">
                            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                autoFocus
                                placeholder="Search configurations..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && filteredOptions[0]) {
                                        e.preventDefault();
                                        choose(filteredOptions[0].id);
                                    }
                                }}
                                className="h-8 pl-8 text-sm"
                            />
                        </div>

                        <div role="listbox" className="max-h-72 space-y-0.5 overflow-y-auto">
                            {filteredOptions.length === 0 ? (
                                <p className="py-4 text-center text-sm text-muted-foreground">
                                    No matching configurations
                                </p>
                            ) : (
                                filteredOptions.map((opt) => {
                                    const voice = voices[opt.id];
                                    const previewUrl = voice?.previewUrl;
                                    const isSelected = String(opt.id) === selected;
                                    return (
                                        <div
                                            key={opt.id}
                                            className={cn(
                                                "flex items-center gap-2.5 rounded-sm px-2 py-1.5 transition-colors hover:bg-accent",
                                                isSelected && "bg-accent/60",
                                            )}
                                        >
                                            {previewUrl ? (
                                                <PreviewButton
                                                    status={player.statusFor(String(opt.id))}
                                                    onToggle={() => player.toggle(previewUrl, String(opt.id))}
                                                />
                                            ) : (
                                                <span className="size-6 shrink-0" aria-hidden />
                                            )}
                                            <button
                                                type="button"
                                                role="option"
                                                aria-selected={isSelected}
                                                className="flex min-w-0 flex-1 items-center justify-between gap-2 text-sm outline-none focus-visible:underline"
                                                onClick={() => choose(opt.id)}
                                            >
                                                <PresetLabel name={opt.name} gender={getGender(opt)} />
                                                {isSelected && <Check className="size-4 shrink-0" />}
                                            </button>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </PopoverContent>
                </Popover>

                <Button
                    type="button"
                    className="self-end"
                    onClick={handleSave}
                    disabled={saving || !selected || String(current) === selected}
                >
                    {saving ? "Saving..." : "Save Configuration"}
                </Button>
            </CardContent>
        </Card>
    );
}

/** Stack name with its voice gender on the line below. */
function PresetLabel({ name, gender }: { name: string; gender?: string | null }) {
    const detail = genderLabel(gender);
    return (
        <span className="flex min-w-0 flex-col items-start text-left leading-tight">
            <span className="w-full truncate font-medium">{name}</span>
            {detail && <span className="text-xs text-muted-foreground">{detail}</span>}
        </span>
    );
}

/** Play / pause a stack's voice preview without selecting it. */
function PreviewButton({
    status,
    onToggle,
}: {
    status: StoredPreviewStatus | null;
    onToggle: () => void;
}) {
    const isPlaying = status === "playing";
    const label = isPlaying ? "Pause voice preview" : "Play voice preview";
    return (
        <button
            type="button"
            title={label}
            aria-label={label}
            onClick={onToggle}
            className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full transition-all",
                isPlaying
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "bg-primary/10 text-primary hover:bg-primary/20 active:scale-95",
            )}
        >
            {status === "loading" ? (
                <Loader2 className="size-3 animate-spin" />
            ) : isPlaying ? (
                <Pause className="size-3 fill-current" />
            ) : (
                <Play className="size-3 translate-x-px fill-current" />
            )}
        </button>
    );
}
