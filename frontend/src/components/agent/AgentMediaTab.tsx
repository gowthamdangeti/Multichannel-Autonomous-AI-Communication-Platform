"use client";

import {
    Check,
    CheckCircle2,
    FileText,
    ImageIcon,
    Mic,
    Plus,
    RotateCcw,
} from "lucide-react";
import React, { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export interface MediaCategorySettings {
    enabled: boolean;
    maxFiles: number;
    maxSizeMB: number;
    allowedTypes: string[];
    replyWithVoice?: boolean;
}

export interface AgentMediaConfig {
    images: MediaCategorySettings;
    documents: MediaCategorySettings;
    audio: MediaCategorySettings;
}

export type MediaCategoryKey = keyof AgentMediaConfig;

export const MEDIA_PRESETS: Record<
    MediaCategoryKey,
    {
        label: string;
        shortDesc: string;
        icon: React.ComponentType<{ className?: string }>;
        defaultMaxFiles: number;
        defaultMaxSizeMB: number;
        defaultTypes: string[];
        availableTypes: string[];
    }
> = {
    images: {
        label: "Images",
        shortDesc: "JPG, PNG, WebP, GIF, SVG, HEIC",
        icon: ImageIcon,
        defaultMaxFiles: 20,
        defaultMaxSizeMB: 100,
        defaultTypes: ["jpg", "jpeg", "png", "webp", "gif", "svg", "heic"],
        availableTypes: ["jpg", "jpeg", "png", "webp", "gif", "svg", "heic"],
    },
    documents: {
        label: "Documents",
        shortDesc: "PDF, Word, TXT, CSV, XLSX, PPTX",
        icon: FileText,
        defaultMaxFiles: 20,
        defaultMaxSizeMB: 100,
        defaultTypes: ["pdf", "doc", "docx", "txt", "csv", "xlsx", "pptx"],
        availableTypes: ["pdf", "doc", "docx", "txt", "csv", "xlsx", "pptx"],
    },
    audio: {
        label: "Audio",
        shortDesc: "MP3, WAV, OGG, M4A, AAC, FLAC",
        icon: Mic,
        defaultMaxFiles: 20,
        defaultMaxSizeMB: 100,
        defaultTypes: ["mp3", "wav", "ogg", "m4a", "aac", "flac"],
        availableTypes: ["mp3", "wav", "ogg", "m4a", "aac", "flac"],
    },
};

export const DEFAULT_MEDIA_CONFIG: AgentMediaConfig = {
    images: {
        enabled: true,
        maxFiles: MEDIA_PRESETS.images.defaultMaxFiles,
        maxSizeMB: MEDIA_PRESETS.images.defaultMaxSizeMB,
        allowedTypes: MEDIA_PRESETS.images.defaultTypes,
    },
    documents: {
        enabled: true,
        maxFiles: MEDIA_PRESETS.documents.defaultMaxFiles,
        maxSizeMB: MEDIA_PRESETS.documents.defaultMaxSizeMB,
        allowedTypes: MEDIA_PRESETS.documents.defaultTypes,
    },
    audio: {
        enabled: true,
        maxFiles: MEDIA_PRESETS.audio.defaultMaxFiles,
        maxSizeMB: MEDIA_PRESETS.audio.defaultMaxSizeMB,
        allowedTypes: MEDIA_PRESETS.audio.defaultTypes,
        replyWithVoice: false,
    },
};

interface AgentMediaTabProps {
    config: AgentMediaConfig;
    onChange: (updater: (prev: AgentMediaConfig) => AgentMediaConfig) => void;
    activeCategory?: MediaCategoryKey;
    onSelectCategory?: (cat: MediaCategoryKey) => void;
    showOverviewCards?: boolean;
}

export function AgentMediaTab({
    config,
    onChange,
    activeCategory,
    onSelectCategory,
    showOverviewCards = false,
}: AgentMediaTabProps) {
    const [localCategory, setLocalCategory] = useState<MediaCategoryKey>("images");
    const [customTypeInput, setCustomTypeInput] = useState("");

    const selectedCategory = activeCategory || localCategory;

    const handleSelectCategory = (cat: MediaCategoryKey) => {
        setLocalCategory(cat);
        if (onSelectCategory) onSelectCategory(cat);
    };

    const currentPreset = MEDIA_PRESETS[selectedCategory];
    const currentSettings = config[selectedCategory] || DEFAULT_MEDIA_CONFIG[selectedCategory];

    const toggleCategoryEnabled = (key: MediaCategoryKey, e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        onChange((prev) => ({
            ...prev,
            [key]: {
                ...prev[key],
                enabled: !prev[key].enabled,
            },
        }));
    };

    const updateCurrentSettings = (partial: Partial<MediaCategorySettings>) => {
        onChange((prev) => ({
            ...prev,
            [selectedCategory]: {
                ...prev[selectedCategory],
                ...partial,
            },
        }));
    };

    const toggleType = (ext: string) => {
        const cleanExt = ext.toLowerCase().trim().replace(/^\./, "");
        if (!cleanExt) return;

        const exists = currentSettings.allowedTypes.includes(cleanExt);
        const updated = exists
            ? currentSettings.allowedTypes.filter((t) => t !== cleanExt)
            : [...currentSettings.allowedTypes, cleanExt];

        updateCurrentSettings({ allowedTypes: updated });
    };

    const selectAllTypes = () => {
        const all = Array.from(new Set([...currentPreset.availableTypes, ...currentSettings.allowedTypes]));
        updateCurrentSettings({ allowedTypes: all });
    };

    const clearAllTypes = () => {
        updateCurrentSettings({ allowedTypes: [] });
    };

    const resetDefaults = () => {
        updateCurrentSettings({
            enabled: currentPreset.defaultMaxFiles > 0,
            maxFiles: currentPreset.defaultMaxFiles,
            maxSizeMB: currentPreset.defaultMaxSizeMB,
            allowedTypes: currentPreset.defaultTypes,
        });
    };

    const handleAddCustomType = (e: React.FormEvent) => {
        e.preventDefault();
        const cleanExt = customTypeInput.toLowerCase().trim().replace(/^\./, "");
        if (cleanExt && !currentSettings.allowedTypes.includes(cleanExt)) {
            updateCurrentSettings({ allowedTypes: [...currentSettings.allowedTypes, cleanExt] });
            setCustomTypeInput("");
        }
    };

    return (
        <div className="space-y-3.5">
            {/* Top Overview Cards (Only displayed if showOverviewCards is true) */}
            {showOverviewCards && (
                <div className="grid grid-cols-3 gap-2.5">
                    {(Object.keys(MEDIA_PRESETS) as MediaCategoryKey[]).map((key) => {
                        const preset = MEDIA_PRESETS[key];
                        const catConfig = config[key] || DEFAULT_MEDIA_CONFIG[key];
                        const isSelected = selectedCategory === key;
                        const Icon = preset.icon;

                        return (
                            <div
                                key={key}
                                onClick={() => handleSelectCategory(key)}
                                className={cn(
                                    "group relative flex flex-col justify-between rounded-lg border p-2.5 transition-all cursor-pointer select-none min-h-[76px]",
                                    isSelected
                                        ? "border-2 bg-accent/40 shadow-xs"
                                        : "border-border hover:bg-accent/20 hover:border-accent-foreground/20",
                                    !catConfig.enabled && "opacity-60 bg-muted/20"
                                )}
                                style={isSelected ? { borderColor: "var(--cta)" } : undefined}
                            >
                                <div className="flex items-center justify-between gap-1.5 w-full">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                        <div
                                            className={cn(
                                                "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-semibold",
                                                catConfig.enabled
                                                    ? "bg-primary/10 text-primary"
                                                    : "bg-muted text-muted-foreground"
                                            )}
                                        >
                                            <Icon className="h-3.5 w-3.5" />
                                        </div>
                                        <span className="text-xs font-semibold truncate leading-none">{preset.label}</span>
                                    </div>
                                    <Switch
                                        checked={catConfig.enabled}
                                        onCheckedChange={() => toggleCategoryEnabled(key)}
                                        onClick={(e) => e.stopPropagation()}
                                        className="scale-90 origin-right"
                                    />
                                </div>

                                <div className="flex items-center justify-between text-[11px] pt-1 mt-1 border-t border-border/40">
                                    {catConfig.enabled ? (
                                        <span className="text-muted-foreground text-[10px] truncate font-medium">
                                            {catConfig.maxFiles} files &middot; {catConfig.maxSizeMB} MB
                                        </span>
                                    ) : (
                                        <span className="text-muted-foreground/70 text-[10px] italic">Disabled</span>
                                    )}
                                    {isSelected && (
                                        <span className="text-[10px] font-bold shrink-0 ml-1" style={{ color: "var(--cta)" }}>
                                            Active
                                        </span>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Dedicated Settings Card for the Active Media Category */}
            <Card className="border-0 shadow-xs bg-card">
                <CardContent className="p-4 space-y-4">
                    {/* Category Header */}
                    <div className="flex items-center justify-between pb-2.5 border-b border-border/80">
                        <div className="flex items-center gap-2.5">
                            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                                {React.createElement(currentPreset.icon, { className: "h-4.5 w-4.5" })}
                            </div>
                            <div>
                                <div className="flex items-center gap-2">
                                    <h4 className="text-sm font-semibold leading-none">{currentPreset.label} Settings</h4>
                                    {currentSettings.enabled ? (
                                        <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                                            Enabled
                                        </span>
                                    ) : (
                                        <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-muted text-muted-foreground">
                                            Disabled
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={resetDefaults}
                                className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                            >
                                <RotateCcw className="h-3 w-3 mr-1" /> Reset
                            </Button>
                            <div className="flex items-center gap-1.5 bg-muted/40 px-2 py-1 rounded-md border border-border">
                                <Label htmlFor="enable-cat" className="text-[11px] font-medium cursor-pointer">
                                    Enable
                                </Label>
                                <Switch
                                    id="enable-cat"
                                    checked={currentSettings.enabled}
                                    onCheckedChange={(val) => updateCurrentSettings({ enabled: val })}
                                    className="scale-90"
                                />
                            </div>
                        </div>
                    </div>

                    {currentSettings.enabled ? (
                        <div className="space-y-3.5">
                            {/* Limits Row: Max File Limit & Max File Size */}
                            <div className="grid grid-cols-2 gap-3.5">
                                <div className="space-y-1.5 rounded-md border border-border/80 p-3 bg-accent/10">
                                    <div className="flex items-center justify-between text-xs font-semibold">
                                        <span>Max File Upload Limit</span>
                                        <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                                            {currentSettings.maxFiles} files
                                        </span>
                                    </div>
                                    <p className="text-[10px] text-muted-foreground">
                                        Maximum number of {currentPreset.label.toLowerCase()} allowed per session.
                                    </p>
                                    <div className="flex items-center gap-2.5 pt-1">
                                        <Input
                                            type="number"
                                            min={1}
                                            max={50}
                                            value={currentSettings.maxFiles}
                                            onChange={(e) =>
                                                updateCurrentSettings({
                                                    maxFiles: Math.max(1, parseInt(e.target.value) || 1),
                                                })
                                            }
                                            className="h-7 text-xs w-20"
                                        />
                                        <input
                                            type="range"
                                            min={1}
                                            max={20}
                                            value={Math.min(currentSettings.maxFiles, 20)}
                                            onChange={(e) =>
                                                updateCurrentSettings({ maxFiles: parseInt(e.target.value) || 1 })
                                            }
                                            className="flex-1 accent-primary h-1.5 cursor-pointer bg-muted rounded-lg"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-1.5 rounded-md border border-border/80 p-3 bg-accent/10">
                                    <div className="flex items-center justify-between text-xs font-semibold">
                                        <span>Max File Size Limit</span>
                                        <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                                            {currentSettings.maxSizeMB} MB
                                        </span>
                                    </div>
                                    <p className="text-[10px] text-muted-foreground">
                                        Maximum allowed size for each {currentPreset.label.toLowerCase().slice(0, -1)} file.
                                    </p>
                                    <div className="flex items-center gap-2.5 pt-1">
                                        <Input
                                            type="number"
                                            min={1}
                                            max={500}
                                            value={currentSettings.maxSizeMB}
                                            onChange={(e) =>
                                                updateCurrentSettings({
                                                    maxSizeMB: Math.max(1, parseInt(e.target.value) || 1),
                                                })
                                            }
                                            className="h-7 text-xs w-20"
                                        />
                                        <input
                                            type="range"
                                            min={1}
                                            max={100}
                                            value={Math.min(currentSettings.maxSizeMB, 100)}
                                            onChange={(e) =>
                                                updateCurrentSettings({ maxSizeMB: parseInt(e.target.value) || 1 })
                                            }
                                            className="flex-1 accent-primary h-1.5 cursor-pointer bg-muted rounded-lg"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Audio-Specific Option: Reply with Voice Note */}
                            {selectedCategory === "audio" && (
                                <div className="flex items-center justify-between rounded-md border border-border/80 p-3 bg-accent/10">
                                    <div className="space-y-0.5 pr-4">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-semibold">Reply with Voice</span>
                                            <span className={cn(
                                                "text-[10px] font-semibold px-1.5 py-0.2 rounded",
                                                currentSettings.replyWithVoice
                                                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                                    : "bg-muted text-muted-foreground"
                                            )}>
                                                {currentSettings.replyWithVoice ? "Enabled" : "Off (Text replies)"}
                                            </span>
                                        </div>
                                        <p className="text-[10px] text-muted-foreground">
                                            When enabled, the agent replies to voice notes with an audio voice note using its configured TTS model.
                                        </p>
                                    </div>
                                    <Switch
                                        checked={Boolean(currentSettings.replyWithVoice)}
                                        onCheckedChange={(val) => updateCurrentSettings({ replyWithVoice: val })}
                                        className="scale-90 shrink-0"
                                    />
                                </div>
                            )}

                            {/* Multi-Select Allowed Extensions */}
                            <div className="space-y-2.5 rounded-md border border-border/80 p-3 bg-card">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <span className="text-xs font-semibold block">
                                            Allowed File Types ({currentSettings.allowedTypes.length} selected)
                                        </span>
                                        <span className="text-[10px] text-muted-foreground">
                                            Select allowed extensions for {currentPreset.label.toLowerCase()}.
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <button
                                            type="button"
                                            onClick={selectAllTypes}
                                            className="text-[11px] font-medium text-primary hover:underline px-1 cursor-pointer"
                                        >
                                            Select All
                                        </button>
                                        <span className="text-muted-foreground text-[10px]">&middot;</span>
                                        <button
                                            type="button"
                                            onClick={clearAllTypes}
                                            className="text-[11px] font-medium text-muted-foreground hover:text-foreground px-1 cursor-pointer"
                                        >
                                            Clear All
                                        </button>
                                    </div>
                                </div>

                                {/* Multi-select Pills */}
                                <div className="flex flex-wrap gap-1.5 pt-0.5">
                                    {Array.from(
                                        new Set([...currentPreset.availableTypes, ...currentSettings.allowedTypes])
                                    ).map((ext) => {
                                        const isChecked = currentSettings.allowedTypes.includes(ext);
                                        return (
                                            <button
                                                type="button"
                                                key={ext}
                                                onClick={() => toggleType(ext)}
                                                className={cn(
                                                    "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium border transition-all cursor-pointer select-none",
                                                    isChecked
                                                        ? "bg-primary text-primary-foreground border-primary shadow-xs"
                                                        : "bg-muted/30 border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                                                )}
                                            >
                                                {isChecked ? (
                                                    <Check className="h-3 w-3 shrink-0" />
                                                ) : (
                                                    <div className="h-2.5 w-2.5 rounded-full border border-muted-foreground/50 shrink-0" />
                                                )}
                                                .{ext.toUpperCase()}
                                            </button>
                                        );
                                    })}
                                </div>

                                {/* Custom extension add line */}
                                <form onSubmit={handleAddCustomType} className="flex items-center gap-2 pt-2 border-t border-border/40">
                                    <Input
                                        placeholder="Add custom ext (e.g. psd, zip, csv)"
                                        value={customTypeInput}
                                        onChange={(e) => setCustomTypeInput(e.target.value)}
                                        className="h-7 text-xs flex-1 max-w-xs"
                                    />
                                    <Button
                                        type="submit"
                                        variant="secondary"
                                        size="sm"
                                        disabled={!customTypeInput.trim()}
                                        className="h-7 px-2.5 text-xs"
                                    >
                                        <Plus className="h-3 w-3 mr-1" /> Add Extension
                                    </Button>
                                </form>
                            </div>
                        </div>
                    ) : (
                        <div className="py-6 text-center text-muted-foreground bg-accent/10 rounded-md border border-dashed border-border space-y-2">
                            <p className="text-xs font-medium">
                                {currentPreset.label} media uploads are currently disabled for this agent.
                            </p>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => updateCurrentSettings({ enabled: true })}
                                className="h-7 text-xs px-3"
                            >
                                Enable {currentPreset.label}
                            </Button>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Active Media Summary Row (Only displayed if showOverviewCards is true) */}
            {showOverviewCards && (
                <div className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-muted/30 border border-border text-[11px]">
                    <span className="font-semibold text-muted-foreground">Enabled Media:</span>
                    <div className="flex flex-wrap items-center gap-1.5">
                        {(Object.keys(MEDIA_PRESETS) as MediaCategoryKey[]).map((key) => {
                            const cat = config[key] || DEFAULT_MEDIA_CONFIG[key];
                            const preset = MEDIA_PRESETS[key];
                            if (!cat.enabled) return null;
                            return (
                                <Badge key={key} variant="secondary" className="gap-1 text-[10px] py-0 px-1.5 font-medium">
                                    <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                                    {preset.label}: {cat.maxFiles} files ({cat.maxSizeMB}MB)
                                </Badge>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
