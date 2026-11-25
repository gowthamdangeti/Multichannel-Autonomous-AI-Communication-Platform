"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

interface ManualVoiceToggleProps {
    id: string;
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
}

/** "Enter Custom Value" checkbox that switches between the list and a free-text voice id. */
export function ManualVoiceToggle({ id, checked, onCheckedChange }: ManualVoiceToggleProps) {
    return (
        <div className="flex items-center space-x-2">
            <Checkbox
                id={id}
                className="cursor-pointer"
                checked={checked}
                onCheckedChange={(next) => onCheckedChange(next as boolean)}
            />
            <Label htmlFor={id} className="text-sm font-normal cursor-pointer">
                Enter Custom Value
            </Label>
        </div>
    );
}
