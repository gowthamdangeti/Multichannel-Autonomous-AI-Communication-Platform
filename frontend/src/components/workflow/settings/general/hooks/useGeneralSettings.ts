"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { DEFAULT_AMBIENT_NOISE_CONFIG } from "@/components/workflow/settings/constants";
import { useUnsavedChanges } from "@/context/UnsavedChangesContext";
import logger from "@/lib/logger";
import type { AmbientNoiseConfiguration, TurnStopStrategy, WorkflowConfigurations } from "@/types/workflow-configurations";

/** Saved values with their defaults applied — the baseline for dirty checks. */
function savedGeneralSettings(configurations: WorkflowConfigurations) {
    return {
        ambientNoise: configurations.ambient_noise_configuration || DEFAULT_AMBIENT_NOISE_CONFIG,
        maxCallDuration: configurations.max_call_duration || 600,
        maxUserIdleTimeout: configurations.max_user_idle_timeout || 10,
        smartTurnStopSecs: configurations.smart_turn_stop_secs || 2,
        turnStopStrategy: (configurations.turn_stop_strategy || "transcription") as TurnStopStrategy,
        contextCompactionEnabled: configurations.context_compaction_enabled ?? false,
    };
}

interface UseGeneralSettingsArgs {
    workflowConfigurations: WorkflowConfigurations;
    workflowName: string;
    onSave: (configurations: WorkflowConfigurations, workflowName: string) => Promise<void>;
}

/** Edit state, dirty tracking and save for the General settings card. */
export function useGeneralSettings({ workflowConfigurations, workflowName, onSave }: UseGeneralSettingsArgs) {
    const saved = useMemo(() => savedGeneralSettings(workflowConfigurations), [workflowConfigurations]);
    const [name, setName] = useState(workflowName);
    const [ambientNoise, setAmbientNoise] = useState<AmbientNoiseConfiguration>(saved.ambientNoise);
    const [maxCallDuration, setMaxCallDuration] = useState(saved.maxCallDuration);
    const [maxUserIdleTimeout, setMaxUserIdleTimeout] = useState(saved.maxUserIdleTimeout);
    const [smartTurnStopSecs, setSmartTurnStopSecs] = useState(saved.smartTurnStopSecs);
    const [turnStopStrategy, setTurnStopStrategy] = useState<TurnStopStrategy>(saved.turnStopStrategy);
    const [contextCompactionEnabled, setContextCompactionEnabled] = useState(saved.contextCompactionEnabled);
    const [isSaving, setIsSaving] = useState(false);

    const isDirty =
        name !== workflowName ||
        JSON.stringify(ambientNoise) !== JSON.stringify(saved.ambientNoise) ||
        maxCallDuration !== saved.maxCallDuration ||
        maxUserIdleTimeout !== saved.maxUserIdleTimeout ||
        smartTurnStopSecs !== saved.smartTurnStopSecs ||
        turnStopStrategy !== saved.turnStopStrategy ||
        contextCompactionEnabled !== saved.contextCompactionEnabled;

    useUnsavedChanges("general", isDirty);

    const save = async () => {
        setIsSaving(true);
        try {
            await onSave(
                {
                    ...workflowConfigurations,
                    ambient_noise_configuration: ambientNoise,
                    max_call_duration: maxCallDuration,
                    max_user_idle_timeout: maxUserIdleTimeout,
                    smart_turn_stop_secs: smartTurnStopSecs,
                    turn_stop_strategy: turnStopStrategy,
                    context_compaction_enabled: contextCompactionEnabled,
                },
                name,
            );
            toast.success("General settings saved successfully");
        } catch (error) {
            logger.error("Failed to save general settings:", error);
            toast.error("Failed to save general settings. Please try again.");
        } finally {
            setIsSaving(false);
        }
    };

    return {
        name, setName,
        ambientNoise, setAmbientNoise,
        maxCallDuration, setMaxCallDuration,
        maxUserIdleTimeout, setMaxUserIdleTimeout,
        smartTurnStopSecs, setSmartTurnStopSecs,
        turnStopStrategy, setTurnStopStrategy,
        contextCompactionEnabled, setContextCompactionEnabled,
        isDirty,
        isSaving,
        save,
    };
}
