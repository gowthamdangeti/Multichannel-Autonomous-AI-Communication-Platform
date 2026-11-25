"use client";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { useServiceConfigEditor } from "../ServiceConfigContext";
import type { ServiceSegment } from "../types";

interface VoiceGenderSelectProps {
    service: ServiceSegment;
    options: string[];
}

/** Filters the voice picker by gender; the choice is saved with the TTS config. */
export function VoiceGenderSelect({ service, options }: VoiceGenderSelectProps) {
    const { genderFilters, setGenderFilter } = useServiceConfigEditor();
    const id = `${service}-voice-gender-filter`;

    return (
        <div className="space-y-2">
            <Label htmlFor={id}>Voice Gender</Label>
            <Select value={genderFilters[service] || "all"} onValueChange={(val) => setGenderFilter(service, val)}>
                <SelectTrigger id={id} aria-label="Filter voices by gender" className="w-full">
                    <SelectValue placeholder="All Genders" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">All Genders</SelectItem>
                    {options.map((g) => (
                        <SelectItem key={g} value={g}>
                            {g.charAt(0).toUpperCase() + g.slice(1)}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Filter available voices by gender.</p>
        </div>
    );
}
