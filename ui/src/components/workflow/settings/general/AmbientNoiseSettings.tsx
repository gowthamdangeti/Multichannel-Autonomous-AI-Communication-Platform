"use client";

import { Loader2, Pause, Play, Upload, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAudioPlayback } from "@/hooks/useAudioPlayback";
import type { AmbientNoiseConfiguration } from "@/types/workflow-configurations";

import { useAmbientNoiseUpload } from "./hooks/useAmbientNoiseUpload";
import { SettingsBlock } from "./SettingsBlock";

const PLAYBACK_ID = "ambient-noise";

interface AmbientNoiseSettingsProps {
    workflowId: number;
    config: AmbientNoiseConfiguration;
    onChange: (update: (prev: AmbientNoiseConfiguration) => AmbientNoiseConfiguration) => void;
}

/** Background ambience: on/off, volume, and an optional custom audio file. */
export function AmbientNoiseSettings({ workflowId, config, onChange }: AmbientNoiseSettingsProps) {
    const { playingId, toggle: togglePlayback } = useAudioPlayback();
    const { fileInputRef, upload, isUploading, error, setError } = useAmbientNoiseUpload(
        workflowId,
        (ref) => onChange((prev) => ({ ...prev, ...ref })),
    );

    const handlePlayToggle = async () => {
        try {
            await togglePlayback(PLAYBACK_ID, config.storage_key!, config.storage_backend);
        } catch {
            setError("Failed to play audio");
        }
    };
    const removeCustomAudio = () => onChange((prev) => ({ enabled: prev.enabled, volume: prev.volume }));

    return (
        <SettingsBlock title="Ambient Noise" description="Add background ambient noise to make the conversation sound more natural.">
            <div className="flex items-center justify-between">
                <Label htmlFor="ambient-noise-enabled" className="text-sm">Use Ambient Noise</Label>
                <Switch
                    id="ambient-noise-enabled"
                    checked={config.enabled}
                    onCheckedChange={(checked) => onChange((prev) => ({ ...prev, enabled: checked }))}
                />
            </div>
            {config.enabled && (
                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="ambient-volume" className="text-xs">Volume</Label>
                        <Input
                            id="ambient-volume"
                            type="number"
                            step="0.1"
                            min="0"
                            max="1"
                            value={config.volume}
                            onChange={(e) => {
                                const value = parseFloat(e.target.value);
                                if (!isNaN(value)) onChange((prev) => ({ ...prev, volume: value }));
                            }}
                        />
                    </div>

                    <div className="space-y-2">
                        <Label className="text-xs">Custom Audio File</Label>
                        <p className="text-xs text-muted-foreground">
                            Upload your own audio file or use the default office ambience.
                        </p>
                        {config.storage_key ? (
                            <div className="flex items-center gap-2 rounded-md border p-2 bg-muted/10">
                                <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono truncate flex-1">
                                    {config.original_filename || "Custom audio"}
                                </code>
                                <Button type="button" size="sm" variant="ghost" className="h-6 w-6 p-0 shrink-0" onClick={handlePlayToggle}>
                                    {playingId === PLAYBACK_ID ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                                </Button>
                                <Button type="button" size="sm" variant="ghost" className="h-6 w-6 p-0 shrink-0" onClick={removeCustomAudio}>
                                    <X className="w-3.5 h-3.5" />
                                </Button>
                            </div>
                        ) : (
                            <div>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="audio/*"
                                    onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) void upload(file);
                                    }}
                                    className="hidden"
                                />
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="text-sm font-normal"
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={isUploading}
                                >
                                    {isUploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                                    {isUploading ? "Uploading..." : "Upload audio file (max 10MB)"}
                                </Button>
                            </div>
                        )}
                        {error && <p className="text-xs text-destructive">{error}</p>}
                        {!config.storage_key && (
                            <p className="text-xs text-muted-foreground italic">Using default office ambience</p>
                        )}
                    </div>
                </div>
            )}
        </SettingsBlock>
    );
}
