"use client";

import { useEffect, useState } from "react";

import type { VoiceInfo } from "@/client/types.gen";
import { VoiceCatalogTag } from "@/components/autonomous_ai_os/VoiceCatalogTag";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useProviderVoices } from "@/components/voice-selector/hooks/useProviderVoices";
import { useStoredVoicePreview } from "@/components/voice-selector/hooks/useStoredVoicePreview";
import { useVoiceCatalog } from "@/components/voice-selector/hooks/useVoiceCatalog";
import { useVoiceFiltering } from "@/components/voice-selector/hooks/useVoiceFiltering";
import { ManualVoiceToggle } from "@/components/voice-selector/ManualVoiceToggle";
import { SELECT_WITH_PREVIEW_PADDING, SelectPreviewSlot } from "@/components/voice-selector/SelectPreviewSlot";
import { StoredVoicePreviewButton } from "@/components/voice-selector/StoredVoicePreviewButton";
import { formatVoiceGender, GENDER_FILTER_VALUES, getVoiceGender } from "@/components/voice-selector/voiceMatching";
import { VoiceOptionLabel } from "@/components/voice-selector/VoiceOptionLabel";
import { useAuth } from "@/lib/auth";
import type { LocalUser } from "@/lib/auth/types";
import { cn } from "@/lib/utils";

interface VoiceSelectorProps {
    provider: string;
    value: string;
    onChange: (voiceId: string) => void;
    model?: string;
    language?: string;
    className?: string;
    /** Voices shown immediately and kept when the catalog API returns fewer. */
    staticVoices?: VoiceInfo[];
    /** Whether the user can type a voice ID manually. Defaults to true. */
    allowManualInput?: boolean;
    /** External gender filter: "all" | "female" | "male" | "neutral". */
    genderFilter?: string;
    /** Called when picking a voice implies a gender filter. */
    onGenderFilterChange?: (gender: string) => void;
    isManualInput?: boolean;
    onManualInputToggle?: (checked: boolean) => void;
    hideManualCheckbox?: boolean;
}

export const VoiceSelector: React.FC<VoiceSelectorProps> = ({
    provider,
    value,
    onChange,
    model,
    language,
    className,
    staticVoices,
    allowManualInput = true,
    genderFilter,
    onGenderFilterChange,
    isManualInput: propIsManualInput,
    onManualInputToggle,
    hideManualCheckbox = false,
}) => {
    const { user } = useAuth();
    const isSuperAdmin = (user as LocalUser & { is_superuser?: boolean })?.is_superuser ?? false;
    const [internalManualInput, setInternalManualInput] = useState(false);
    const isManualInput = propIsManualInput ?? internalManualInput;
    const [manualVoiceId, setManualVoiceId] = useState(value || "");

    const { voices, isLoading } = useProviderVoices({ provider, model, language, staticVoices });
    const catalog = useVoiceCatalog(isSuperAdmin, provider);
    const preview = useStoredVoicePreview([value, provider]);
    const filteredVoices = useVoiceFiltering({
        voices,
        provider,
        value,
        onChange,
        genderFilter: genderFilter ?? "all",
        language,
        isLoading,
        isManualInput,
    });

    // Keep the manual field in sync with the external value while in manual mode.
    useEffect(() => {
        if (value && isManualInput) setManualVoiceId(value);
    }, [value, isManualInput]);

    useEffect(() => {
        if (propIsManualInput) setManualVoiceId(value || "");
    }, [propIsManualInput, value]);

    const handleManualInputToggle = (checked: boolean) => {
        if (propIsManualInput === undefined) setInternalManualInput(checked);
        onManualInputToggle?.(checked);
        if (checked) {
            setManualVoiceId(value || "");
            return;
        }
        // Back to the list: keep the value if it is listed, else pick the first voice.
        if (!voices.some((v) => v.voice_id === value) && voices.length > 0) {
            onChange(voices[0].voice_id);
        }
    };

    const handleManualVoiceIdChange = (next: string) => {
        setManualVoiceId(next);
        onChange(next);
    };

    const handleVoiceSelect = (voiceId: string) => {
        if (!voiceId) return;
        onChange(voiceId);
        const gender = getVoiceGender(voices.find((v) => v.voice_id === voiceId), voiceId, provider);
        if (gender && GENDER_FILTER_VALUES.includes(gender)) onGenderFilterChange?.(gender);
    };

    const showManualToggle = !hideManualCheckbox && allowManualInput;

    if (isManualInput) {
        return (
            <div className={cn("space-y-2", className)}>
                <Input
                    type="text"
                    placeholder="Enter voice ID"
                    value={manualVoiceId}
                    onChange={(e) => handleManualVoiceIdChange(e.target.value)}
                />
                {showManualToggle && (
                    <ManualVoiceToggle
                        id={`custom-voice-${provider}-input`}
                        checked
                        onCheckedChange={handleManualInputToggle}
                    />
                )}
            </div>
        );
    }

    const selectedVoice = voices.find((v) => v.voice_id === value);
    const placeholder = isLoading ? "Loading voices..." : "Select voice";

    return (
        <div className={cn("space-y-2", className)}>
            <SelectPreviewSlot
                action={
                    selectedVoice?.preview_url && (
                        <StoredVoicePreviewButton
                            status={preview.statusFor(selectedVoice.voice_id)}
                            onToggle={() => preview.toggle(selectedVoice.preview_url!, selectedVoice.voice_id)}
                        />
                    )
                }
            >
                <Select value={value} onValueChange={handleVoiceSelect} disabled={isLoading}>
                    <SelectTrigger className={cn("w-full", selectedVoice?.preview_url && SELECT_WITH_PREVIEW_PADDING)}>
                        <SelectValue placeholder={placeholder}>
                            {selectedVoice ? (
                                <VoiceOptionLabel
                                    name={selectedVoice.name}
                                    detail={formatVoiceGender(selectedVoice, provider)}
                                    padding="trigger"
                                />
                            ) : (
                                placeholder
                            )}
                        </SelectValue>
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                        {value && !selectedVoice && (
                            <SelectItem value={value}>
                                <VoiceOptionLabel name={value} detail="Custom" />
                            </SelectItem>
                        )}
                        {filteredVoices.length === 0 ? (
                            <div className="p-3 text-center text-xs text-muted-foreground">No voices found</div>
                        ) : (
                            filteredVoices.map((voice) => (
                                <SelectItem key={voice.voice_id} value={voice.voice_id}>
                                    <VoiceOptionLabel name={voice.name} detail={formatVoiceGender(voice, provider)} />
                                </SelectItem>
                            ))
                        )}
                    </SelectContent>
                </Select>
            </SelectPreviewSlot>

            {showManualToggle && (
                <ManualVoiceToggle
                    id={`custom-voice-${provider}-dropdown`}
                    checked={false}
                    onCheckedChange={handleManualInputToggle}
                />
            )}

            {isSuperAdmin && selectedVoice && (
                <VoiceCatalogTag
                    provider={provider}
                    voiceId={selectedVoice.voice_id}
                    defaultDisplayName={selectedVoice.name}
                    entry={catalog.findEntry(selectedVoice.voice_id)}
                    onChange={catalog.refresh}
                />
            )}
        </div>
    );
};
