"use client";

import { useEffect, useMemo } from "react";

import type { VoiceInfo } from "@/client/types.gen";
import { isUnavailableVoice } from "@/lib/voiceMetadata";

import { getVoiceGender, isVoiceMatchingLanguage } from "../voiceMatching";

interface UseVoiceFilteringArgs {
    voices: VoiceInfo[];
    provider: string;
    value: string;
    onChange: (voiceId: string) => void;
    genderFilter: string;
    language?: string;
    isLoading: boolean;
    isManualInput: boolean;
}

/**
 * Voices offered for the active gender filter and language, plus the rules
 * that move the selection onto a valid voice when those change.
 */
export function useVoiceFiltering({
    voices,
    provider,
    value,
    onChange,
    genderFilter,
    language,
    isLoading,
    isManualInput,
}: UseVoiceFilteringArgs): VoiceInfo[] {
    const targetGender = genderFilter.toLowerCase();

    const filteredVoices = useMemo(() => {
        const list = voices.filter(
            (voice) => targetGender === "all" || getVoiceGender(voice, voice.voice_id, provider) === targetGender,
        );
        // Only offer voices that can speak the selected language. If none can,
        // show everything rather than an empty list.
        if (language) {
            const matching = list.filter((v) => isVoiceMatchingLanguage(v, language, provider));
            if (matching.length > 0) return matching;
        }
        return list;
    }, [voices, targetGender, language, provider]);

    // Language changed and the current voice cannot speak it: pick the first that can.
    useEffect(() => {
        if (!language || isManualInput || filteredVoices.length === 0) return;
        const currentVoice = voices.find((v) => v.voice_id === value);
        if (currentVoice && isVoiceMatchingLanguage(currentVoice, language, provider)) return;
        const matching = filteredVoices.find((v) => isVoiceMatchingLanguage(v, language, provider));
        if (matching && matching.voice_id !== value) onChange(matching.voice_id);
    }, [language, isManualInput, voices, value, onChange, filteredVoices, provider]);

    // Gender filter changed and the current voice no longer matches it.
    useEffect(() => {
        if (targetGender === "all" || isManualInput || filteredVoices.length === 0) return;
        const currentVoice = voices.find((v) => v.voice_id === value);
        if (getVoiceGender(currentVoice, value, provider) === targetGender) return;
        const candidate = filteredVoices[0];
        if (candidate && candidate.voice_id !== value) onChange(candidate.voice_id);
    }, [targetGender, filteredVoices, isManualInput, voices, value, onChange, provider]);

    // Swap out a voice the provider would reject: one listed by mistake in the past
    // (e.g. Soniox "Emily") or one that belongs to another model of this provider.
    useEffect(() => {
        if (isLoading || isManualInput || filteredVoices.length === 0) return;
        if (isUnavailableVoice(provider, value, voices.map((v) => v.voice_id))) {
            onChange(filteredVoices[0].voice_id);
        }
    }, [isLoading, isManualInput, filteredVoices, voices, value, onChange, provider]);

    return filteredVoices;
}
