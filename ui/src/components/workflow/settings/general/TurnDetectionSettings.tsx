"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { TurnStopStrategy } from "@/types/workflow-configurations";

import { SettingsBlock } from "./SettingsBlock";

interface TurnDetectionSettingsProps {
    strategy: TurnStopStrategy;
    onStrategyChange: (strategy: TurnStopStrategy) => void;
    stopSecs: number;
    onStopSecsChange: (secs: number) => void;
}

/** How the agent decides the user has finished speaking. */
export function TurnDetectionSettings({ strategy, onStrategyChange, stopSecs, onStopSecsChange }: TurnDetectionSettingsProps) {
    return (
        <SettingsBlock title="Turn Detection" description="Configure how the agent detects when the user has finished speaking.">
            <div className="space-y-2">
                <Label htmlFor="turn_stop_strategy" className="text-xs">Detection Strategy</Label>
                <Select value={strategy} onValueChange={(value: TurnStopStrategy) => onStrategyChange(value)}>
                    <SelectTrigger id="turn_stop_strategy">
                        <SelectValue placeholder="Select strategy" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="transcription">Transcription-based</SelectItem>
                        <SelectItem value="turn_analyzer">Smart Turn Analyzer</SelectItem>
                    </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                    {strategy === "transcription"
                        ? "Best for short responses (1-2 word statements). Ends turn when transcription indicates completion."
                        : "Best for longer responses with natural pauses. Uses ML model to detect end of turn."}
                </p>
            </div>
            {strategy === "turn_analyzer" && (
                <div className="space-y-2">
                    <Label htmlFor="smart_turn_stop_secs" className="text-xs">
                        Incomplete Turn Timeout (seconds)
                    </Label>
                    <Input
                        id="smart_turn_stop_secs"
                        type="number"
                        step="0.5"
                        min="0.5"
                        max="10"
                        value={stopSecs}
                        onChange={(e) => {
                            const value = parseFloat(e.target.value);
                            if (!isNaN(value) && value >= 0.5) onStopSecsChange(value);
                        }}
                    />
                    <p className="text-xs text-muted-foreground">
                        Max silence duration before ending an incomplete turn. Default: 2 seconds
                    </p>
                </div>
            )}
        </SettingsBlock>
    );
}
